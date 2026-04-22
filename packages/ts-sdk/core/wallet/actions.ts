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
    SystemProgram,
    AddressLookupTableAccount,
    TransactionInstruction,
    Connection,
} from '@solana/web3.js';
import { DialogResult, SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from '../paymaster/paymaster';
import { WalletState, ConnectOptions, DisconnectOptions, SignAndSendTransactionPayload, CreateSessionPayload, RevokeSessionPayload, AddAuthorityPayload, AuthorizeDeferredPayload, ExecuteDeferredPayload } from '../types';
import {
    createDialogManager,
    getCredentialHash,
    handleActionError,
    cleanupLegacyStorage,
    getPasskeyPublicKey
} from './utils';
import { LazorKitClient, ROLE_ADMIN, Actions, SessionAction, readAuthorityPubkey, serializeDeferredPayload, deserializeDeferredPayload } from '../program';
import { SpendingLimits } from '../types';

/** WebAuthn RP ID used by the Lazor portal. WebAuthn does not allow ports — use hostname only. */
const LAZOR_RP_ID = 'portal.lazor.sh';

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
 * Builds a transaction in either legacy or v0 wire format and submits it
 * through the paymaster. Default is v0 (matches mobile-wallet-adapter).
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
}): Promise<string> {
    const { paymaster, connection, feePayer, instructions } = params;
    const extraSigners = params.extraSigners ?? [];
    const txVersion = params.txVersion ?? 'v0';
    const { blockhash } = await connection.getLatestBlockhash();

    if (txVersion === 'legacy') {
        if ((params.addressLookupTables?.length ?? 0) > 0) {
            throw new Error('Address lookup tables are only supported with txVersion="v0"');
        }
        const tx = new Transaction();
        tx.add(...instructions);
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayer;
        if (extraSigners.length > 0) tx.partialSign(...extraSigners);
        return paymaster.signAndSend(tx);
    }

    const v0Message = new TransactionMessage({
        payerKey: feePayer,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message(params.addressLookupTables ?? []);
    const tx = new VersionedTransaction(v0Message);
    if (extraSigners.length > 0) tx.sign(extraSigners);
    return paymaster.signAndSendVersionedTransaction(tx);
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

    set({ isConnecting: true, error: null });

    try {
        const existingWallet = await StorageManager.getWallet();
        cleanupLegacyStorage();

        if (existingWallet) {
            set({ wallet: existingWallet });
            options?.onSuccess?.(existingWallet);
            return existingWallet;
        }

        const dialogManager = createDialogManager(config);

        try {
            const dialogResult: DialogResult = await dialogManager.openConnect();
            const paymaster = new Paymaster(config.paymasterConfig);
            const client = new LazorKitClient(get().connection);

            const credentialHash = getCredentialHash(dialogResult.credentialId);
            const smartWalletData = await client.findWalletsByAuthority(credentialHash);
            let smartWalletAddress: string;
            let passkeyPubkey: string;

            const hasExistingWallet = smartWalletData && smartWalletData.length > 0;

            if (!dialogResult.publicKey && hasExistingWallet) {
                // Cross-device case (e.g. iCloud-synced passkey: created on iPhone,
                // reused on Mac). WebAuthn get() returns only credentialId, so we read
                // the compressed secp256r1 pubkey from the authority account that
                // findWalletsByAuthority already matched.
                const secp256r1Pubkey = await readAuthorityPubkey(
                    get().connection,
                    smartWalletData[0].authorityPda,
                );
                passkeyPubkey = Buffer.from(secp256r1Pubkey).toString('base64');
            } else {
                passkeyPubkey = dialogResult.publicKey;
            }

            if (hasExistingWallet) {
                // smartWallet = walletPda (internal authority account), NOT vaultPda.
                // Line 180 below computes vaultPda from this via findVault; if we store
                // vaultPda here, findVault would be applied twice and yield a bogus PDA
                // that SystemProgram.transfer(from=vaultPda) then treats as a signer,
                // breaking tx-level sig verification.
                smartWalletAddress = smartWalletData[0].walletPda.toBase58();
            } else {
                const feePayer = await paymaster.getPayer();
                const { instructions, walletPda } = await client.createWallet({
                    payer: feePayer,
                    userSeed: randomBytes(32),
                    owner: {
                        type: 'secp256r1',
                        credentialIdHash: credentialHash,
                        compressedPubkey: getPasskeyPublicKey(passkeyPubkey),
                        rpId: LAZOR_RP_ID,
                    },
                });
                await buildAndSendTx({
                    paymaster,
                    connection: client.connection,
                    feePayer,
                    instructions,
                });
                smartWalletAddress = walletPda.toBase58();
            }

            const [vaultAddress] = client.findVault(new PublicKey(smartWalletAddress));
            const walletInfo: WalletInfo = {
                credentialId: dialogResult.credentialId,
                passkeyPubkey: Array.from(Buffer.from(getPasskeyPublicKey(passkeyPubkey))),
                expo: 'web',
                platform: navigator.platform,
                smartWallet: smartWalletAddress,
                vaultPda: vaultAddress.toBase58(),
                walletDevice: '',
                accountName: dialogResult.accountName,
            };

            await StorageManager.saveWallet(walletInfo);
            set({ wallet: walletInfo });
            options?.onSuccess?.(walletInfo);
            return walletInfo;

        } finally {
            dialogManager.destroy();
        }

    } catch (error: unknown) {
        return handleActionError(error, set, options?.onFail);
    } finally {
        set({ isConnecting: false });
    }
};

/**
 * Disconnect wallet action
 */
export const disconnectAction = async (
    set: (state: Partial<WalletState>) => void,
    options?: DisconnectOptions
): Promise<void> => {

    try {
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);

        const { challenge, finalize } = await client.executeSecp256r1Prepare({
            payer: feePayer,
            walletPda,
            authorityPda,
            publicKeyBytes,
            rpId: LAZOR_RP_ID,
            instructions: payload.instructions,
        });
        const encodedChallenge = toBase64Url(challenge);

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

            const { instructions } = finalize(decodeSignResult(signResult));
            const txSignature = await buildAndSendTx({
                paymaster,
                connection,
                feePayer,
                instructions,
                addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                txVersion: payload.transactionOptions?.txVersion,
            });

            payload.onSuccess?.(txSignature);
            return txSignature;

        } finally {
            dialogManager.destroy();
        }

    } catch (error: unknown) {
        return handleActionError(error, set, payload.onFail);
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
    actions.push(Actions.programWhitelist(new PublicKey(SystemProgram.programId)))
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

async function resolvePasskeyWallet(wallet: WalletInfo, client: LazorKitClient) {
    const credentialIdHash = getCredentialHash(wallet.credentialId);
    const matches = await client.findWalletsByAuthority(credentialIdHash, 'secp256r1');
    if (matches.length === 0) throw new Error('No wallet found for stored credential');
    const match = matches[0];

    // Always source the compressed secp256r1 pubkey from the on-chain authority
    // account instead of the cached `wallet.passkeyPubkey`. The cache can be
    // stale across devices / sessions, which breaks the secp256r1 precompile
    // with custom program error 0x2 (InvalidSignature).
    const publicKeyBytes = await readAuthorityPubkey(client.connection, match.authorityPda);

    return { ...match, publicKeyBytes };
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);

        const sessionKeypair = Keypair.generate();
        const currentSlot = await connection.getSlot();
        const expiresAt = BigInt(currentSlot) + (payload.expiresInSlots ?? 50000n);
        const actions = buildSessionActions(payload.spendingLimits);

        const { sessionPda, challenge, finalize } = await client.createSessionPrepare({
            payer: feePayer,
            walletPda,
            authorityPda,
            publicKeyBytes,
            sessionKey: sessionKeypair.publicKey,
            expiresAt,
            actions: actions.length > 0 ? actions : undefined,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions } = finalize(decodeSignResult(signResult));

            await buildAndSendTx({ paymaster, connection, feePayer, instructions });

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

            payload.onSuccess?.(sessionPda.toBase58(), sessionKeypair.publicKey.toBase58());
            return { sessionPda: sessionPda.toBase58(), sessionPublicKey: sessionKeypair.publicKey.toBase58() };
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
    } finally {
        set({ isSigning: false });
    }
};

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
        const sessionRaw = localStorage.getItem('lazorkit-session');
        if (!sessionRaw) throw new Error('No session key found');
        const sessionInfo = JSON.parse(sessionRaw);
        const sessionPda = new PublicKey(sessionInfo.sessionPda);
        const walletPda = new PublicKey(sessionInfo.walletPda);

        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);

        const { challenge, finalize } = await client.revokeSessionPrepare({
            payer: feePayer,
            walletPda,
            adminAuthorityPda: authorityPda,
            sessionPda,
            publicKeyBytes,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions } = finalize(decodeSignResult(signResult));

            await buildAndSendTx({ paymaster, connection, feePayer, instructions });

            localStorage.removeItem('lazorkit-session');
            payload.onSuccess?.();
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
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
    try {
        const sessionRaw = localStorage.getItem('lazorkit-session');
        if (!sessionRaw) throw new Error('No session key found. Create a session first.');
        const sessionInfo = JSON.parse(sessionRaw);
        const sessionKeypair = Keypair.fromSecretKey(new Uint8Array(sessionInfo.secretKey));
        const sessionPda = new PublicKey(sessionInfo.sessionPda);
        const walletPda = new PublicKey(sessionInfo.walletPda);

        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
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
        return handleActionError(error, set, payload.onFail);
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);
        const authorityKeypair = Keypair.generate();
        const role = payload.role ?? ROLE_ADMIN;

        const { newAuthorityPda, challenge, finalize } = await client.addAuthorityEd25519Prepare({
            payer: feePayer,
            walletPda,
            adminAuthorityPda: authorityPda,
            adminPublicKeyBytes: publicKeyBytes,
            newEd25519Pubkey: authorityKeypair.publicKey,
            role,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions } = finalize(decodeSignResult(signResult));

            await buildAndSendTx({ paymaster, connection, feePayer, instructions });

            localStorage.setItem('lazorkit-authority', JSON.stringify({
                secretKey: Array.from(authorityKeypair.secretKey),
                publicKey: authorityKeypair.publicKey.toBase58(),
                authorityPda: newAuthorityPda.toBase58(),
                walletPda: walletPda.toBase58(),
                role,
            }));

            payload.onSuccess?.(newAuthorityPda.toBase58(), authorityKeypair.publicKey.toBase58());
            return { authorityPda: newAuthorityPda.toBase58(), authorityPublicKey: authorityKeypair.publicKey.toBase58() };
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);
        const targetAuthorityPda = new PublicKey(payload.targetAuthorityPda);

        const { challenge, finalize } = await client.removeAuthorityPrepare({
            payer: feePayer,
            walletPda,
            adminAuthorityPda: authorityPda,
            adminPublicKeyBytes: publicKeyBytes,
            targetAuthorityPda,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions } = finalize(decodeSignResult(signResult));

            await buildAndSendTx({ paymaster, connection, feePayer, instructions });

            payload.onSuccess?.();
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
    } finally {
        set({ isSigning: false });
    }
};

