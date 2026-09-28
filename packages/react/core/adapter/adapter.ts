import {
    BaseWalletAdapter,
    WalletName,
    WalletReadyState,
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

import { DialogManager, DialogResult, SignResult } from '../portal';
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
} from '../program';
import { getCredentialHash, getPasskeyPublicKey } from '../wallet/utils';
import { chooseOwnWallet, findOwnedCandidates } from '../wallet/ownership';
import { Buffer } from 'buffer';
import { DEFAULTS } from '../../config';

// ============================================================================
// Constants & Config
// ============================================================================

export const LazorkitWalletName = 'Lazorkit Wallet' as WalletName<'Lazorkit Wallet'>;

/**
 * WebAuthn RP ID (effective domain — hostname only, no protocol or port).
 * Derived from a portal URL so self-hosted portals work out of the box.
 */
const getRpId = (portalUrl: string): string => new URL(portalUrl).hostname;

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
    private _wallet: WalletInfo | null = null;
    private _config: LazorkitAdapterConfig = DEFAULT_CONFIG;

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

    async connect(): Promise<void> {
        try {
            if (this.connected || this.connecting) return;
            if (this._readyState !== WalletReadyState.Installed) throw new WalletWindowClosedError();

            this._connecting = true;
            this.emit('readyStateChange', this._readyState);

            let existingWallet = await StorageManager.getWallet();
            if (existingWallet) {
                const version = versionOf(existingWallet);
                const connection = new Connection(this._config.rpcUrl);
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
                this._updateWalletState(existingWallet);
                return;
            }

            const dialogManager = this._createDialogManager();

            try {
                const dialogResult: DialogResult = await dialogManager.openConnect();
                const walletInfo = await this._ensureWalletOnChain(dialogResult, dialogManager);

                await StorageManager.saveWallet(walletInfo);
                this._updateWalletState(walletInfo);

            } finally {
                dialogManager.destroy();
            }

        } catch (error: any) {
            this.emit('error', error);
            throw error;
        } finally {
            this._connecting = false;
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

    private async _ensureWalletOnChain(
        dialogResult: DialogResult,
        dialogManager: DialogManager,
    ): Promise<WalletInfo> {
        const credentialHash = getCredentialHash(dialogResult.credentialId);
        const rpId = getRpId(this._config.portalUrl);
        const probe = new Connection(this._config.rpcUrl);

        // The passkey's own wallet, proven rather than guessed from the public
        // credential hash (see ../wallet/ownership). A v1 wallet made before
        // LazorKit v2 keeps being used; only a passkey that owns neither gets a
        // new, v2, wallet.
        const reportedPubkey = dialogResult.publicKey ? getPasskeyPublicKey(dialogResult.publicKey) : undefined;
        const own = await chooseOwnWallet({
            candidates: await findOwnedCandidates(probe, credentialHash, rpId),
            reportedPubkey,
            rpId,
            prove: async () => {
                const challenge = randomBytes(32);
                const r = await dialogManager.openSign(toBase64Url(challenge), '', dialogResult.credentialId);
                const clientDataJson = new Uint8Array(Buffer.from(r.clientDataJsonBase64, 'base64'));
                return {
                    challenge,
                    signature: new Uint8Array(Buffer.from(r.signature, 'base64')),
                    authenticatorData: new Uint8Array(Buffer.from(r.authenticatorDataBase64, 'base64')),
                    clientDataJson,
                };
            },
        });
        const version: ProtocolVersion = own?.version ?? 2;
        const { paymaster, client } = this._initializeClients(version);

        let smartWalletAddress: string;
        let passkeyPubkey: Uint8Array;
        const matches = own ? [own] : [];
        if (own) passkeyPubkey = own.pubkey;
        else if (reportedPubkey && reportedPubkey.length === 33) passkeyPubkey = reportedPubkey;
        else {
            throw new Error(
                'This passkey has no wallet yet, and signing in with an existing passkey does not ' +
                    'reveal its public key. Create the wallet with "Create new account".',
            );
        }
        localStorage.setItem('PUBLIC_KEY', Buffer.from(passkeyPubkey).toString('base64'));

        if (matches.length > 0) {
            smartWalletAddress = matches[0].walletPda.toBase58();
        } else {
            const feePayer = await paymaster.getPayer();
            const { instructions, walletPda } = await client.createWallet({
                payer: feePayer,
                userSeed: randomBytes(32),
                owner: {
                    type: 'secp256r1',
                    credentialIdHash: credentialHash,
                    compressedPubkey: passkeyPubkey,
                    rpId,
                },
            });
            const tx = new Transaction();
            tx.add(...instructions);
            await paymaster.signAndSend(tx);
            smartWalletAddress = walletPda.toBase58();
        }

        const [vault] = client.findVault(new PublicKey(smartWalletAddress));
        return {
            credentialId: dialogResult.credentialId,
            passkeyPubkey: Array.from(passkeyPubkey),
            expo: 'web',
            platform: navigator.platform,
            smartWallet: smartWalletAddress,
            vaultPda: vault.toBase58(),
            walletDevice: '',
            protocolVersion: version,
        };
    }

    async disconnect(): Promise<void> {
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

                const tx = new Transaction();
                tx.add(...finalizedIxs);
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
