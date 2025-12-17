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
    VersionedTransaction,
    Connection,
    TransactionInstruction,
    TransactionSignature,
    AddressLookupTableAccount,
    // MessageAddressTableLookup,
} from '@solana/web3.js';

import { DialogManager, DialogResult, SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { KoraClient } from '@solana/kora';
import {
    LazorkitClient,
    asCredentialHash,
    asPasskeyPublicKey,
    SmartWalletAction,
    getBlockchainTimestamp,
    CredentialHash
} from '../contract';
import { getCredentialHash, getPasskeyPublicKey } from '../wallet/utils';
import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';


// ============================================================================
// Constants & Config
// ============================================================================

export const LazorkitWalletName = 'LazorKit' as WalletName<'LazorKit'>;

export interface LazorkitAdapterConfig {
    rpcUrl: string;
    portalUrl: string;
    paymasterConfig: {
        paymasterUrl: string;
        apiKey?: string;
    };
    clusterSimulation?: 'devnet' | 'mainnet';
}

export const DEFAULT_CONFIG: LazorkitAdapterConfig = {
    rpcUrl: 'https://api.devnet.solana.com',
    portalUrl: 'https://portal.lazor.sh',
    paymasterConfig: {
        paymasterUrl: 'https://kora.devnet.lazorkit.com',
    },
};

export interface LazorkitSendTransactionOptions extends SendTransactionOptions {
    extraInstructions?: TransactionInstruction[];
}

// ============================================================================
// Adapter Implementation
// ============================================================================

export class LazorkitWalletAdapter extends BaseWalletAdapter {
    name: WalletName<'LazorKit'> = LazorkitWalletName;
    url = 'https://lazorkit.com';
    icon = 'data:image/png;base64,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'
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

            // Check storage first
            const existingWallet = await StorageManager.getWallet();
            if (existingWallet) {
                this._updateWalletState(existingWallet);
                return;
            }

            // Initialize dialog manager
            const dialogManager = this._createDialogManager();

            try {
                const dialogResult: DialogResult = await dialogManager.openConnect();
                const walletInfo = await this._ensureWalletOnChain(dialogResult);

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

    private _updateWalletState(wallet: WalletInfo) {
        this._wallet = wallet;
        this._publicKey = new PublicKey(wallet.smartWallet);
        this.emit('connect', this._publicKey);
    }

    private _createDialogManager(): DialogManager {
        return new DialogManager({
            portalUrl: this._config.portalUrl,
            rpcUrl: this._config.rpcUrl,
            paymasterUrl: this._config.paymasterConfig.paymasterUrl,
        });
    }

    private async _ensureWalletOnChain(dialogResult: DialogResult): Promise<WalletInfo> {
        const connection = new Connection(this._config.rpcUrl);
        const paymaster = new KoraClient({
            rpcUrl: this._config.paymasterConfig.paymasterUrl,
            apiKey: this._config.paymasterConfig.apiKey,
        });
        const smartWallet = new LazorkitClient(connection);

        const credentialHash = asCredentialHash(getCredentialHash(dialogResult.credentialId));
        const smartWalletData = await smartWallet.getSmartWalletByCredentialHash(credentialHash);

        let smartWalletAddress: string;
        let passkeyPubkey: string;

        if (!dialogResult.publicKey && smartWalletData) {
            passkeyPubkey = Buffer.from(smartWalletData.passkeyPubkey).toString('base64');
            localStorage.setItem('PUBLIC_KEY', passkeyPubkey);
        } else {
            passkeyPubkey = dialogResult.publicKey;
        }

        if (smartWalletData) {
            smartWalletAddress = smartWalletData.smartWallet.toBase58();
        } else {
            const feePayer = await paymaster.getPayerSigner();
            const initSmartWalletTxn = await smartWallet.createSmartWalletTxn({
                passkeyPublicKey: asPasskeyPublicKey(getPasskeyPublicKey(dialogResult.publicKey)),
                payer: new anchor.web3.PublicKey(feePayer.signer_address),
                credentialIdBase64: dialogResult.credentialId,
            });

            await paymaster.signAndSendTransaction({
                transaction: Buffer.from(initSmartWalletTxn.transaction.serialize({ requireAllSignatures: false })).toString('base64'),
                signer_key: feePayer.signer_address,
            });
            smartWalletAddress = initSmartWalletTxn.smartWallet.toBase58();
        }

        return {
            credentialId: dialogResult.credentialId,
            passkeyPubkey: getPasskeyPublicKey(passkeyPubkey),
            expo: 'web',
            platform: navigator.platform,
            smartWallet: smartWalletAddress,
            walletDevice: '',
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
            const clients = this._initializeClients();
            let addressLookupTableAccounts: AddressLookupTableAccount[] = [];
            if ('version' in transaction) {
                const lookups = transaction.message.addressTableLookups;
                addressLookupTableAccounts = await Promise.all(
                    lookups.map(async (lookup) => {
                        const acc = await clients.connection.getAccountInfo(lookup.accountKey);
                        if (!acc) throw new Error("Lookup table not found");

                        return new AddressLookupTableAccount({
                            key: lookup.accountKey,
                            state: AddressLookupTableAccount.deserialize(acc.data),
                        });
                    })
                );
            }
            const feePayer = await clients.paymaster.getPayerSigner();
            const timestamp = await getBlockchainTimestamp(clients.connection);
            const credentialHash = asCredentialHash(getCredentialHash(this._wallet.credentialId));

            const message = await this._buildAuthorizationMessage(
                clients.smartWallet,
                instructions,
                feePayer.signer_address,
                timestamp,
                credentialHash,
            );

            const latest = await clients.connection.getLatestBlockhash();
            const signResult = await this._signWithDialog(message, instructions, latest.blockhash, feePayer.signer_address);

            return await this._executeSmartWalletTransaction(
                clients,
                instructions,
                signResult,
                feePayer.signer_address,
                timestamp,
                credentialHash,
                addressLookupTableAccounts,
            );

        } catch (error: any) {
            this.emit('error', error);
            throw error;
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
            const messageBase64 = Buffer.from(message).toString('base64')
            const signResult = await dialogManager.openSign(messageBase64, '', this._wallet!.credentialId, this._config.clusterSimulation);

            const encoded = JSON.stringify({
                signature: signResult.signature,
                signedPayload: signResult.signedPayload
            });

            return new Uint8Array(Buffer.from(encoded));
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        } finally {
            dialogManager.destroy();
        }
    }

    private _initializeClients() {
        const connection = new Connection(this._config.rpcUrl);
        const paymaster = new KoraClient({
            rpcUrl: this._config.paymasterConfig.paymasterUrl,
            apiKey: this._config.paymasterConfig.apiKey,
        });
        const smartWallet = new LazorkitClient(connection);
        return { connection, paymaster, smartWallet };
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
        } else {
            return [...transaction.instructions];
        }
    }

    private async _buildAuthorizationMessage(
        smartWallet: LazorkitClient,
        instructions: TransactionInstruction[],
        feePayerAddress: string,
        timestamp: number,
        credentialHash: CredentialHash
    ): Promise<Uint8Array> {
        return await smartWallet.buildAuthorizationMessage({
            action: {
                type: SmartWalletAction.CreateChunk,
                args: {
                    policyInstruction: null,
                    cpiInstructions: instructions,
                },
            },
            payer: new anchor.web3.PublicKey(feePayerAddress),
            smartWallet: this._publicKey!,
            passkeyPublicKey: this._wallet!.passkeyPubkey,
            timestamp: new anchor.BN(timestamp),
            credentialHash: credentialHash,
        });
    }

    private async _signWithDialog(
        message: Uint8Array,
        instructions: TransactionInstruction[],
        recentBlockhash: string,
        payerKey: string
    ): Promise<SignResult> {
        const messageBase64 = Buffer.from(message).toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

        const dialogManager = this._createDialogManager();
        try {
            const messageV0 = new anchor.web3.TransactionMessage({
                payerKey: new anchor.web3.PublicKey(payerKey),
                recentBlockhash: recentBlockhash,
                instructions: instructions,
            }).compileToV0Message();

            const transaction = new anchor.web3.VersionedTransaction(messageV0);
            const base64Tx = Buffer.from(transaction.serialize()).toString("base64");

            return await dialogManager.openSign(messageBase64, base64Tx, this._wallet!.credentialId, this._config.clusterSimulation);
        } finally {
            dialogManager.destroy();
        }
    }

    private async _executeSmartWalletTransaction(
        clients: { paymaster: KoraClient, smartWallet: LazorkitClient, connection: Connection },
        instructions: TransactionInstruction[],
        signResult: SignResult,
        feePayerAddress: string,
        timestamp: number,
        credentialHash: CredentialHash,
        addressLookupTableAccounts: AddressLookupTableAccount[],
    ): Promise<TransactionSignature> {
        const createDeferredExecutionTxn = await clients.smartWallet.createChunkTxn({
            payer: new anchor.web3.PublicKey(feePayerAddress),
            smartWallet: this._publicKey!,
            passkeySignature: {
                passkeyPublicKey: asPasskeyPublicKey(this._wallet!.passkeyPubkey),
                signature64: signResult.signature,
                clientDataJsonRaw64: signResult.clientDataJsonBase64,
                authenticatorDataRaw64: signResult.authenticatorDataBase64,
            },
            policyInstruction: null,
            cpiInstructions: instructions,
            timestamp,
            credentialHash,
        });

        const chunk = await this._sendToPaymaster(clients.paymaster, createDeferredExecutionTxn as Transaction, feePayerAddress);
        await clients.connection.confirmTransaction(chunk, 'confirmed');

        const executeDeferredTransactionTxn = await clients.smartWallet.executeChunkTxn(
            {
                payer: new anchor.web3.PublicKey(feePayerAddress),
                smartWallet: this._publicKey!,
                cpiInstructions: instructions,
            },
            {
                addressLookupTables: addressLookupTableAccounts,
            }
        );

        return await this._sendToPaymaster(clients.paymaster, executeDeferredTransactionTxn, feePayerAddress);
    }

    private async _sendToPaymaster(
        paymaster: KoraClient,
        transaction: Transaction | VersionedTransaction,
        signerKey: string
    ): Promise<string> {
        let serialized: Buffer;
        if ('version' in transaction) {
            serialized = Buffer.from(transaction.serialize());
        } else {
            serialized = Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
        }

        const result = await paymaster.signAndSendTransaction({
            transaction: serialized.toString('base64'),
            signer_key: signerKey,
        }) as any;

        return result.signature;
    }
}

// ============================================================================
// Wallet Standard Implementation
// ============================================================================
