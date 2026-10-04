/**
 * SDK Actions - Core wallet operations
 *
 * An action settles its promise only: the store reports the outcome to the
 * call's `onSuccess` / `onFail` once the action is over, with `isSigning` /
 * `isConnecting` already cleared, or at once for a call refused because
 * another holds the flag (see `reportOutcome` in ./utils).
 */
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';
import {
    Transaction,
    TransactionMessage,
    VersionedTransaction,
    PublicKey,
    AddressLookupTableAccount,
    TransactionInstruction,
    Connection,
} from '@solana/web3.js';
import { SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from '../paymaster/paymaster';
import { WalletState, ConnectOptions, DisconnectOptions, SignAndSendTransactionPayload, CreateSessionPayload, RevokeSessionPayload, AddAuthorityPayload, AuthorizeAndExecutePayload, AuthorizeDeferredPayload, ExecuteDeferredPayload } from '../types';
import {
    createDialogManager,
    getCredentialHash,
    handleActionError,
    cleanupLegacyStorage,
} from './utils';
import { clearPendingConfirmation, connectAbandoned, connectFreshWallet } from './resolveWallet';
import {
    ROLE_OWNER,
    ROLE_ADMIN,
    ROLE_SPENDER,
    type ProtocolVersion,
    clientFor,
    versionOf,
    versionOfAccount,
    readPasskeyPubkey,
    serializeDeferred,
    deserializeDeferred,
    V1WalletMigratedError,
} from '../program';
import type { WalletConfig } from '../storage';
import { spendingLimitsRecord, spendingLimitsToActions, toPolicyError } from './policy';
import { DEFAULTS } from '../../config';
import { type AuthorityTurn, sendAndConfirm, withAuthority } from './sequence';
import { buildPreviewTransactionBase64 } from './preview';
import { deferredExpiryOffset, executeBeforeExpiry } from './deferred';
import { type KeySigner, type KeyStorage, forgetKey, generateKey, saveKey, wipeKey, wipeMark } from '../keys';
import { keyForConnectedWallet } from './keyBinding';
import { noteDisconnect } from './disconnects';
import type { SignMessageResult } from '../message/signedMessage';

export function randomBytes(size: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

/** Encodes bytes as URL-safe base64 (no padding) — the format the portal expects as a challenge. */
function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * A call refused before it started because something it needs is missing (a
 * connected wallet, a connection): reported like any failure, in `error` too.
 * A refusal because another call is running ('Already signing') leaves
 * `error` alone: it belongs to that call.
 */
function refuse(set: (state: Partial<WalletState>) => void, message: string): never {
    const error = new Error(message);
    set({ error });
    throw error;
}

/** Where the SDK keeps the session and authority keys it generates (see ../keys). */
function keyStorageOf(config: WalletConfig): KeyStorage {
    return config.keyStorage === 'memory' ? 'memory' : 'auto';
}

/** The connected wallet's protocol, for error reporting. */
function walletVersion(get: () => WalletState): ProtocolVersion | undefined {
    const wallet = get().wallet;
    return wallet ? versionOf(wallet) : undefined;
}

/**
 * The paymaster for a wallet's protocol. v1 wallets keep the relayer the app
 * used before v2 (`v1PaymasterConfig`, defaulting to the main one). A new one
 * for each action.
 *
 * `beforeAttempt`: a session or authority send passes its kept key's
 * `assertSendable`. The paymaster runs it right before each attempt to send,
 * whichever of its send methods the transaction goes out by, so nothing a
 * kept key signed goes out once the wallet has been disconnected (see
 * ./keyBinding).
 */
function paymasterFor(
    config: WalletConfig,
    version: ProtocolVersion,
    options: { beforeAttempt?: () => void } = {},
): Paymaster {
    return new Paymaster(
        version === 1 ? (config.v1PaymasterConfig ?? config.paymasterConfig) : config.paymasterConfig,
        { protocolVersion: version, beforeAttempt: options.beforeAttempt },
    );
}

/**
 * Builds a transaction in either legacy or v0 wire format, submits it through
 * the paymaster, and resolves once it is confirmed (see ./sequence). It
 * rejects when the transaction failed on chain or did not land, and with
 * `TransactionOutcomeUnknownError` when that is not known: a paymaster's
 * answer only says the RPC accepted it. Default is v0 (matches
 * mobile-wallet-adapter).
 *
 * `turn`: the lane of the passkey authority whose counter this transaction
 * consumes. The next challenge for that passkey is then read from state that
 * includes it.
 *
 * For session/authority flows that need a client-side signer in addition to
 * the paymaster's feePayer, pass it in `signers`: each adds its signature to
 * its own slot, in v0 and legacy alike, before the paymaster adds the fee
 * payer's. A transaction is signed once: `sendAndConfirm` never re-signs it.
 */
async function buildAndSendTx(params: {
    paymaster: Paymaster;
    connection: Connection;
    feePayer: PublicKey;
    instructions: TransactionInstruction[];
    signers?: KeySigner[];
    addressLookupTables?: AddressLookupTableAccount[];
    txVersion?: 'legacy' | 'v0';
    turn?: AuthorityTurn;
    /** A passkey authority this transaction creates: its first challenge is read at or past the creation. */
    createsAuthority?: PublicKey;
}): Promise<string> {
    const { paymaster, connection, feePayer, instructions } = params;
    const signers = params.signers ?? [];
    const txVersion = params.txVersion ?? 'v0';
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    let send: () => Promise<string>;
    let simulateLogs: () => Promise<readonly string[] | null | undefined>;
    if (txVersion === 'legacy') {
        if ((params.addressLookupTables?.length ?? 0) > 0) {
            throw new Error('Address lookup tables are only supported with txVersion="v0"');
        }
        const tx = new Transaction();
        tx.add(...instructions);
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayer;
        for (const signer of signers) await signer.signTransaction(tx);
        send = () => paymaster.signAndSend(tx);
        simulateLogs = async () => (await connection.simulateTransaction(tx)).value.logs;
    } else {
        const v0Message = new TransactionMessage({
            payerKey: feePayer,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message(params.addressLookupTables ?? []);
        const tx = new VersionedTransaction(v0Message);
        for (const signer of signers) await signer.signTransaction(tx);
        send = () => paymaster.signAndSendVersionedTransaction(tx);
        simulateLogs = async () =>
            (await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })).value.logs;
    }

    return sendAndConfirm({
        connection,
        attempt: { blockhash, lastValidBlockHeight },
        send,
        turn: params.turn,
        createsAuthority: params.createsAuthority,
        simulateLogs,
    });
}


/**
 * The store's connect in flight, if any. `disconnect` aborts it: its portal or
 * chooser closes and it saves nothing — so no wallet arrives after the user
 * disconnected, or beside a connect started after that. (The store is one per
 * page, as is this.)
 */
let connectInFlight: AbortController | null = null;

/**
 * Abandons the store's connect in flight, if any (see `connectInFlight`):
 * at the store's `disconnect`, and at the adapter's (see react/store).
 */
export function abandonConnect(): void {
    connectInFlight?.abort();
    connectInFlight = null;
}

/**
 * Connect wallet action
 */
export const connectAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    options?: ConnectOptions & { feeMode?: 'paymaster' | 'user' }
): Promise<WalletInfo> => {
    const { isConnecting, config } = get();

    if (isConnecting) {
        throw new Error('Already connecting');
    }

    const attempt = new AbortController();
    connectInFlight = attempt;
    set({ isConnecting: true, error: null });

    try {
        let existingWallet = await StorageManager.getWallet();
        cleanupLegacyStorage();

        if (existingWallet) {
            const version = versionOf(existingWallet);
            const connection = get().connection;
            // A stored v1 wallet may have been migrated since — on the LazorKit
            // migration page, say. Then it is closed and its address is dead;
            // forget it and connect afresh, which finds the v2 wallet.
            if (version === 1 && !(await connection.getAccountInfo(new PublicKey(existingWallet.smartWallet)))) {
                await StorageManager.clearWallet();
                set({ wallet: null });
                existingWallet = null;
            } else if (!existingWallet.vaultPda) {
                // Saved by a release that did not record the vault: derive it
                // with the wallet's own protocol, so `vaultPda` is always the
                // address funds belong at.
                const [vault] = clientFor(version, connection).findVault(new PublicKey(existingWallet.smartWallet));
                existingWallet = { ...existingWallet, vaultPda: vault.toBase58() };
                await StorageManager.saveWallet(existingWallet);
            }
        }

        if (existingWallet) {
            // A connected wallet is never swapped silently for another.
            if (options?.confirmWallet && !namesWallet(existingWallet, options.confirmWallet)) {
                throw new Error(
                    `confirmWallet ${options.confirmWallet} is not the connected wallet ` +
                        `(${existingWallet.vaultPda ?? existingWallet.smartWallet}). Disconnect first to connect another.`,
                );
            }
            if (attempt.signal.aborted) throw connectAbandoned();
            set({ wallet: existingWallet });
            return existingWallet;
        }

        const connection = get().connection;
        // See ./resolveWallet: which wallet is this passkey's own is proven,
        // not guessed from the public credential hash, and a wallet the rule
        // will not adopt goes to the user. A v1 wallet made before LazorKit v2
        // keeps being used as it is; only a passkey proven to hold neither
        // gets a new (v2) wallet.
        const walletInfo = await connectFreshWallet({
            connection,
            portalUrl: config.portalUrl,
            trustedAuthorities: config.trustedAuthorities,
            watchMints: config.watchMints,
            onConfirmWallet: options?.onConfirmWallet ?? config.onConfirmWallet,
            confirmWallet: options?.confirmWallet,
            openPortal: () => createDialogManager(config),
            createWallet: async (owner) => {
                const client = clientFor(2, connection);
                const paymaster = paymasterFor(config, 2);
                const feePayer = await paymaster.getPayer();
                const { instructions, walletPda, authorityPda } = await client.createWallet({
                    payer: feePayer,
                    userSeed: randomBytes(32),
                    owner: { type: 'secp256r1', ...owner },
                });
                await buildAndSendTx({ paymaster, connection, feePayer, instructions, createsAuthority: authorityPda });
                return walletPda;
            },
            signal: attempt.signal,
        });

        if (attempt.signal.aborted) throw connectAbandoned();
        await StorageManager.saveWallet(walletInfo);
        set({ wallet: walletInfo });
        return walletInfo;

    } catch (error: unknown) {
        if (attempt.signal.aborted) {
            // Abandoned by disconnect, which already reset the store: leave
            // its `error` alone, but still fail this call.
            throw connectAbandoned();
        }
        return handleActionError(error, set, walletVersion(get));
    } finally {
        // An abandoned connect no longer owns `isConnecting`: disconnect reset
        // it, and a connect started since may have set it again.
        if (connectInFlight === attempt) {
            connectInFlight = null;
            set({ isConnecting: false });
        }
    }
};

/** `address` is this stored wallet's vault or wallet PDA. */
function namesWallet(wallet: WalletInfo, address: string): boolean {
    return address === wallet.vaultPda || address === wallet.smartWallet;
}

/**
 * Disconnect wallet action. `isSigning` is left to the action that set it, as
 * on mobile: an action already running is not abandoned (its passkey prompt
 * may still be open), and clearing its flag here would let a second one start
 * beside it, whose flag the first would then clear when it ends. (A session
 * or authority send still running neither signs nor sends after this, even
 * if its wallet is connected again by then: see ./keyBinding and
 * ./disconnects.)
 *
 * The session key the SDK keeps is deleted, unless `keepSessionKeys`: the
 * one in the slot, whichever wallet it is for, and one a `createSession`
 * still running registers after this (it is not kept: see `saveKey`). The
 * authority key is kept, and signs only once its wallet is connected again.
 * A key that cannot be deleted is logged, not thrown: it stays bound to its
 * wallet. This tab only: another tab of the app stays connected (see the
 * README).
 */
export const disconnectAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    options?: DisconnectOptions,
): Promise<void> => {
    // First: a kept key loaded before this signs and sends nothing from here on.
    noteDisconnect();
    try {
        // A connect still running is abandoned (see connectInFlight), so
        // resetting `isConnecting` below cannot let two run side by side.
        abandonConnect();
        clearPendingConfirmation();
        await StorageManager.clearWallet();
        set({ wallet: null, error: null, isConnecting: false, isLoading: false });
    } catch (error: unknown) {
        return handleActionError(error, set);
    } finally {
        // Whatever else failed: the session key goes with the wallet.
        if (!options?.keepSessionKeys) await wipeKey(keyStorageOf(get().config), 'session');
    }
};



