/**
 * SDK Actions - Core wallet operations
 */

import {
    TransactionInstruction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { DialogResult, SignResult } from '../portal';
import { StorageManager, WalletInfo } from '../storage';
import { Paymaster } from './Paymaster';
import { SmartWalletAction, LazorkitClient, asCredentialHash, asPasskeyPublicKey, getBlockchainTimestamp } from '../contract';
import { WalletState, ConnectOptions, DisconnectOptions, SignOptions, SignResponse } from '../types';
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
    options?: ConnectOptions
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
            const paymaster = new Paymaster(config.paymasterUrl);
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
    set({ isLoading: true });

    try {
        await StorageManager.clearWallet();
        set({ wallet: null, error: null });
        options?.onSuccess?.();
    } catch (error: unknown) {
        return handleActionError(error, set, options?.onFail);
    } finally {
        set({ isLoading: false });
    }
};



/**
 * Sign and send transaction action
 */
export const signAndSendTransactionAction = async (
    get: () => WalletState,
    set: (state: Partial<WalletState>) => void,
    instruction: TransactionInstruction,
    options?: SignOptions
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
        const paymaster = new Paymaster(config.paymasterUrl);
        const smartWallet = new LazorkitClient(connection);

        const feePayer = await paymaster.getPayer();
        const timestamp = await getBlockchainTimestamp(connection);

        const message = await smartWallet.buildAuthorizationMessage({
            action: {
                type: SmartWalletAction.CreateChunk,
                args: {
                    policyInstruction: null,
                    cpiInstructions: [instruction],
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
        const latest = await connection.getLatestBlockhash();

        const messageV0 = new anchor.web3.TransactionMessage({
            payerKey: feePayer,
            recentBlockhash: latest.blockhash,
            instructions: [instruction],
        }).compileToV0Message();

        const transaction = new anchor.web3.VersionedTransaction(messageV0);

        const base64Tx = Buffer.from(transaction.serialize()).toString("base64");
        const dialogManager = createDialogManager(config);
        const credentialIdBase64 = wallet.credentialId;

        try {
            const signResult: SignResult = await dialogManager.openSign(encodedChallenge, base64Tx, credentialIdBase64);
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
                cpiInstructions: [instruction],
                timestamp,
                credentialHash,
            }, { useVersionedTransaction: true });

            const createChunkSignature = await paymaster.signAndSendVersionedTransaction(createChunkTransaction as anchor.web3.VersionedTransaction);
            await connection.confirmTransaction(createChunkSignature);
            const executeChunkTransaction = await smartWallet.executeChunkTxn({
                payer: feePayer,
                smartWallet: new anchor.web3.PublicKey(wallet.smartWallet),
                cpiInstructions: [instruction],
            }, { useVersionedTransaction: true });

            const signature = await paymaster.signAndSendVersionedTransaction(executeChunkTransaction as anchor.web3.VersionedTransaction);

            options?.onSuccess?.(signature);
            return signature;

        } finally {
            dialogManager.destroy();
        }

    } catch (error: unknown) {
        return handleActionError(error, set, options?.onFail);
    } finally {
        set({ isSigning: false });
    }
};