/**
 * Authorize + Execute deferred — passkey signs TX1 (authorize), then immediately executes TX2.
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);

        const { challenge, deferredPayload, finalize } = await client.authorizePrepare({
            payer: feePayer,
            walletPda,
            authorityPda,
            publicKeyBytes,
            instructions: payload.instructions,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions: authorizeIxs } = finalize(decodeSignResult(signResult));

            const txVersion = payload.transactionOptions?.txVersion;
            await buildAndSendTx({
                paymaster,
                connection,
                feePayer,
                instructions: authorizeIxs,
                txVersion,
            });

            const { instructions: execIxs } = await client.executeDeferredFromPayload({
                payer: feePayer,
                deferredPayload,
            });

            const txSignature = await buildAndSendTx({
                paymaster,
                connection,
                feePayer,
                instructions: execIxs,
                addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
                txVersion,
            });

            payload.onSuccess?.(txSignature);
            return txSignature;
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
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
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { walletPda, authorityPda, publicKeyBytes } = await resolvePasskeyWallet(wallet, client);

        const { challenge, deferredPayload, finalize } = await client.authorizePrepare({
            payer: feePayer,
            walletPda,
            authorityPda,
            publicKeyBytes,
            instructions: payload.instructions,
        });

        const encodedChallenge = toBase64Url(challenge);
        const dialogManager = createDialogManager(config);
        try {
            const signResult: SignResult = await dialogManager.openSign(
                encodedChallenge,
                '',
                wallet.credentialId,
                undefined,
            );

            const { instructions: authorizeIxs } = finalize(decodeSignResult(signResult));

            const signature = await buildAndSendTx({
                paymaster,
                connection,
                feePayer,
                instructions: authorizeIxs,
                txVersion: payload.transactionOptions?.txVersion,
            });

            const serialized = serializeDeferredPayload(deferredPayload);
            payload.onSuccess?.({ signature, deferredPayload: serialized });
            return { signature, deferredPayload: serialized };
        } finally {
            dialogManager.destroy();
        }
    } catch (error) {
        return handleActionError(error, set, payload.onFail);
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
    try {
        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const deferredPayload = deserializeDeferredPayload(payload.deferredPayload);
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
        return handleActionError(error, set, payload.onFail);
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
    try {
        const authRaw = localStorage.getItem('lazorkit-authority');
        if (!authRaw) throw new Error('No authority key found. Add an authority first.');
        const authInfo = JSON.parse(authRaw);
        const authorityKeypair = Keypair.fromSecretKey(new Uint8Array(authInfo.secretKey));
        const authorityPda = new PublicKey(authInfo.authorityPda);
        const walletPda = new PublicKey(authInfo.walletPda);

        const paymaster = new Paymaster(config.paymasterConfig);
        const client = new LazorKitClient(connection);
        const feePayer = await paymaster.getPayer();

        const { instructions } = await client.execute({
            payer: feePayer,
            walletPda,
            signer: { type: 'ed25519', publicKey: authorityKeypair.publicKey, authorityPda },
            instructions: payload.instructions,
        });

        // Build v0 VersionedTransaction (matches mobile-wallet-adapter).
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
        return handleActionError(error, set, payload.onFail);
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