/**
 * Sign and send transaction action.
 * Resolves on-chain wallet/authority, builds a Secp256r1 (Mode 1) challenge,
 * obtains the WebAuthn signature via the portal dialog, and submits via paymaster.
 * Resolves once the transaction is confirmed; rejects if it failed on chain.
 */
export const signAndSendTransactionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, wallet, config } = get();

    if (isSigning) {
        throw new Error('Already signing');
    }

    if (!wallet) {
        refuse(set, 'No wallet connected');
    }

    if (!connection) {
        refuse(set, 'No connection available');
    }

    set({ isSigning: true, error: null });

    try {
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        const txSignature = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareExecute({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                instructions: payload.instructions,
            });
            const encodedChallenge = toBase64Url(prepared.challenge);

            // A display-only v0 transaction so the portal can render the ixs,
            // compiled with the caller's lookup tables like the one sent.
            const latest = await connection.getLatestBlockhash();
            const base64Tx = buildPreviewTransactionBase64({
                feePayer,
                recentBlockhash: latest.blockhash,
                instructions: payload.instructions,
                addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            });

            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    base64Tx,
                    wallet.credentialId,
                    payload.transactionOptions?.clusterSimulation,
                );

                const { instructions } = client.finalizeExecute(prepared, decodeSignResult(signResult));
                return await buildAndSendTx({
                    paymaster,
                    connection,
                    feePayer,
                    instructions,
                    addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                    txVersion: payload.transactionOptions?.txVersion,
                    turn,
                });
            } finally {
                dialogManager.destroy();
            }
        });

        return txSignature;

    } catch (error: unknown) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

