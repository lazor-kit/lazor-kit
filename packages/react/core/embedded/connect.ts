/**
 * Embedded connect: one "Continue with passkey" for new and returning users.
 *
 *   1. One `get()` with no `allowCredentials`, over a fresh ownership
 *      challenge (immediate mode where Chrome has it: see ./webauthn). No
 *      network call before it.
 *   2. No passkey came back (none here, or the sheet was closed): the
 *      no-passkey sheet offers "Create a passkey", "Use a passkey on another
 *      device" (hybrid) and "Not now". Nothing is ever created on its own.
 *   3. New passkey: `user.id` is the wallet's seed, so the wallet is at
 *      `findWallet(seed)`; the wallet is created through the app's relayer and
 *      read back before it is saved. A passkey made a moment ago cannot be on
 *      any wallet, so nothing is looked up.
 *   4. A passkey came back:
 *      - with a 32-byte `userHandle` (made by this SDK): its wallet is read
 *        where the seed puts it, with no scan (./chain `userHandleWallet`);
 *      - otherwise, or when that seed's wallet is not this passkey's: the
 *        3.3 lookup (`resolveOwnWallet`: v1 and v2, proven, described,
 *        adopted or confirmed by the user, or created for a key the
 *        passkey's own assertions pin, which takes one more prompt).
 *
 * The chain is read only from the app's RPC. A read that fails is a
 * `NetworkError`, never "no wallet": nothing is created on a failed read.
 * `disconnect` abandons a connect at any point (`signal`): its sheets close,
 * and it saves nothing.
 */
import type { Connection, PublicKey } from '@solana/web3.js';
import { createOwnershipChallenge } from '../message/ownershipProof';
import { type OwnershipProof, type WalletFacts, v2Client, verifyOwnershipProof } from '../program';
import type { WalletConfig, WalletInfo } from '../storage';
import { shortAddress } from '../portal/WalletChoiceView';
import type { OnConfirmWallet } from '../wallet/confirmation';
import {
    clearPendingConfirmation,
    describeCandidates,
    resolveOwnWallet,
    settleCandidates,
    takeOffer,
    type ResolveOwnWalletParams,
} from '../wallet/resolveWallet';
import { LazorkitConfigError, NetworkError, PasskeyUnavailableError, UserRejectedError, isUserRejection } from '../errors';
import { pageAvailability } from '../client/environment';
import { chainRead, createdByThisPasskey, readPasskeyAuthority, userHandleWallet, verifyCreatedWallet, walletOwnerCount } from './chain';
import { screen } from './events';
import { EmbeddedPrompt, embeddedUiFor, rejectionOf } from './prompt';
import { deletePending, knownCredentials, loadPending, rememberCredential, savePending } from './records';
import { MAX_NAME_BYTES, nameBytes } from './sheets';
import type { ConnectHow, Step } from './types';
import {
    type Assertion,
    assertPinned,
    bytesEqual,
    createPasskey,
    discover,
    discoverOnAnotherDevice,
    isDomError,
    randomBytes,
    sha256Bytes,
    toB64,
} from './webauthn';

export interface EmbeddedConnectResult {
    wallet: WalletInfo;
    how: ConnectHow;
    /** Transactions this connect sent (the wallet's creation). */
    signatures: string[];
}

/** Lands a v2 wallet: what the store's connect gives this module (its relayer and sends). */
export type CreateEmbeddedWallet = (params: {
    seed: Uint8Array;
    owner: { credentialIdHash: Uint8Array; compressedPubkey: Uint8Array; rpId: string };
}) => Promise<{ walletPda: PublicKey; authorityPda: PublicKey; signature: string; slot?: number }>;

export interface ConnectEmbeddedParams {
    config: WalletConfig;
    connection: Connection;
    /** Aborted by `disconnect`. */
    signal: AbortSignal;
    setStep: (step: Step | null) => void;
    createWallet: CreateEmbeddedWallet;
    confirmWallet?: string;
    onConfirmWallet?: OnConfirmWallet;
    /** The session key this device holds and its wallet (D10). */
    heldSessionKey?: ResolveOwnWalletParams['heldSessionKey'];
    /** A passkey already picked (autofill), with the challenge it signed. */
    preAsserted?: { assertion: Assertion; challenge: Uint8Array };
}

/**
 * `"<appName> · Ab3d…9xYz"`, at most 60 UTF-8 bytes: the app's name is cut
 * (by whole characters) so the vault's short address always fits.
 */
export function passkeyName(appName: string, vault: string): string {
    const suffix = ` · ${shortAddress(vault)}`;
    let name = appName.trim();
    while (name.length > 0 && nameBytes(name + suffix) > MAX_NAME_BYTES) name = [...name].slice(0, -1).join('');
    return `${name.trim()}${suffix}`;
}

