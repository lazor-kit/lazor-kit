import {
    BaseWalletAdapter,
    WalletName,
    WalletReadyState,
    WalletConnectionError,
    WalletDisconnectedError,
    WalletSignTransactionError,
    WalletWindowClosedError,
    SendTransactionOptions,
} from '@solana/wallet-adapter-base';
import {
    PublicKey,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
    Connection,
    TransactionInstruction,
    TransactionSignature,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import { sha256 } from 'js-sha256';

import { DialogManager, SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from '../paymaster/paymaster';
import {
    LazorKitClient,
    type ProtocolVersion,
    clientFor,
    versionOf,
    readPasskeyPubkey,
    isRetiredDeploymentError,
    V1WalletRetiredError,
    registerCluster,
    V1WalletMigratedError,
} from '../program';
import { getCredentialHash } from '../wallet/utils';
import { clearPendingConfirmation, connectAbandoned, connectFreshWallet } from '../wallet/resolveWallet';
import type { OnConfirmWallet } from '../wallet/confirmation';
import { Buffer } from 'buffer';
import { DEFAULTS } from '../../config';

// ============================================================================
// Constants & Config
// ============================================================================

export const LazorkitWalletName = 'Lazorkit Wallet' as WalletName<'Lazorkit Wallet'>;

export interface LazorkitAdapterConfig {
    rpcUrl: string;
    portalUrl: string;
    /** The paymaster for v2 wallets. */
    paymasterConfig: {
        paymasterUrl: string;
        apiKey?: string;
    };
    /**
     * The paymaster for wallets still on LazorKit v1 — the relayer used before
     * v2. Defaults to `paymasterConfig`.
     */
    v1PaymasterConfig?: {
        paymasterUrl: string;
        apiKey?: string;
    };
    clusterSimulation?: 'devnet' | 'mainnet';
    /** Which cluster `rpcUrl` serves, if its URL does not say. Otherwise read from the URL, else mainnet. */
    cluster?: 'mainnet' | 'devnet';
    /**
     * How `connect` asks the user to confirm a wallet it will not adopt on its
     * own — see `OnConfirmWallet`. Default `'builtin'`: the SDK's chooser.
     */
    onConfirmWallet?: OnConfirmWallet;
    /**
     * Your own Ed25519 keys (base58): an authority, session or token approval
     * held by one of them does not stop a wallet from being adopted.
     */
    trustedAuthorities?: string[];
    /** SPL Token mints your app receives (base58), checked on top of wSOL, USDC, USDT and devnet USDC. */
    watchMints?: string[];
}

export const DEFAULT_CONFIG: LazorkitAdapterConfig = {
    rpcUrl: DEFAULTS.RPC_ENDPOINT,
    portalUrl: DEFAULTS.PORTAL_URL,
    paymasterConfig: {
        paymasterUrl: DEFAULTS.PAYMASTER_URL,
    },
};

export interface LazorkitSendTransactionOptions extends SendTransactionOptions {
    extraInstructions?: TransactionInstruction[];
}

/**
 * A connected wallet is never swapped silently for another: `confirmWallet`,
 * when given, must name this one (its vault or wallet PDA).
 */
function assertConnectedWallet(wallet: WalletInfo, confirmWallet: string | undefined): void {
    if (confirmWallet && confirmWallet !== wallet.vaultPda && confirmWallet !== wallet.smartWallet) {
        throw new Error(
            `confirmWallet ${confirmWallet} is not the connected wallet ` +
                `(${wallet.vaultPda ?? wallet.smartWallet}). Disconnect first to connect another.`,
        );
    }
}

function randomBytes(size: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

/** URL-safe base64 (no padding) — portal challenge format. */
function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ============================================================================
// Adapter Implementation
// ============================================================================

export class LazorkitWalletAdapter extends BaseWalletAdapter {
    name: WalletName<'Lazorkit Wallet'> = LazorkitWalletName;
    url = 'https://lazorkit.com';
    icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGcAAABXCAAAAAA8UASIAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAlwSFlzAAALEgAACxIB0t1+/AAAAAd0SU1FB+kMEAUXDRWPYLQAAAB3dEVYdFJhdyBwcm9maWxlIHR5cGUgOGJpbQAKOGJpbQogICAgICA0MAozODQyNDk0ZDA0MDQwMDAwMDAwMDAwMDAzODQyNDk0ZDA0MjUwMDAwMDAwMDAwMTBkNDFkOGNkOThmMDBiMjA0ZTk4MDA5OTgKZWNmODQyN2UK';
    supportedTransactionVersions: ReadonlySet<any> = new Set(['legacy', 0]);

    private _publicKey: PublicKey | null = null;
    private _readyState: WalletReadyState =
        typeof window === 'undefined' || typeof document === 'undefined'
            ? WalletReadyState.Unsupported
            : WalletReadyState.Installed;
    private _connecting: boolean = false;
    /** The connect in flight: later calls wait for it, `disconnect` aborts it. */
    private _connectAttempt: { done: Promise<void>; abort: AbortController } | null = null;
    private _wallet: WalletInfo | null = null;
    private _config: LazorkitAdapterConfig = DEFAULT_CONFIG;
    /**
     * The wallet (vault or wallet address) the next connect should adopt —
     * after connect threw `WalletNeedsConfirmationError` and the user
     * recognised it. Same as `connect({ confirmWallet })`; cleared once a
     * wallet is connected, and on disconnect.
     */
    confirmWallet?: string;

    constructor(config?: Partial<LazorkitAdapterConfig>) {
        super();
        if (config) {
            this._config = { ...this._config, ...config };
        }
        registerCluster(this._config.rpcUrl, this._config.cluster);
    }

    get publicKey(): PublicKey | null {
        return this._publicKey;
    }

    get connecting(): boolean {
        return this._connecting;
    }

    get readyState(): WalletReadyState {
        return this._readyState;
    }

    /**
     * Connect the stored wallet, or find the passkey's own (see
     * core/wallet/resolveWallet). `options` override the adapter config for
     * this call; wallet-adapter UIs call it without any.
     *
     * One connect at a time: a call made while one runs (Connect clicked
     * again, a dApp repeating `standard:connect`) waits for it and shares its
     * outcome, instead of opening a second portal whose wallet would replace
     * the first's.
     */
    async connect(options?: { confirmWallet?: string; onConfirmWallet?: OnConfirmWallet }): Promise<void> {
        const running = this._connectAttempt;
        if (running) {
            if (options?.confirmWallet || options?.onConfirmWallet) {
                // Its outcome is not this call's to choose, and these are never ignored.
                const error = new WalletConnectionError('A connect is already in progress; wait for it before connecting with other options.');
                this.emit('error', error);
                throw error;
            }
            return running.done;
        }
        const attempt = { abort: new AbortController(), done: Promise.resolve() };
        this._connectAttempt = attempt;
        this._connecting = true;
        // Started a microtask later, so `done` is in place before anything the
        // connect emits can reach a listener that calls connect again.
        attempt.done = Promise.resolve().then(() => this._connect(options, attempt.abort.signal)).finally(() => {
            // An aborted attempt no longer owns the state: disconnect reset it.
            if (this._connectAttempt === attempt) {
                this._connectAttempt = null;
                this._connecting = false;
            }
        });
        return attempt.done;
    }

    private async _connect(
        options: { confirmWallet?: string; onConfirmWallet?: OnConfirmWallet } | undefined,
        signal: AbortSignal,
    ): Promise<void> {
        try {
            const confirmWallet = options?.confirmWallet ?? this.confirmWallet;
            if (this._wallet) {
                assertConnectedWallet(this._wallet, confirmWallet);
                return;
            }
            if (this._readyState !== WalletReadyState.Installed) throw new WalletWindowClosedError();

            this.emit('readyStateChange', this._readyState);

            const connection = new Connection(this._config.rpcUrl);
            let existingWallet = await StorageManager.getWallet();
            if (existingWallet) {
                const version = versionOf(existingWallet);
                // A stored v1 wallet may have been migrated since: then it is
                // closed and its address dead — forget it and connect afresh.
                if (version === 1 && !(await connection.getAccountInfo(new PublicKey(existingWallet.smartWallet)))) {
                    await StorageManager.clearWallet();
                    existingWallet = null;
                } else if (!existingWallet.vaultPda) {
                    const [vault] = clientFor(version, connection).findVault(new PublicKey(existingWallet.smartWallet));
                    existingWallet = { ...existingWallet, vaultPda: vault.toBase58() };
                    await StorageManager.saveWallet(existingWallet);
                }
            }
            if (existingWallet) {
                assertConnectedWallet(existingWallet, confirmWallet);
                if (signal.aborted) throw connectAbandoned();
                this.confirmWallet = undefined;
                this._updateWalletState(existingWallet);
                return;
            }

            const walletInfo = await connectFreshWallet({
                connection,
                portalUrl: this._config.portalUrl,
                trustedAuthorities: this._config.trustedAuthorities,
                watchMints: this._config.watchMints,
                onConfirmWallet: options?.onConfirmWallet ?? this._config.onConfirmWallet,
                confirmWallet,
                openPortal: () => this._createDialogManager(),
                createWallet: async (owner) => {
                    const { paymaster, client } = this._initializeClients(2);
                    const feePayer = await paymaster.getPayer();
                    const { instructions, walletPda } = await client.createWallet({
                        payer: feePayer,
                        userSeed: randomBytes(32),
                        owner: { type: 'secp256r1', ...owner },
                    });
                    const tx = new Transaction();
                    tx.add(...instructions);
                    // Serializing for the paymaster needs both; without them
                    // creation threw before anything was sent.
                    tx.feePayer = feePayer;
                    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                    await paymaster.signAndSend(tx);
                    return walletPda;
                },
                signal,
            });

            if (signal.aborted) throw connectAbandoned();
            await StorageManager.saveWallet(walletInfo);
            this.confirmWallet = undefined;
            this._updateWalletState(walletInfo);

        } catch (error: any) {
            // Abandoned by disconnect: fail the call, but raise no 'error'
            // for a connect the dApp itself walked away from.
            if (signal.aborted) throw connectAbandoned();
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * The address dApps see is the vault — where funds live and the account
     * that signs in the wallet's transactions. (Earlier releases advertised the
     * wallet PDA, an internal account nothing can spend from.)
     */
    private _updateWalletState(wallet: WalletInfo) {
        this._wallet = wallet;
        this._publicKey = new PublicKey(wallet.vaultPda ?? wallet.smartWallet);
        this.emit('connect', this._publicKey);
    }

    private _createDialogManager(): DialogManager {
        return new DialogManager({
            portalUrl: this._config.portalUrl,
            rpcUrl: this._config.rpcUrl,
            paymasterUrl: this._config.paymasterConfig.paymasterUrl,
        });
    }

    /** Connection, paymaster and client for one protocol (see core/program/protocol). */
    private _initializeClients(version: ProtocolVersion) {
        const connection = new Connection(this._config.rpcUrl);
        const paymaster = new Paymaster(
            version === 1
                ? (this._config.v1PaymasterConfig ?? this._config.paymasterConfig)
                : this._config.paymasterConfig,
        );
        const client: LazorKitClient = clientFor(version, connection);
        return { connection, paymaster, client };
    }

    async disconnect(): Promise<void> {
        // A connect still running is abandoned: its portal or chooser closes,
        // and it connects nothing (see connect).
        const running = this._connectAttempt;
        this._connectAttempt = null;
        this._connecting = false;
        running?.abort.abort();
        clearPendingConfirmation();
        this.confirmWallet = undefined;
        await StorageManager.clearWallet();
        this._wallet = null;
        this._publicKey = null;
        this.emit('disconnect');
    }

    async sendTransaction(
        transaction: Transaction | VersionedTransaction,
    ): Promise<TransactionSignature> {
        try {
            if (!this._wallet || !this._publicKey) throw new WalletDisconnectedError();

            const instructions = this._prepareInstructions(transaction);
            if (instructions.length === 0) throw new WalletSignTransactionError('No instructions to sign');

            const version = versionOf(this._wallet);
            const { connection, paymaster, client } = this._initializeClients(version);

            let addressLookupTableAccounts: AddressLookupTableAccount[] = [];
            if ('version' in transaction) {
                const lookups = transaction.message.addressTableLookups;
                addressLookupTableAccounts = await Promise.all(
                    lookups.map(async (lookup) => {
                        const acc = await connection.getAccountInfo(lookup.accountKey);
                        if (!acc) throw new Error('Lookup table not found');
                        return new AddressLookupTableAccount({
                            key: lookup.accountKey,
                            state: AddressLookupTableAccount.deserialize(acc.data),
                        });
                    })
                );
            }

            const feePayer = await paymaster.getPayer();

            // Step 1: resolve the connected wallet on chain — the stored one, not
            // whichever wallet lists this passkey first.
            const credentialIdHash = getCredentialHash(this._wallet.credentialId);
            const matches = await client.findWalletsByAuthority(credentialIdHash, 'secp256r1');
            const match = matches.find((m) => m.walletPda.toBase58() === this._wallet!.smartWallet);
            if (!match) {
                // A v1 wallet that is gone has been migrated while this page was
                // open: stop presenting its dead vault as the account.
                if (version === 1 && !(await connection.getAccountInfo(new PublicKey(this._wallet.smartWallet)))) {
                    await this.disconnect();
                    throw new V1WalletMigratedError();
                }
                throw new Error('The connected wallet no longer lists this passkey');
            }
            const { walletPda, authorityPda } = match;
            const publicKeyBytes = await readPasskeyPubkey(version, connection, authorityPda);

            // Step 2: prepare execute context (challenge + opaque internal state).
            const prepared = await client.prepareExecute({
                payer: feePayer,
                walletPda,
                secp256r1: { credentialIdHash, publicKeyBytes, authorityPda },
                instructions,
            });

            const encodedChallenge = toBase64Url(prepared.challenge);

            // Build a display-only v0 transaction for the portal preview.
            const latest = await connection.getLatestBlockhash();
            const displayMessage = new TransactionMessage({
                payerKey: feePayer,
                recentBlockhash: latest.blockhash,
                instructions,
            }).compileToV0Message();
            const base64Tx = Buffer.from(new VersionedTransaction(displayMessage).serialize()).toString('base64');

            const dialogManager = this._createDialogManager();
            try {
                // Step 3: obtain the signature via the portal.
                const signResult: SignResult = await dialogManager.openSign(
                    encodedChallenge,
                    base64Tx,
                    this._wallet.credentialId,
                    this._config.clusterSimulation,
                );

                // Step 4: decode portal result.
                const signature = new Uint8Array(Buffer.from(signResult.signature, 'base64'));
                const authenticatorData = new Uint8Array(
                    Buffer.from(signResult.authenticatorDataBase64, 'base64'),
                );
                const clientDataJsonRaw = Buffer.from(signResult.clientDataJsonBase64, 'base64');
                const clientDataJsonHash = new Uint8Array(sha256.arrayBuffer(clientDataJsonRaw));

                const { instructions: finalizedIxs } = client.finalizeExecute(prepared, {
                    signature,
                    authenticatorData,
                    clientDataJsonHash,
                    clientDataJson: new Uint8Array(clientDataJsonRaw),
                });

                // Step 5: send via paymaster (versioned if LUTs supplied, legacy otherwise).
                if (addressLookupTableAccounts.length > 0) {
                    const { blockhash } = await connection.getLatestBlockhash();
                    const v0Message = new TransactionMessage({
                        payerKey: feePayer,
                        recentBlockhash: blockhash,
                        instructions: finalizedIxs,
                    }).compileToV0Message(addressLookupTableAccounts);
                    return await paymaster.signAndSendVersionedTransaction(
                        new VersionedTransaction(v0Message),
                    );
                }

                // A legacy transaction cannot be serialized for the paymaster
                // without its fee payer and a blockhash.
                const tx = new Transaction();
                tx.add(...finalizedIxs);
                tx.feePayer = feePayer;
                tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                return await paymaster.signAndSend(tx);
            } finally {
                dialogManager.destroy();
            }

        } catch (error: any) {
            const err = isRetiredDeploymentError(error, this._wallet ? versionOf(this._wallet) : undefined)
                ? new V1WalletRetiredError(error)
                : error;
            this.emit('error', err);
            throw err;
        }
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(_transaction: T): Promise<T> {
        throw new WalletSignTransactionError('Lazorkit Wallet does not support signTransaction. Please use sendTransaction or signAndSendTransaction.');
    }

    async signAllTransactions<T extends Transaction | VersionedTransaction>(_transactions: T[]): Promise<T[]> {
        throw new WalletSignTransactionError('Lazorkit Wallet does not support signAllTransactions. Please use sendTransaction or signAndSendTransaction.');
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        const dialogManager = this._createDialogManager();
        try {
            if (!this._wallet || !this._publicKey) throw new WalletDisconnectedError();
            const messageBase64 = Buffer.from(message).toString('base64');
            const signResult = await dialogManager.openSign(
                messageBase64,
                '',
                this._wallet.credentialId,
                this._config.clusterSimulation,
            );

            const encoded = JSON.stringify({
                signature: signResult.signature,
                signedPayload: signResult.signedPayload,
            });

            return new Uint8Array(Buffer.from(encoded));
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        } finally {
            dialogManager.destroy();
        }
    }

    private _prepareInstructions(transaction: Transaction | VersionedTransaction): TransactionInstruction[] {
        if ('version' in transaction) {
            return transaction.message.compiledInstructions.map((ix) => {
                return new TransactionInstruction({
                    keys: ix.accountKeyIndexes.map((keyIndex) => {
                        return {
                            pubkey: transaction.message.staticAccountKeys[keyIndex],
                            isSigner: transaction.message.isAccountSigner(keyIndex),
                            isWritable: transaction.message.isAccountWritable(keyIndex),
                        };
                    }),
                    programId: new PublicKey(transaction.message.staticAccountKeys[ix.programIdIndex]),
                    data: Buffer.from(ix.data),
                });
            });
        }
        return [...transaction.instructions];
    }
}

// ============================================================================
// Wallet Standard Implementation
// ============================================================================