// ─── Helpers for decoding WebAuthn dialog response ───────────────────

function decodeSignResult(signResult: SignResult) {
    const signature = new Uint8Array(Buffer.from(signResult.signature, 'base64'));
    const authenticatorData = new Uint8Array(Buffer.from(signResult.authenticatorDataBase64, 'base64'));
    const clientDataJsonRaw = Buffer.from(signResult.clientDataJsonBase64, 'base64');
    const clientDataJsonHash = new Uint8Array(sha256.arrayBuffer(clientDataJsonRaw));
    return { signature, authenticatorData, clientDataJsonHash, clientDataJson: new Uint8Array(clientDataJsonRaw) };
}

/**
 * The connected wallet on chain, with the client for its protocol. Resolves
 * the stored wallet itself — not whichever wallet lists this passkey first,
 * which could be one someone else added the passkey to.
 */
async function resolvePasskeyWallet(wallet: WalletInfo, connection: Connection) {
    const version = versionOf(wallet);
    const client = clientFor(version, connection);
    const credentialIdHash = getCredentialHash(wallet.credentialId);
    const matches = await client.findWalletsByAuthority(credentialIdHash, 'secp256r1');
    const match = matches.find((m) => m.walletPda.toBase58() === wallet.smartWallet);
    if (!match) {
        // A v1 wallet that is gone has been migrated: the user's funds are in
        // their v2 wallet now, and the stored address is dead.
        if (version === 1 && !(await connection.getAccountInfo(new PublicKey(wallet.smartWallet)))) {
            throw new V1WalletMigratedError();
        }
        throw new Error('The connected wallet no longer lists this passkey');
    }

    // Always source the compressed secp256r1 pubkey from the on-chain authority
    // account instead of the cached `wallet.passkeyPubkey`. The cache can be
    // stale across devices / sessions, which breaks the secp256r1 precompile
    // with custom program error 0x2 (InvalidSignature).
    const publicKeyBytes = await readPasskeyPubkey(version, connection, match.authorityPda);

    return { ...match, client, version, credentialIdHash, publicKeyBytes };
}

