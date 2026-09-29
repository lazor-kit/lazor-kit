/**
 * SDK Actions - Core wallet operations
 */
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';
import {
    Transaction,
    TransactionMessage,
    VersionedTransaction,
    Keypair,
    PublicKey,
    AddressLookupTableAccount,
    TransactionInstruction,
    Connection,
} from '@solana/web3.js';
import { SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from '../paymaster/paymaster';
import { WalletState, ConnectOptions, DisconnectOptions, SignAndSendTransactionPayload, CreateSessionPayload, RevokeSessionPayload, AddAuthorityPayload, AuthorizeDeferredPayload, ExecuteDeferredPayload } from '../types';
import {
    createDialogManager,
    getCredentialHash,
    handleActionError,
    cleanupLegacyStorage,
} from './utils';
import { clearPendingConfirmation, connectAbandoned, connectFreshWallet } from './resolveWallet';
import {
    ROLE_ADMIN,
    Actions,
    SessionAction,
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
import { SpendingLimits } from '../types';
import { DEFAULTS } from '../../config';
import { type AuthorityTurn, confirmOrThrow, noteAuthorityLanded, withAuthority } from './sequence';

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

/** The connected wallet's protocol, for error reporting. */
function walletVersion(get: () => WalletState): ProtocolVersion | undefined {
    const wallet = get().wallet;
    return wallet ? versionOf(wallet) : undefined;
}

/**
 * The paymaster for a wallet's protocol. v1 wallets keep the relayer the app
 * used before v2 (`v1PaymasterConfig`, defaulting to the main one).
 */
function paymasterFor(config: WalletConfig, version: ProtocolVersion): Paymaster {
    return new Paymaster(
        version === 1 ? (config.v1PaymasterConfig ?? config.paymasterConfig) : config.paymasterConfig,
    );
}

/**
 * Builds a transaction in either legacy or v0 wire format, submits it through
 * the paymaster, and resolves once it is confirmed (see ./sequence). It
 * rejects when the transaction failed on chain or expired without landing:
 * a paymaster's answer only says the RPC accepted it. Default is v0 (matches
 * mobile-wallet-adapter).
 *
 * `turn`: the lane of the passkey authority whose counter this transaction
 * consumes. The next challenge for that passkey is then read from state that
 * includes it.
 *
 * For session/authority flows that need a client-side signer in addition to
 * the paymaster's feePayer, pass it in `extraSigners` — both v0 (`tx.sign`)
 * and legacy (`tx.partialSign`) populate the right slot.
 */
async function buildAndSendTx(params: {
    paymaster: Paymaster;
    connection: Connection;
    feePayer: PublicKey;
    instructions: TransactionInstruction[];
    extraSigners?: Keypair[];
    addressLookupTables?: AddressLookupTableAccount[];
    txVersion?: 'legacy' | 'v0';
    turn?: AuthorityTurn;
    /** A passkey authority this transaction creates: its first challenge is read at or past the creation. */
    createsAuthority?: PublicKey;
}): Promise<string> {
    const { paymaster, connection, feePayer, instructions } = params;
    const extraSigners = params.extraSigners ?? [];
    const txVersion = params.txVersion ?? 'v0';
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    let signature: string;
    if (txVersion === 'legacy') {
        if ((params.addressLookupTables?.length ?? 0) > 0) {
            throw new Error('Address lookup tables are only supported with txVersion="v0"');
        }
        const tx = new Transaction();
        tx.add(...instructions);
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayer;
        if (extraSigners.length > 0) tx.partialSign(...extraSigners);
        signature = await paymaster.signAndSend(tx);
    } else {
        const v0Message = new TransactionMessage({
            payerKey: feePayer,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message(params.addressLookupTables ?? []);
        const tx = new VersionedTransaction(v0Message);
        if (extraSigners.length > 0) tx.sign(extraSigners);
        signature = await paymaster.signAndSendVersionedTransaction(tx);
    }

    const sent = { signature, blockhash, lastValidBlockHeight };
    if (params.turn) return params.turn.confirm(connection, sent);
    const slot = await confirmOrThrow(connection, sent);
    if (params.createsAuthority) noteAuthorityLanded(params.createsAuthority, slot);
    return signature;
}


/**
 * The store's connect in flight, if any. `disconnect` aborts it: its portal or
 * chooser closes and it saves nothing — so no wallet arrives after the user
 * disconnected, or beside a connect started after that. (The store is one per
 * page, as is this.)
 */
let connectInFlight: AbortController | null = null;

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
            options?.onSuccess?.(existingWallet);
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
        options?.onSuccess?.(walletInfo);
        return walletInfo;

    } catch (error: unknown) {
        if (attempt.signal.aborted) {
            // Abandoned by disconnect, which already reset the store: leave
            // its `error` alone, but still fail this call.
            const err = connectAbandoned();
            options?.onFail?.(err);
            throw err;
        }
        return handleActionError(error, set, options?.onFail, walletVersion(get));
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
 * Disconnect wallet action
 */
export const disconnectAction = async (
    set: (state: Partial<WalletState>) => void,
    options?: DisconnectOptions
): Promise<void> => {

    try {
        // A connect still running is abandoned (see connectInFlight), so
        // resetting `isConnecting` below cannot let two run side by side.
        connectInFlight?.abort();
        connectInFlight = null;
        clearPendingConfirmation();
        await StorageManager.clearWallet();
        set({ wallet: null, error: null, isConnecting: false, isSigning: false, isLoading: false });
        options?.onSuccess?.();
    } catch (error: unknown) {
        return handleActionError(error, set, options?.onFail);
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
        throw new Error('No wallet connected');
    }

    if (!connection) {
        throw new Error('No connection available');
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

            // Build a display-only v0 transaction so the portal can render the ixs.
            const latest = await connection.getLatestBlockhash();
            const displayMessage = new TransactionMessage({
                payerKey: feePayer,
                recentBlockhash: latest.blockhash,
                instructions: payload.instructions,
            }).compileToV0Message();
            const base64Tx = Buffer.from(new VersionedTransaction(displayMessage).serialize()).toString('base64');

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

        payload.onSuccess?.(txSignature);
        return txSignature;

    } catch (error: unknown) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

// ─── Spending limits → SessionAction[] ───────────────────────────────

function buildSessionActions(limits?: SpendingLimits): SessionAction[] {
    if (!limits) return [];
    const actions: SessionAction[] = [];
    if (limits.solLifetimeCap !== undefined) {
        actions.push(Actions.solLimit(limits.solLifetimeCap));
    }
    if (limits.solPerTxMax !== undefined) {
        actions.push(Actions.solMaxPerTx(limits.solPerTxMax));
    }
    if (limits.solRecurring) {
        actions.push(Actions.solRecurringLimit({
            limit: limits.solRecurring.limit,
            window: limits.solRecurring.windowSlots,
        }));
    }
    // NOTE: do NOT auto-append a ProgramWhitelist here. Adding any
    // whitelist entry switches the session from "allow all programs" to
    // "only allow listed programs" — callers that just want SOL spending
    // caps would lose the ability to call SPL Token, ATA, Raydium, etc.
    // Callers who need a whitelist can extend `SpendingLimits` with an
    // explicit `programAllowlist` field and build `Actions.programWhitelist`
    // entries themselves.
    return actions;
}

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
 * The generated keypair is stored in localStorage for reuse.
 */
export const createSessionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: CreateSessionPayload = {}
): Promise<{ sessionPda: string; sessionPublicKey: string }> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    try {
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();

        // Resolve the session key: if the caller passed one in (delegating to
        // a backend/agent that owns the private key), we register its pubkey
        // on-chain and skip the localStorage write — the caller is responsible
        // for keeping the matching secretKey. Otherwise generate a fresh
        // keypair here and persist it as before.
        const externalSessionKey = resolveExternalSessionKey(payload.sessionKey);
        const sessionKeypair = externalSessionKey ? null : Keypair.generate();
        const sessionPublicKey = externalSessionKey ?? sessionKeypair!.publicKey;

        // If a Session PDA already exists for this wallet + session pubkey,
        // the LazorKit program will reject `create` with "instruction requires
        // an uninitialized account". That's expected after a successful first
        // registration. Detect it client-side and short-circuit — no passkey
        // prompt, no wasted gas. Callers treat this identically to success.
        const [preExistingSessionPda] = client.findSession(walletPda, sessionPublicKey.toBytes());
        const preExistingAccount = await connection.getAccountInfo(preExistingSessionPda);
        if (preExistingAccount) {
            payload.onSuccess?.(preExistingSessionPda.toBase58(), sessionPublicKey.toBase58());
            return {
                sessionPda: preExistingSessionPda.toBase58(),
                sessionPublicKey: sessionPublicKey.toBase58(),
            };
        }

        const currentSlot = await connection.getSlot();
        const expiresAt = BigInt(currentSlot) + (payload.expiresInSlots ?? DEFAULTS.SESSION_EXPIRY_SLOTS);
        const actions = buildSessionActions(payload.spendingLimits);

        if (actions.length === 0 && !payload.unrestricted) {
            throw new Error(
                'createSession needs spendingLimits. A session with no limits can spend the ' +
                    'whole vault through any program until it expires, and its key lives in the ' +
                    'app rather than behind the passkey. Pass spendingLimits (solPerTxMax, ' +
                    'solLifetimeCap, solRecurring), or unrestricted: true to mint one anyway.',
            );
        }

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

        // Only persist the locally-generated keypair. External keys belong
        // to the caller; writing them to the user's localStorage would be
        // a security footgun (e.g. the backend's key ending up in browser).
        if (sessionKeypair) {
            localStorage.setItem('lazorkit-session', JSON.stringify({
                secretKey: Array.from(sessionKeypair.secretKey),
                publicKey: sessionKeypair.publicKey.toBase58(),
                sessionPda: sessionPda.toBase58(),
                walletPda: walletPda.toBase58(),
                expiresAt: expiresAt.toString(),
                spendingLimits: payload.spendingLimits ? {
                    solLifetimeCap: payload.spendingLimits.solLifetimeCap?.toString(),
                    solPerTxMax: payload.spendingLimits.solPerTxMax?.toString(),
                    solRecurring: payload.spendingLimits.solRecurring
                        ? {
                            limit: payload.spendingLimits.solRecurring.limit.toString(),
                            windowSlots: payload.spendingLimits.solRecurring.windowSlots.toString(),
                        }
                        : undefined,
                } : undefined,
            }));
        }

        payload.onSuccess?.(sessionPda.toBase58(), sessionPublicKey.toBase58());
        return { sessionPda: sessionPda.toBase58(), sessionPublicKey: sessionPublicKey.toBase58() };
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
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
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    try {
        // Two paths:
        //   (a) External sessionPda passed in → revoke that specific session.
        //       walletPda comes from the wallet record on-chain (resolved
        //       below via credential-hash lookup).
        //   (b) No arg → revoke the SDK-managed session in localStorage.
        const external = payload.sessionPda
            ? typeof payload.sessionPda === 'string'
                ? new PublicKey(payload.sessionPda)
                : payload.sessionPda
            : null;

        const resolved = await resolvePasskeyWallet(wallet, connection);
        const { client, version, authorityPda, publicKeyBytes, credentialIdHash } = resolved;

        let sessionPda: PublicKey;
        let walletPda: PublicKey;
        if (external) {
            sessionPda = external;
            walletPda = resolved.walletPda;
        } else {
            const sessionRaw = localStorage.getItem('lazorkit-session');
            if (!sessionRaw) throw new Error('No session key found');
            const sessionInfo = JSON.parse(sessionRaw);
            sessionPda = new PublicKey(sessionInfo.sessionPda);
            walletPda = new PublicKey(sessionInfo.walletPda);
        }

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

        // Only clear localStorage when we revoked an SDK-managed session.
        if (!external) localStorage.removeItem('lazorkit-session');
        payload.onSuccess?.();
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign and send transaction using the stored session key (no passkey required).
 */
export const signAndSendWithSessionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
        const sessionRaw = localStorage.getItem('lazorkit-session');
        if (!sessionRaw) throw new Error('No session key found. Create a session first.');
        const sessionInfo = JSON.parse(sessionRaw);
        const sessionKeypair = Keypair.fromSecretKey(new Uint8Array(sessionInfo.secretKey));
        const sessionPda = new PublicKey(sessionInfo.sessionPda);
        const walletPda = new PublicKey(sessionInfo.walletPda);

        // A stored session may predate v2; its owner says which program it is.
        const version = await versionOfAccount(connection, sessionPda);
        flowVersion = version;
        const paymaster = paymasterFor(config, version);
        const client = clientFor(version, connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.execute({
            payer: feePayer,
            walletPda,
            signer: { type: 'session', sessionPda, sessionKeyPubkey: sessionKeypair.publicKey },
            instructions: payload.instructions,
        });

        const txSignature = await buildAndSendTx({
            paymaster,
            connection,
            feePayer,
            instructions,
            extraSigners: [sessionKeypair],
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            txVersion: payload.transactionOptions?.txVersion,
        });
        payload.onSuccess?.(txSignature);
        return txSignature;
    } catch (error) {
        return handleActionError(error, set, payload.onFail, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Add ed25519 authority action — passkey signs to authorize a new ed25519 authority on-chain.
 * The generated keypair is stored in localStorage for reuse.
 */
export const addAuthorityAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: AddAuthorityPayload = {}
): Promise<{ authorityPda: string; authorityPublicKey: string }> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    try {
        const { client, version, walletPda, authorityPda, publicKeyBytes, credentialIdHash } =
            await resolvePasskeyWallet(wallet, connection);
        const paymaster = paymasterFor(config, version);
        const feePayer = await paymaster.getPayer();
        const authorityKeypair = Keypair.generate();
        const role = payload.role ?? ROLE_ADMIN;

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

        const newAuthorityPda = await withAuthority(authorityPda, async (turn) => {
            const prepared = await client.prepareAddAuthority({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda, ...(await turn.challengeReads(connection)) },
                newAuthority: { type: 'ed25519', publicKey: authorityKeypair.publicKey },
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

        localStorage.setItem('lazorkit-authority', JSON.stringify({
            secretKey: Array.from(authorityKeypair.secretKey),
            publicKey: authorityKeypair.publicKey.toBase58(),
            authorityPda: newAuthorityPda.toBase58(),
            walletPda: walletPda.toBase58(),
            role,
        }));

        payload.onSuccess?.(newAuthorityPda.toBase58(), authorityKeypair.publicKey.toBase58());
        return { authorityPda: newAuthorityPda.toBase58(), authorityPublicKey: authorityKeypair.publicKey.toBase58() };
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
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
    payload: {
        targetAuthorityPda: string;
        onSuccess?: () => void;
        onFail?: (error: Error) => void;
    }
): Promise<void> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

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

        payload.onSuccess?.();
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Authorize + Execute deferred — passkey signs TX1 (authorize), then executes TX2
 * once TX1 is confirmed (TX2 spends the authorization TX1 writes).
 * Demonstrates that TX2 requires no passkey (could be submitted by anyone).
 */
export const authorizeAndExecuteAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, wallet, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    try {
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

                // TX1 is confirmed before TX2 is built or sent: TX2 executes the
                // authorization TX1 writes, and a paymaster simulating TX2
                // before TX1 has executed rejects it.
                const txVersion = payload.transactionOptions?.txVersion;
                await buildAndSendTx({
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

                return await buildAndSendTx({
                    paymaster,
                    connection,
                    feePayer,
                    instructions: execIxs,
                    addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                    txVersion,
                });
            } finally {
                dialogManager.destroy();
            }
        });

        payload.onSuccess?.(txSignature);
        return txSignature;
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
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
    if (!wallet) throw new Error('No wallet connected');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    try {
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
        payload.onSuccess?.({ signature, deferredPayload: serialized });
        return { signature, deferredPayload: serialized };
    } catch (error) {
        return handleActionError(error, set, payload.onFail, walletVersion(get));
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
    if (!connection) throw new Error('No connection available');

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

        const signature = await buildAndSendTx({
            paymaster,
            connection,
            feePayer,
            instructions,
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            txVersion: payload.transactionOptions?.txVersion,
        });

        payload.onSuccess?.(signature);
        return signature;
    } catch (error) {
        return handleActionError(error, set, payload.onFail, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign and send transaction using the stored ed25519 authority keypair (no passkey required).
 */
export const signAndSendWithAuthorityAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    payload: SignAndSendTransactionPayload
): Promise<string> => {
    const { isSigning, connection, config } = get();
    if (isSigning) throw new Error('Already signing');
    if (!connection) throw new Error('No connection available');

    set({ isSigning: true, error: null });
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
        const authRaw = localStorage.getItem('lazorkit-authority');
        if (!authRaw) throw new Error('No authority key found. Add an authority first.');
        const authInfo = JSON.parse(authRaw);
        const authorityKeypair = Keypair.fromSecretKey(new Uint8Array(authInfo.secretKey));
        const authorityPda = new PublicKey(authInfo.authorityPda);
        const walletPda = new PublicKey(authInfo.walletPda);

        const version = await versionOfAccount(connection, authorityPda);
        flowVersion = version;
        const paymaster = paymasterFor(config, version);
        const client = clientFor(version, connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.execute({
            payer: feePayer,
            walletPda,
            signer: { type: 'ed25519', publicKey: authorityKeypair.publicKey, authorityPda },
            instructions: payload.instructions,
        });

        const txSignature = await buildAndSendTx({
            paymaster,
            connection,
            feePayer,
            instructions,
            extraSigners: [authorityKeypair],
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            txVersion: payload.transactionOptions?.txVersion,
        });
        payload.onSuccess?.(txSignature);
        return txSignature;
    } catch (error) {
        return handleActionError(error, set, payload.onFail, flowVersion ?? walletVersion(get));
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Sign message action
 */
export const signMessageAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    message: string
): Promise<{ signature: string, signedPayload: string }> => {
    const { isSigning, wallet, config } = get();

    if (isSigning) {
        throw new Error('Already signing');
    }

    if (!wallet) {
        throw new Error('No wallet connected');
    }

    set({ isSigning: true, error: null });

    try {
        const dialogManager = createDialogManager(config);

        try {
            const signResult = await dialogManager.openSignMessage(message, wallet.credentialId);
            return { signature: signResult.signature, signedPayload: signResult.signedPayload };
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
