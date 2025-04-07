import { useState, useCallback } from 'react';
import { PublicKey } from '@solana/web3.js';
import { Connection } from '@solana/web3.js';

interface WalletState {
  credentialId: string | null;
  publicKey: PublicKey | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

const WALLET_CONNECT_URL = 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=connect';

export const useWallet = () => {
  const [walletState, setWalletState] = useState<WalletState>({
    credentialId: localStorage.getItem('CREDENTIAL_ID'),
    publicKey: localStorage.getItem('PUBLIC_KEY') ? new PublicKey(localStorage.getItem('PUBLIC_KEY')!) : null,
    isConnected: !!localStorage.getItem('CREDENTIAL_ID'),
    isLoading: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setWalletState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const popup = window.open(
        WALLET_CONNECT_URL,
        'WalletAction',
        'width=600,height=400'
      );

      await new Promise((resolve, reject) => {
        const handleMessage = (event: MessageEvent) => {
          if (event.data.type === 'WALLET_CONNECTED') {
            const { credentialId, publickey } = event.data.data;
            localStorage.setItem('CREDENTIAL_ID', credentialId);
            localStorage.setItem('PUBLIC_KEY', publickey);
            setWalletState({
              credentialId,
              publicKey: new PublicKey(publickey),
              isConnected: true,
              isLoading: false,
              error: null,
            });

            window.removeEventListener('message', handleMessage);
            resolve({ credentialId, publickey });
          } else if (event.data.type === 'WALLET_ERROR') {
            window.removeEventListener('message', handleMessage);
            reject(new Error(event.data.error));
            if (popup) {
              popup.close();
            }
          }
        };

        window.addEventListener('message', handleMessage);

        const checkPopupClosed = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Connection timeout'));
        }, 60000);
      });
    } catch (error) {
      setWalletState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem('CREDENTIAL_ID');
    localStorage.removeItem('PUBLIC_KEY');
    setWalletState({
      credentialId: null,
      publicKey: null,
      isConnected: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const signMessage = useCallback(async (base64Tx: string) => {
    try {
      const credentialId = localStorage.getItem('CREDENTIAL_ID');
      const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
      if (!credentialId || !storedPublicKey) {
        throw new Error('Please connect wallet first');
      }

      const publicKey = new PublicKey(storedPublicKey);
      
      // Get message from smart wallet

      const popup = window.open(
        `https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=sign&message=${encodeURIComponent(base64Tx)}`,
        'WalletAction',
        'width=600,height=400'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }

      return new Promise((resolve, reject) => {
        const handleMessage = (event: MessageEvent) => {
          if (event.data.type === 'SIGNATURE_CREATED') {
            const { normalized, msg, publickey } = event.data.data;
            window.removeEventListener('message', handleMessage);
            popup.close();
            resolve({ signature: normalized, message: msg, publicKey: publickey });
          } else if (event.data.type === 'SIGNATURE_ERROR') {
            window.removeEventListener('message', handleMessage);
            popup.close();
            reject(new Error(event.data.error));
          }
        };

        window.addEventListener('message', handleMessage);

        const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Signature timeout'));
        }, 60000);
      });
    } catch (error) {
      console.error("Error signing message:", error);
      throw error;
    }
  }, []);

  return {
    ...walletState,
    connect,
    disconnect,
    signMessage,
  };
}; 