/**
 * Create session key action — passkey signs to authorize a new ed25519 session key on-chain.
 * The key the SDK generates is kept for `signAndSendWithSession` (see ../keys:
 * a non-extractable key in IndexedDB, not localStorage). A key the caller
 * supplies is never stored.
 */
export const createSessionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: CreateSessionPayload = {}
): Promise<{ sessionPda: string; sessionPublicKey: string }> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');
    // A disconnect (or forgetStoredKeys) from here on means the key is not kept.
    const sessionWipes = wipeMark('session');

    set({ isSigning: true, error: null });
    try {
        // The limits are checked before anything is read or prompted.
        const actions = spendingLimitsToActions(payload.spendingLimits);
        if (actions.length === 0 && !payload.unrestricted) {
            throw new Error(
                'createSession needs spendingLimits. A session with no limits can spend the ' +
                    'whole vault through any program until it expires, and its key lives in the ' +
                    'app rather than behind the passkey. Pass spendingLimits (solPerTxMax, ' +
                    'solLifetimeCap, solRecurring, and tokens for each mint it may spend), or ' +
                    'unrestricted: true to mint one anyway.',
            );
        }

        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        // Resolve the session key: if the caller passed one in (delegating to
        // a backend/agent that owns the private key), we register its pubkey
        // on-chain and store nothing — the caller is responsible for keeping
        // the matching secret key. Otherwise generate a fresh key here and
        // keep it once the session is on chain.
        const externalSessionKey = resolveExternalSessionKey(payload.sessionKey);
        const generatedKey = externalSessionKey ? null : await generateKey();
        const sessionPublicKey = externalSessionKey ?? generatedKey!.signer.publicKey;

        // If a Session PDA already exists for this wallet + session pubkey,
        // the LazorKit program will reject `create` with "instruction requires
        // an uninitialized account". That's expected after a successful first
        // registration. Detect it client-side and short-circuit — no passkey
        // prompt, no wasted gas. Callers treat this identically to success.
        const [preExistingSessionPda] = client.findSession(walletPda, sessionPublicKey.toBytes());
        const preExistingAccount = await connection.getAccountInfo(preExistingSessionPda);
        if (preExistingAccount) {
            return {
                sessionPda: preExistingSessionPda.toBase58(),
                sessionPublicKey: sessionPublicKey.toBase58(),
            };
        }

        const currentSlot = await connection.getSlot();
        const expiresAt = BigInt(currentSlot) + (payload.expiresInSlots ?? DEFAULTS.SESSION_EXPIRY_SLOTS);

        const sessionPda = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareCreateSession({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                sessionKey: sessionPublicKey,
                expiresAt,
                ...(actions.length > 0 ? { actions } : { unrestricted: true as const }),
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions } = client.finalizeCreateSession(prepared, decodeSignResult(signResult));

                await buildAndSendTx({ paymaster, connection, feePayer, instructions, turn });
                return prepared.sessionPda;
            } finally {
                dialogManager.destroy();
            }
        });

        // Only the key generated here is kept. External keys belong to the
        // caller; storing them in the user's browser would be a security
        // footgun (e.g. the backend's key ending up in browser). The session
        // is on chain now: a key that cannot be stored is kept for this page,
        // and the call still succeeds.
        if (generatedKey) {
            // Bound to the wallet it was made for: it signs only while that
            // wallet is connected (./keyBinding). Not kept at all when the
            // user disconnected (or forgetStoredKeys ran) since this started.
            const kept = await saveKey(keyStorageOf(config), 'session', generatedKey, {
                sessionPda: sessionPda.toBase58(),
                walletPda: walletPda.toBase58(),
                bound: true,
                expiresAt: expiresAt.toString(),
                spendingLimits: spendingLimitsRecord(payload.spendingLimits),
            }, { unlessWipedSince: sessionWipes });
            if (kept === 'discarded') {
                console.warn(
                    `[LazorKit] Session ${sessionPda.toBase58()} landed after disconnect() or forgetStoredKeys() ` +
                        `deleted the kept keys, so its key was not kept. The session stays on chain until it ` +
                        `expires; revokeSession({ sessionPda }) closes it sooner.`,
                );
            }
        }

        return { sessionPda: sessionPda.toBase58(), sessionPublicKey: sessionPublicKey.toBase58() };
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/** Accept either a base58 string or a `PublicKey`. Returns `null` for undefined. */
function resolveExternalSessionKey(input: CreateSessionPayload['sessionKey']): PublicKey | null {
    if (!input) return null;
    if (typeof input === 'string') return new PublicKey(input);
    return input;
}

