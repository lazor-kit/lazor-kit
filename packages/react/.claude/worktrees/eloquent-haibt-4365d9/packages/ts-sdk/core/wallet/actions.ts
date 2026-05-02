/**
 * SDK Actions - Core wallet operations
 */
import * as anchor from '@coral-xyz/anchor';
import { DialogResult, SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from '../paymaster/paymaster';
import { SmartWalletAction, LazorkitClient, asCredentialHash, asPasskeyPublicKey, getBlockchainTimestamp } from '../contract';
import { WalletState, ConnectOptions, DisconnectOptions, SignResponse, SignAndSendTransactionPayload } from '../types';
import {
    createDialogManager,
    getCredentialHash,
    handleActionError,
    cleanupLegacyStorage,
    getPasskeyPublicKey
} from './utils';

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
            const smartWallet = new LazorkitClient(get().connection);

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
                const feePayer = await paymaster.getPayer();
                const initSmartWalletTxn = await smartWallet.createSmartWalletTxn({
                    passkeyPublicKey: asPasskeyPublicKey(getPasskeyPublicKey(passkeyPubkey)),
                    payer: feePayer,
                    credentialIdBase64: dialogResult.credentialId,
                });
                await paymaster.signAndSend(initSmartWalletTxn.transaction as anchor.web3.Transaction);
                smartWalletAddress = initSmartWalletTxn.smartWallet.toBase58();
            }

            const walletInfo: WalletInfo = {
                credentialId: dialogResult.credentialId,
                passkeyPubkey: getPasskeyPublicKey(passkeyPubkey),
                expo: 'web',
                platform: navigator.platform,
                smartWallet: smartWalletAddress,
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
        // Clear all state
        set({
            wallet: null,
            error: null,
            isConnecting: false,
            isSigning: false,
            isLoading: false
        });
        options?.onSuccess?.();
    } catch (error: unknown) {
        return handleActionError(error, set, options?.onFail);
    }
};



/**
 * Sign and send transaction action
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
        const smartWallet = new LazorkitClient(connection);

        const feePayer = await paymaster.getPayer();
        const timestamp = await getBlockchainTimestamp(connection);

        const message = await smartWallet.buildAuthorizationMessage({
            action: {
                type: SmartWalletAction.CreateChunk,
                args: {
                    policyInstruction: null,
                    cpiInstructions: payload.instructions,
                },
            },
            payer: feePayer,
            smartWallet: new anchor.web3.PublicKey(wallet.smartWallet),
            passkeyPublicKey: wallet.passkeyPubkey,
            timestamp: new anchor.BN(timestamp),
            credentialHash: asCredentialHash(getCredentialHash(wallet.credentialId)),
        });

        const encodedChallenge = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        // For visual representation in portal, we ideally want to show the transaction.
        // Construction a V0 transaction for display purposes (signed by fee payer initially for structure)
        const latest = await connection.getLatestBlockhash();

        const messageV0 = new anchor.web3.TransactionMessage({
            payerKey: feePayer,
            recentBlockhash: latest.blockhash,
            instructions: payload.instructions,
        }).compileToV0Message();

        const transaction = new anchor.web3.VersionedTransaction(messageV0);

        const base64Tx = Buffer.from(transaction.serialize()).toString("base64");
        const dialogManager = createDialogManager(config);
        const credentialIdBase64 = wallet.credentialId;
        const clusterSimulation = payload.transactionOptions?.clusterSimulation;

        try {
            const signResult: SignResult = await dialogManager.openSign(encodedChallenge, base64Tx, credentialIdBase64, clusterSimulation);
            const signResponse: SignResponse = {
                msg: encodedChallenge,
                normalized: signResult.signature,
                clientDataJSONReturn: signResult.clientDataJsonBase64,
                authenticatorDataReturn: signResult.authenticatorDataBase64,
            };

            const credentialHash = asCredentialHash(getCredentialHash(wallet.credentialId));

            const createChunkTransaction = await smartWallet.createChunkTxn({
                payer: feePayer,
                smartWallet: new anchor.web3.PublicKey(wallet.smartWallet),
                passkeySignature: {
                    passkeyPublicKey: asPasskeyPublicKey(wallet.passkeyPubkey),
                    signature64: signResponse.normalized,
                    clientDataJsonRaw64: signResponse.clientDataJSONReturn,
                    authenticatorDataRaw64: signResponse.authenticatorDataReturn,
                },
                policyInstruction: null,
                cpiInstructions: payload.instructions,
                timestamp,
                credentialHash,
            });
            const createChunkSignature = await paymaster.signAndSend(createChunkTransaction as anchor.web3.Transaction);
            await connection.confirmTransaction(createChunkSignature);
            const addressLookupTables = payload.transactionOptions?.addressLookupTableAccounts || [];
            const executeChunkTransaction = await smartWallet.executeChunkTxn({
                payer: feePayer,
                smartWallet: new anchor.web3.PublicKey(wallet.smartWallet),
                cpiInstructions: payload.instructions,
            }, {
                addressLookupTables: addressLookupTables,
                computeUnitLimit: payload.transactionOptions?.computeUnitLimit
            });
            let signature: string;
            if (addressLookupTables.length > 0) {
                signature = await paymaster.signAndSendVersionedTransaction(executeChunkTransaction as anchor.web3.VersionedTransaction);
            } else {
                signature = await paymaster.signAndSend(executeChunkTransaction as anchor.web3.Transaction);
            }

            payload.onSuccess?.(signature);
            return signature;

        } finally {
            dialogManager.destroy();
        }

    } catch (error: unknown) {
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
            // We reuse openSign or similar from DialogManager. 
            // The DialogManager now has openSignMessage as per our plan (step 64)
            const signResult = await dialogManager.openSignMessage(message, wallet.credentialId);

            const signature = signResult.signature;
            const signedPayload = signResult.signedPayload;
            // If the user needs the full authentication response, we might need to adjust the return type,
            // but the request asked for { signature }

            return { signature, signedPayload };
        } finally {
            dialogManager.destroy();
        }
    } catch (error: unknown) {
        // We don't have onSuccess/onFail in the simple signature, but we handle the error state
        set({ error: error as Error });
        throw error;
    } finally {
        set({ isSigning: false });
    }
};