const abandoned = () => new UserRejectedError('abandoned');

/** `promise`, or `abandoned()` as soon as `signal` aborts: an app's screen that never answers cannot hold a connect. */
function unlessAbandoned<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(abandoned());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abandoned());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

/** A read error from web3.js or fetch, as the `NetworkError` it is; anything else unchanged. */
function asNetworkError(error: unknown): unknown {
    if (error instanceof NetworkError || isUserRejection(error)) return error;
    const name = (error as { name?: unknown })?.name;
    const message = String((error as Error)?.message ?? error);
    if (
        name === 'SolanaJSONRPCError' ||
        /failed to get|failed to fetch|fetch failed|load failed|network|timed out|429|50[234]|ECONN|socket|Too Many Requests/i.test(message)
    ) {
        return new NetworkError(`Couldn't read the chain: ${message}`, error);
    }
    return error;
}

export async function connectEmbedded(p: ConnectEmbeddedParams): Promise<EmbeddedConnectResult> {
    const { config, connection, signal } = p;
    const rpId = config.rpId!;
    const appName = config.appName!;
    const ui = embeddedUiFor(config);
    const prompt = new EmbeddedPrompt(config);
    const client = v2Client(connection);

    const page = pageAvailability(config);
    if (page.problem) throw page.problem;
    if (page.availability === 'unavailable') throw new PasskeyUnavailableError();

    // A 'throw' offer the app confirms within its two minutes: no prompt.
    if (p.confirmWallet) {
        const offered = takeOffer(p.confirmWallet, connection.rpcEndpoint, rpId);
        if (offered) {
            return { wallet: walletInfo(offered.facts, offered.credentialId, 'confirmed', rpId, offered.accountName), how: 'confirmed', signatures: [] };
        }
    }
    clearPendingConfirmation();

    const close = () => {
        ui.close();
        prompt.destroy();
    };
    signal.addEventListener('abort', close);
    const check = () => {
        if (signal.aborted) throw abandoned();
    };

    /** Create the wallet for a passkey at `seed`, and read it back before anything is saved. */
    const createFor = async (
        seed: Uint8Array,
        rawId: Uint8Array,
        key: Uint8Array,
        how: ConnectHow,
        accountName?: string,
    ): Promise<EmbeddedConnectResult> => {
        check();
        p.setStep('creating-wallet');
        ui.progress('creating-wallet');
        const credentialIdHash = sha256Bytes(rawId);
        const landed = await p.createWallet({ seed, owner: { credentialIdHash, compressedPubkey: key, rpId } });
        await verifyCreatedWallet({
            connection,
            programId: client.programId,
            wallet: landed.walletPda,
            authority: landed.authorityPda,
            credentialIdHash,
            publicKey: key,
            rpId,
            minContextSlot: landed.slot,
        });
        deletePending(rpId, rawId);
        // Too late to stop the creation; it is simply not connected. The next
        // connect finds it.
        check();
        const [vault] = client.findVault(landed.walletPda);
        return {
            wallet: {
                ...baseInfo(toB64(rawId), key, accountName),
                smartWallet: landed.walletPda.toBase58(),
                vaultPda: vault.toBase58(),
                protocolVersion: 2,
                ...embeddedFields(how, client.programId, rpId),
            },
            how,
            signatures: [landed.signature],
        };
    };

    /**
     * "Try again" after a creation failed: the chain is read again first. The
     * creation may have landed late (then it is this passkey's, and used), or
     * someone may have taken the seed (then another seed is used).
     */
    const retryCreation = async (attempt: { seed: Uint8Array; rawId: Uint8Array; key: Uint8Array; name: string }) => {
        const [walletPda] = client.findWallet(attempt.seed);
        const credentialIdHash = sha256Bytes(attempt.rawId);
        const [authorityPda] = client.findAuthority(walletPda, credentialIdHash);
        const [walletAccount, authorityAccount] = await chainRead('the wallet', () =>
            connection.getMultipleAccountsInfo([walletPda, authorityPda], 'confirmed'),
        );
        if (!walletAccount) return createFor(attempt.seed, attempt.rawId, attempt.key, 'created', attempt.name);
        const seat = readPasskeyAuthority(authorityAccount, client.programId);
        const ours =
            seat !== null &&
            seat.counter === 0 &&
            bytesEqual(seat.publicKey, attempt.key) &&
            walletOwnerCount(walletAccount, client.programId) === 1 &&
            (await createdByThisPasskey(connection, client.programId, walletPda, authorityPda));
        if (ours) {
            await verifyCreatedWallet({
                connection,
                programId: client.programId,
                wallet: walletPda,
                authority: authorityPda,
                credentialIdHash,
                publicKey: attempt.key,
                rpId,
            });
            deletePending(rpId, attempt.rawId);
            const [vault] = client.findVault(walletPda);
            return {
                wallet: {
                    ...baseInfo(toB64(attempt.rawId), attempt.key, attempt.name),
                    smartWallet: walletPda.toBase58(),
                    vaultPda: vault.toBase58(),
                    protocolVersion: 2 as const,
                    ...embeddedFields('created', client.programId, rpId),
                },
                how: 'created' as const,
                signatures: [],
            };
        }
        return createFor(randomBytes(32), attempt.rawId, attempt.key, 'created', attempt.name);
    };

    try {
        let challenge: Uint8Array;
        let assertion: Assertion | null;
        if (p.preAsserted) {
            ({ assertion, challenge } = p.preAsserted);
        } else {
            challenge = createOwnershipChallenge();
            p.setStep('checking-passkey');
            assertion = await discover(config, { rpId, challenge, signal }).catch((error) => {
                throw rejectionOf(error);
            });
        }

        let notice: 'exists' | 'wallet-failed' | undefined;
        let created: { seed: Uint8Array; rawId: Uint8Array; key: Uint8Array; name: string } | undefined;
        let seed = randomBytes(32);
        while (!assertion) {
            check();
            p.setStep('no-passkey');
            const [walletPda] = client.findWallet(seed);
            const suggestedName = passkeyName(appName, client.findVault(walletPda)[0].toBase58());
            const choice = await screen(config, 'no-passkey', () =>
                unlessAbandoned(signal, ui.noPasskey({ appName, suggestedName, notice })),
            );
            check();
            if (choice.action === 'not-now') throw new UserRejectedError('not-now');

            if (choice.action === 'other-device') {
                p.setStep('other-device');
                ui.progress('other-device');
                challenge = createOwnershipChallenge();
                assertion = await discoverOnAnotherDevice(config, { rpId, challenge, signal }).catch((error) => {
                    throw rejectionOf(error);
                });
                notice = undefined;
                continue;
            }

            if (choice.action === 'retry-wallet' && created) {
                try {
                    return await retryCreation(created);
                } catch (error) {
                    if (signal.aborted || isUserRejection(error) || error instanceof LazorkitConfigError) throw error;
                    notice = 'wallet-failed';
                    console.error('[LazorKit] Creating the wallet failed again:', error);
                    continue;
                }
            }

            if (choice.action === 'create') {
                p.setStep('creating-passkey');
                ui.progress('creating-passkey');
                const name = choice.name.trim() || suggestedName;
                let passkey;
                try {
                    passkey = await createPasskey(config, {
                        rpId,
                        rpName: appName,
                        userId: seed,
                        name,
                        exclude: knownCredentials(rpId),
                        signal,
                    });
                } catch (error) {
                    // Closed: nothing was created; the offer stays (R27).
                    if (isDomError(error, 'NotAllowedError')) {
                        notice = undefined;
                        continue;
                    }
                    if (isDomError(error, 'InvalidStateError')) {
                        notice = 'exists';
                        continue;
                    }
                    throw rejectionOf(error);
                }
                // Kept until the wallet lands: a later sign-in with this
                // passkey creates it with no second prompt (R29).
                savePending(rpId, passkey.rawId, { publicKey: passkey.publicKey, seed, name, createdAt: new Date().toISOString() });
                rememberCredential(rpId, passkey.rawId);
                created = { seed, rawId: passkey.rawId, key: passkey.publicKey, name };
                try {
                    return await createFor(seed, passkey.rawId, passkey.publicKey, 'created', name);
                } catch (error) {
                    if (signal.aborted || isUserRejection(error)) throw error;
                    console.error('[LazorKit] The passkey was created, but its wallet was not:', error);
                    notice = 'wallet-failed';
                    continue;
                }
            }
            // A retry with no creation to retry: start the offer again.
            seed = randomBytes(32);
            notice = undefined;
        }

        return await resolveAssertion(assertion, challenge!);
    } catch (error) {
        if (signal.aborted) throw abandoned();
        throw asNetworkError(error);
    } finally {
        signal.removeEventListener('abort', close);
        ui.close();
        prompt.destroy();
    }

    /** Steps 4–7: which wallet this passkey's assertion is for. */
    async function resolveAssertion(assertion: Assertion, challenge: Uint8Array): Promise<EmbeddedConnectResult> {
        check();
        p.setStep('finding-wallet');
        ui.progress('finding-wallet');
        const rawId = assertion.rawId;
        rememberCredential(rpId, rawId);
        const credentialId = toB64(rawId);
        const credentialIdHash = sha256Bytes(rawId);
        const proof: OwnershipProof = {
            challenge,
            signature: assertion.signature,
            authenticatorData: assertion.authenticatorData,
            clientDataJson: assertion.clientDataJson,
        };
        const pending = loadPending(rpId, rawId);
        let secondPrompt = false;
        const params: ResolveOwnWalletParams = {
            connection,
            rpId,
            credentialId,
            reportedPubkey: pending?.publicKey,
            kind: 'asserted',
            connectProof: proof,
            signChallenge: async (c) => {
                secondPrompt = true;
                p.setStep('one-more-check');
                ui.progress('one-more-check');
                let second: Assertion;
                try {
                    second = await assertPinned(config, 'get:recover', { rpId, challenge: c, credentialId: rawId, signal });
                } catch (error) {
                    throw rejectionOf(error);
                }
                p.setStep('finding-wallet');
                return {
                    signature: second.signature,
                    authenticatorData: second.authenticatorData,
                    clientDataJson: second.clientDataJson,
                    credentialId: toB64(second.rawId),
                };
            },
            trustedAuthorities: config.trustedAuthorities,
            watchMints: config.watchMints,
            onConfirmWallet: p.onConfirmWallet ?? config.onConfirmWallet,
            confirmWallet: p.confirmWallet,
            chooseWallet: (choices) => {
                p.setStep('choose-wallet');
                ui.progress(null);
                return unlessAbandoned(signal, prompt.openWalletChoice(choices));
            },
            accountName: pending?.name,
            signal,
            heldSessionKey: p.heldSessionKey,
        };

        // The seed a new wallet would get: the passkey's own `userHandle` when
        // nothing is there yet, else a fresh one.
        let seed: Uint8Array | undefined;
        if (assertion.userHandle?.length === 32) {
            const found = await userHandleWallet({
                connection,
                client,
                userHandle: assertion.userHandle,
                credentialIdHash,
                proof,
                rpId,
                describe: (candidates) => describeCandidates(client, candidates, params),
            });
            check();
            if (found.kind === 'adopt') {
                return { wallet: walletInfo(found.candidate, credentialId, 'adopted', rpId, pending?.name), how: 'adopted', signatures: [] };
            }
            if (found.kind === 'choose') {
                const settled = await settleCandidates([found.facts], params);
                check();
                if (settled && 'adopt' in settled) {
                    const how: ConnectHow = settled.confirmed ? 'confirmed' : 'adopted';
                    return { wallet: walletInfo(settled.adopt, credentialId, how, rpId, pending?.name), how, signatures: [] };
                }
            }
            if (found.kind === 'absent') {
                seed = assertion.userHandle;
                // This device created the passkey and its wallet did not land:
                // its key is known, and the assertion proves it. No scan, no
                // second prompt.
                if (pending && verifyOwnershipProof([{ publicKey: pending.publicKey }], proof, rpId).length) {
                    return createFor(seed, rawId, pending.publicKey, 'created', pending.name);
                }
            }
        }

        const own = await resolveOwnWallet(params);
        check();
        if ('adopt' in own) {
            const how: ConnectHow = own.confirmed ? 'confirmed' : 'adopted';
            return { wallet: walletInfo(own.adopt, credentialId, how, rpId, pending?.name), how, signatures: [] };
        }
        const how: ConnectHow = secondPrompt ? 'recovered' : 'created';
        const at = seed ?? randomBytes(32);
        // A key two prompts pinned is kept until its wallet lands: a retry
        // then needs no second prompt.
        if (!pending) savePending(rpId, rawId, { publicKey: own.create, seed: at, name: '', createdAt: new Date().toISOString() });
        return createFor(at, rawId, own.create, how, pending?.name);
    }
}

function embeddedFields(how: ConnectHow, programId: PublicKey, rpId: string) {
    return { mode: 'embedded' as const, rpId, programId: programId.toBase58(), how, connectedAt: new Date().toISOString() };
}

function baseInfo(credentialId: string, passkeyPubkey: Uint8Array, accountName?: string) {
    return {
        credentialId,
        passkeyPubkey: Array.from(passkeyPubkey),
        expo: 'web',
        platform: typeof navigator === 'undefined' ? '' : (navigator.platform ?? ''),
        walletDevice: '',
        accountName,
    };
}

/** A wallet found for this passkey, as the store keeps it. */
function walletInfo(
    facts: Pick<WalletFacts, 'walletPda' | 'vaultPda' | 'publicKey' | 'version' | 'programId'>,
    credentialId: string,
    how: ConnectHow,
    rpId: string,
    accountName?: string,
): WalletInfo {
    return {
        ...baseInfo(credentialId, facts.publicKey, accountName),
        smartWallet: facts.walletPda.toBase58(),
        vaultPda: facts.vaultPda.toBase58(),
        protocolVersion: facts.version,
        ...embeddedFields(how, facts.programId, rpId),
    };
}