/**
 * Revoke session action — passkey signs to revoke the stored session key.
 */
export const revokeSessionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: RevokeSessionPayload = {}
): Promise<void> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    try {
        // Two paths:
        //   (a) External sessionPda passed in → revoke that specific session.
        //       walletPda comes from the wallet record on-chain (resolved
        //       below via credential-hash lookup).
        //   (b) No arg → revoke the session whose key the SDK keeps, which
        //       must be the connected wallet's (an expired one is deleted).
        const external = payload.sessionPda
            ? typeof payload.sessionPda === 'string'
                ? new PublicKey(payload.sessionPda)
                : payload.sessionPda
            : null;

        // The kept session first: one of another wallet is refused before
        // anything is read for the passkey, let alone prompted.
        const stored = external
            ? null
            : await keyForConnectedWallet({ get, slot: 'session', storage: keyStorageOf(config), connection });
        if (!external && !stored) throw new Error('No session key found');

        const resolved = await resolvePasskeyWallet(wallet, connection);
        const { client, version, authorityPda, publicKeyBytes, credentialIdHash } = resolved;
        const sessionPda = external ?? new PublicKey(stored!.info.sessionPda);
        const walletPda = external ? resolved.walletPda : new PublicKey(stored!.info.walletPda);

        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareRevokeSession({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                sessionPda,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions } = client.finalizeRevokeSession(prepared, decodeSignResult(signResult));

                await buildAndSendTx({ paymaster, connection, feePayer, instructions, turn });
            } finally {
                dialogManager.destroy();
            }
        });

        // The session is closed: its key, if it is the one the SDK keeps, is
        // of no use any more. Another session's key is left alone.
        const revoked = sessionPda.toBase58();
        await forgetKey(keyStorageOf(config), 'session', (info) => info.sessionPda === revoked);
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign and send transaction using the stored session key (no passkey required).
 * A plaintext key an earlier release left in localStorage is moved first. The
 * key signs only while the wallet it was made for is connected
 * (`KeyWalletMismatchError` otherwise, nothing signed or sent), and an expired
 * session's key is deleted.
 */
