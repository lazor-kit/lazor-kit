import { useState, useCallback, useEffect, useMemo } from 'react';
import { Connection } from '@solana/web3.js';
import {
  WalletConnectionData,
  SignatureData,
  WalletState,
  LazorKitConfig,
  UseLazorKitReturn,
  CreateSmartWalletParams,
  ExecuteTransactionParams,
  AddAuthenticatorParams,
} from '../types';
import { SolanaService } from '../services/SolanaService';
import {
  DEFAULT_RPC_URL,
  DEFAULT_POPUP_CONFIG,
  DEFAULT_TIMEOUT,
} from '../constants';

export function useLazorKit(config: Partial<LazorKitConfig> = {}): UseLazorKitReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [walletState, setWalletState] = useState<WalletState>({
    credentialId: null,
    publicKey: null,
    isConnected: false,
  });

  const mergedConfig = {
    ipfsHubUrl: 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by',
    popupConfig: config.popupConfig || DEFAULT_POPUP_CONFIG,
    timeout: config.timeout || DEFAULT_TIMEOUT,
    rpcUrl: config.rpcUrl || DEFAULT_RPC_URL,
  };

  const connection = useMemo(() => new Connection(mergedConfig.rpcUrl), [mergedConfig.rpcUrl]);
  const solanaService = useMemo(() => new SolanaService(connection), [connection]);

  useEffect(() => {
    const storedCredentialId = localStorage.getItem('CREDENTIAL_ID');
    const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
    
    if (storedCredentialId && storedPublicKey) {
      setWalletState({
        credentialId: storedCredentialId,
        publicKey: storedPublicKey,
        isConnected: true,
      });
    }
  }, []);

  const openPopup = useCallback((url: string) => {
    const { width, height, title } = mergedConfig.popupConfig;
    const popup = window.open(
      url,
      title,
      `width=${width},height=${height}`
    );

    if (!popup) {
      throw new Error('Popup blocked. Please allow popups and try again.');
    }

    return popup;
  }, [mergedConfig.popupConfig]);

  const handleMessage = useCallback((event: MessageEvent, popup: Window, resolve: Function, reject: Function) => {
    if (event.data.type === 'WALLET_CONNECTED' || event.data.type === 'SIGNATURE_CREATED') {
      window.removeEventListener('message', (e) => handleMessage(e, popup, resolve, reject));
      resolve(event.data.data);
      popup.close();
    } else if (event.data.type === 'WALLET_ERROR' || event.data.type === 'SIGNATURE_ERROR') {
      window.removeEventListener('message', (e) => handleMessage(e, popup, resolve, reject));
      reject(new Error(event.data.error));
      popup.close();
    }
  }, []);

  const connect = useCallback(async (): Promise<WalletConnectionData> => {
    setIsLoading(true);
    setError(null);

    try {
      const popup = openPopup(`${mergedConfig.ipfsHubUrl}/?action=connect`);

      const connectionData = await new Promise<WalletConnectionData>((resolve, reject) => {
        const messageHandler = (event: MessageEvent) => handleMessage(event, popup, resolve, reject);
        window.addEventListener('message', messageHandler);

        const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', messageHandler);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', messageHandler);
          reject(new Error('Connection timeout'));
        }, mergedConfig.timeout);
      });

      setWalletState({
        credentialId: connectionData.credentialId,
        publicKey: connectionData.publicKey,
        isConnected: true,
      });
      localStorage.setItem('CREDENTIAL_ID', connectionData.credentialId);
      localStorage.setItem('PUBLIC_KEY', connectionData.publicKey);

      return connectionData;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error occurred'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [mergedConfig, openPopup, handleMessage]);

  const sign = useCallback(async (message: string): Promise<SignatureData> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!walletState.isConnected) {
        throw new Error('Please connect wallet first');
      }

      const encodedMessage = encodeURIComponent(btoa(message));
      const popup = openPopup(
        `${mergedConfig.ipfsHubUrl}/?action=sign&message=${encodedMessage}`
      );

      const signatureData = await new Promise<SignatureData>((resolve, reject) => {
        const messageHandler = (event: MessageEvent) => handleMessage(event, popup, resolve, reject);
        window.addEventListener('message', messageHandler);

        const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', messageHandler);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', messageHandler);
          reject(new Error('Signature timeout'));
        }, mergedConfig.timeout);
      });

      return signatureData;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error occurred'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [mergedConfig, walletState.isConnected, openPopup, handleMessage]);

  const disconnect = useCallback(() => {
    localStorage.removeItem('CREDENTIAL_ID');
    localStorage.removeItem('PUBLIC_KEY');
    setWalletState({
      credentialId: null,
      publicKey: null,
      isConnected: false,
    });
  }, []);

  const createSmartWallet = useCallback(async (params: CreateSmartWalletParams) => {
    return solanaService.createSmartWallet(params);
  }, [solanaService]);

  const executeTransaction = useCallback(async (params: ExecuteTransactionParams) => {
    return solanaService.executeTransaction(params);
  }, [solanaService]);

  const addAuthenticator = useCallback(async (params: AddAuthenticatorParams) => {
    return solanaService.addAuthenticatorsTxn(params);
  }, [solanaService]);

  return {
    connect,
    sign,
    disconnect,
    walletState,
    isLoading,
    error,
    createSmartWallet,
    executeTransaction,
    addAuthenticator,
  };
} 