export const signAndSendWithSessionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
        const stored = await keyForConnectedWallet({ get, slot: 'session', storage: keyStorageOf(config), connection });
        if (!stored) throw new Error('No session key found. Create a session first.');
        const sessionKey = stored.signer;
        const sessionPda = new PublicKey(stored.info.sessionPda);
        const walletPda = new PublicKey(stored.info.walletPda);

        // A stored session may predate v2; its owner says which program it is.
        const version = await versionOfAccount(connection, sessionPda);
        flowVersion = version;
        // Every attempt to send checks the key again (see paymasterFor).
        const paymaster = paymasterFor(config, version, { beforeAttempt: stored.assertSendable });
        const client = clientFor(version, connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.execute({
            payer: feePayer,
            walletPda,
            signer: { type: 'session', sessionPda, sessionKeyPubkey: sessionKey.publicKey },
            instructions: payload.instructions,
        });

        const txSignature = await buildAndSendTx({
            paymaster,
            connection,
            feePayer,
            instructions,
            signers: [sessionKey],
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            txVersion: payload.transactionOptions?.txVersion,
        });
        return txSignature;
    } catch (error) {
        // A session's actions name what may leave the vault (3037 / 3038).
        return handleActionError(toPolicyError(error, 'session'), set, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Why `role` is not one `method` can give a new authority on a wallet of
 * `version`, or null when it is: one of the three ranks the program knows,
 * except an Owner on v2, which the protocol SDK adds only on an explicit
 * opt-in this method does not pass. There is no default: the rank decides
 * what the key may do to the wallet, so the caller names it. Checked before
 * anything is read or prompted.
 */
export function authorityRoleProblem(role: unknown, method: string, version: ProtocolVersion): string | null {
    const ranks: unknown[] = version === 2 ? [ROLE_ADMIN, ROLE_SPENDER] : [ROLE_OWNER, ROLE_ADMIN, ROLE_SPENDER];
    if (ranks.includes(role)) return null;
    const what =
        role === undefined
            ? `${method} needs a role: the rank the new key gets on the wallet. There is no default.`
            : role === ROLE_OWNER
                ? `${method} does not add an Owner to a LazorKit v2 wallet: an Owner could remove every other authority, this passkey included.`
                : `${method}: ${typeof role === 'number' ? role : JSON.stringify(role)} is not a role.`;
    const owner =
        'ROLE_OWNER (0), which adds and removes any authority, other owners included (never the last owner), and spends without limit';
    const admin = 'ROLE_ADMIN (1), which adds and removes delegates only, and spends without limit';
    const spender =
        'ROLE_SPENDER (2), the delegate rank, which manages no authority and spends only within its policy ' +
        '(required for this rank on v2: build it with serializeActions([...]))';
    const choices =
        version === 2
            ? `Pass one of: ${admin}; ${spender}. On a v2 wallet ${method} never adds ${owner}.`
            : `Pass one of: ${owner}; ${admin}; ${spender}.`;
    return `${what} ${choices} For a key your app holds, use ROLE_SPENDER with a policy.`;
}

/**
 * Add ed25519 authority action — passkey signs to authorize a new ed25519 authority on-chain.
 * The key the SDK generates is kept for `signAndSendWithAuthority` (see
 * ../keys: a non-extractable key in IndexedDB, not localStorage), bound to
 * the connected wallet. `payload.role` is required: a missing or unknown one
 * is refused before anything is read or prompted.
 */
export const addAuthorityAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: AddAuthorityPayload
): Promise<{ authorityPda: string; authorityPublicKey: string }> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');
    const roleProblem = authorityRoleProblem(payload?.role, 'addAuthority', versionOf(wallet));
    if (roleProblem) refuse(set, roleProblem);
    const role = payload.role;
    // forgetStoredKeys from here on means the key is not kept.
    const authorityWipes = wipeMark('authority');

    set({ isSigning: true, error: null });
    try {
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        // v1 has no spending policies, and its Execute never checked rank: any
        // key added to a v1 wallet can move the whole vault. Refuse to pretend
        // otherwise — a policy would be dropped without a word.
        if (version === 1 && payload.policy) {
            throw new Error(
                'This wallet is on LazorKit v1, which cannot limit what an added key may spend. ' +
                    'Move the wallet to v2 first, or add the key without a policy and unrestricted: true.',
            );
        }
        if (version === 1 && !payload.unrestricted) {
            throw new Error(
                'On a LazorKit v1 wallet any added key can spend the whole vault. Pass ' +
                    'unrestricted: true to add one anyway, or move the wallet to v2 for bounded keys.',
            );
        }
        const authorityKey = await generateKey();

        const newAuthorityPda = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareAddAuthority({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                newAuthority: { type: 'ed25519', publicKey: authorityKey.signer.publicKey },
                role,
                policy: payload.policy,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions } = client.finalizeAddAuthority(prepared, decodeSignResult(signResult));

                await buildAndSendTx({ paymaster, connection, feePayer, instructions, turn });
                return prepared.newAuthorityPda;
            } finally {
                dialogManager.destroy();
            }
        });

        // On chain now: a key that cannot be stored is kept for this page, and
        // the call still succeeds. Not kept at all when forgetStoredKeys ran
        // since this started.
        const kept = await saveKey(keyStorageOf(config), 'authority', authorityKey, {
            authorityPda: newAuthorityPda.toBase58(),
            walletPda: walletPda.toBase58(),
            bound: true,
            role,
        }, { unlessWipedSince: authorityWipes });
        if (kept === 'discarded') {
            console.warn(
                `[LazorKit] Authority ${newAuthorityPda.toBase58()} landed after forgetStoredKeys() deleted the ` +
                    `kept keys, so its key was not kept. The authority stays on the wallet with no one holding ` +
                    `its key; removeAuthority({ targetAuthorityPda }) removes it.`,
            );
        }

        return { authorityPda: newAuthorityPda.toBase58(), authorityPublicKey: authorityKey.signer.publicKey.toBase58() };
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Remove an authority account — passkey signs to remove a target authority PDA.
 */
export const removeAuthorityAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: { targetAuthorityPda: string }
): Promise<void> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    try {
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();
        const targetAuthorityPda = new PublicKey(payload.targetAuthorityPda);

        await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareRemoveAuthority({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                targetAuthorityPda,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions } = client.finalizeRemoveAuthority(prepared, decodeSignResult(signResult));

                await buildAndSendTx({ paymaster, connection, feePayer, instructions, turn });
            } finally {
                dialogManager.destroy();
            }
        });

        // A removed authority's key can never sign again: if it is the one the
        // SDK keeps, it goes too.
        const removed = targetAuthorityPda.toBase58();
        await forgetKey(keyStorageOf(config), 'authority', (info) => info.authorityPda === removed);
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Authorize + Execute deferred — passkey signs TX1 (authorize), then executes TX2
 * once TX1 is confirmed (TX2 spends the authorization TX1 writes).
 * Demonstrates that TX2 requires no passkey (could be submitted by anyone).
 *
 * The authorization is open for `expiryOffset` slots (default
 * `DEFAULTS.DEFERRED_EXPIRY_SLOTS`), longer than the wallet can wait for TX1.
 * When it has expired anyway, TX2 is not sent (or its 3014 is reported) as
 * `DeferredExpiredError`, with TX1's signature and the account holding the rent.
 */
export const authorizeAndExecuteAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: AuthorizeAndExecutePayload
): Promise<string> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    try {
        const expiryOffset = deferredExpiryOffset(payload.expiryOffset);
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        const txSignature = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareAuthorize({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                instructions: payload.instructions,
                expiryOffset,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions: authorizeIxs, deferredExecPda, deferredPayload } = client.finalizeAuthorize(
                    prepared,
                    decodeSignResult(signResult),
                );

                // TX1 is confirmed before TX2 is built or sent: TX2 executes the
                // authorization TX1 writes, and a paymaster simulating TX2
                // before TX1 has executed rejects it.
                const txVersion = payload.transactionOptions?.txVersion;
                const authorizeSignature = await buildAndSendTx({
                    paymaster,
                    connection,
                    feePayer,
                    instructions: authorizeIxs,
                    txVersion,
                    turn,
                });

                // TX2 consumes no counter. The same client built TX1, so the
                // fee accounts it resolves are the ones TX1 used (no re-read).
                const { instructions: execIxs } = await client.executeDeferredFromPayload({
                    payer: feePayer,
                    deferredPayload,
                });

                return await executeBeforeExpiry({
                    connection,
                    deferredExecPda,
                    authorizeSignature,
                    send: () =>
                        buildAndSendTx({
                            paymaster,
                            connection,
                            feePayer,
                            instructions: execIxs,
                            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                            txVersion,
                        }),
                });
            } finally {
                dialogManager.destroy();
            }
        });

        return txSignature;
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Authorize only (TX1 of deferred execution) — passkey signs to register a
 * deferred-exec PDA on-chain. Returns a serialized deferredPayload that can
 * be persisted, sent to another device, and redeemed later via
 * `executeDeferred` without touching the passkey again.
 */
export const authorizeDeferredAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: AuthorizeDeferredPayload,
): Promise<{ signature: string; deferredPayload: string }> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) refuse(set, 'No wallet connected');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    try {
        const expiryOffset = deferredExpiryOffset(payload.expiryOffset);
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        const { signature, deferredPayload } = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareAuthorize({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                instructions: payload.instructions,
                expiryOffset,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);
            const dialogManager = createDialogManager(config);
            try {
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    '',
                    wallet.credentialId,
                    undefined,
                );

                const { instructions: authorizeIxs, deferredPayload } = client.finalizeAuthorize(prepared, decodeSignResult(signResult));

                // Confirmed before this resolves, so an `executeDeferred` made
                // right after finds the authorization on chain.
                const signature = await buildAndSendTx({
                    paymaster,
                    connection,
                    feePayer,
                    instructions: authorizeIxs,
                    txVersion: payload.transactionOptions?.txVersion,
                    turn,
                });
                return { signature, deferredPayload };
            } finally {
                dialogManager.destroy();
            }
        });

        const serialized = serializeDeferred(version, deferredPayload);
        return { signature, deferredPayload: serialized };
    } catch (error) {
        return handleActionError(error, set, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Execute deferred (TX2 of deferred execution) — submits a previously-authorized
 * deferredPayload. No passkey required; anyone with the serialized payload
 * can broadcast this transaction.
 */
export const executeDeferredAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: ExecuteDeferredPayload,
): Promise<string> => {
    const { isSigning, connection, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
        const { version, payload: deferredPayload } = deserializeDeferred(payload.deferredPayload);
        flowVersion = version;
        const paymaster = paymasterFor(config, version);
        const client = clientFor(version, connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.executeDeferredFromPayload({
            payer: feePayer,
            deferredPayload,
        });

        // An expired authorization is refused before it is sent, or its
        // 3014 reported, as `DeferredExpiredError`.
        const signature = await executeBeforeExpiry({
            connection,
            deferredExecPda: deferredPayload.deferredExecPda,
            send: () =>
                buildAndSendTx({
                    paymaster,
                    connection,
                    feePayer,
                    instructions,
                    addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                    txVersion: payload.transactionOptions?.txVersion,
                }),
        });

        return signature;
    } catch (error) {
        return handleActionError(error, set, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign and send transaction using the stored ed25519 authority key (no passkey required).
 * A plaintext key an earlier release left in localStorage is moved first. The
 * key signs only while the wallet it was added to is connected
 * (`KeyWalletMismatchError` otherwise, nothing signed or sent).
 */
export const signAndSendWithAuthorityAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!connection) refuse(set, 'No connection available');

    set({ isSigning: true, error: null });
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    // The kept key's rank, as recorded when it was added.
    let role: number | undefined;
    try {
        const stored = await keyForConnectedWallet({ get, slot: 'authority', storage: keyStorageOf(config), connection });
        if (!stored) throw new Error('No authority key found. Add an authority first.');
        role = stored.info.role;
        const authorityKey = stored.signer;
        const authorityPda = new PublicKey(stored.info.authorityPda);
        const walletPda = new PublicKey(stored.info.walletPda);

        const version = await versionOfAccount(connection, authorityPda);
        flowVersion = version;
        // Every attempt to send checks the key again (see paymasterFor).
        const paymaster = paymasterFor(config, version, { beforeAttempt: stored.assertSendable });
        const client = clientFor(version, connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.execute({
            payer: feePayer,
            walletPda,
            signer: { type: 'ed25519', publicKey: authorityKey.publicKey, authorityPda },
            instructions: payload.instructions,
        });

        const txSignature = await buildAndSendTx({
            paymaster,
            connection,
            feePayer,
            instructions,
            signers: [authorityKey],
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            txVersion: payload.transactionOptions?.txVersion,
        });
        return txSignature;
    } catch (error) {
        // A delegate's policy names what may leave the vault (3037 / 3038). An
        // Admin key has no policy: a 3037 / 3038 is LazorKit's only when the
        // logs say so. A record with no role is taken as a delegate's.
        const hasPolicy = role === undefined || role === ROLE_SPENDER;
        return handleActionError(toPolicyError(error, 'authority', hasPolicy), set, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign message action. The passkey signs `signedMessageChallenge(message)`,
 * not the message's bytes (see core/message/signedMessage.ts); check the
 * result with `verifyWalletMessage`.
 */
export const signMessageAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    message: string
): Promise<SignMessageResult> => {
    const { isSigning, wallet, config } = get();

    if (isSigning) {
        throw new Error('Already signing');
    }

    if (!wallet) {
        refuse(set, 'No wallet connected');
    }

    set({ isSigning: true, error: null });

    try {
        const dialogManager = createDialogManager(config);

        try {
            const signResult = await dialogManager.openSignMessage(message, wallet.credentialId);
            return {
                signature: signResult.signature,
                signedPayload: signResult.signedPayload,
                clientDataJsonBase64: signResult.clientDataJsonBase64,
                authenticatorDataBase64: signResult.authenticatorDataBase64,
            };
        } finally {
            dialogManager.destroy();
        }
    } catch (error: unknown) {
        set({ error: error as Error });
        throw error;
    } finally {
        set({ isSigning: false });
    }
};
