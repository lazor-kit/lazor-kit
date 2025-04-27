import { useState, useCallback, useMemo } from 'react';
import { Connection } from '@solana/web3.js';
import { SmartWalletContract } from '../sdk';
import { Buffer } from 'buffer';
import { base64ToInstruction } from '../sdk/utils';
import { NONCE_KEYPAIR, WALLET_CONNECT_URL } from '@/sdk/constant';

interface WalletState {
  credentialId: string | null;
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  smartWalletAuthorityPubkey: string | null;
}

export const useWallet = ({ connection }: { connection: Connection }) => {
  const [walletState, setWalletState] = useState<WalletState>({
    credentialId: localStorage.getItem('CREDENTIAL_ID'),
    publicKey: localStorage.getItem('PUBLIC_KEY'),
    isConnected: !!localStorage.getItem('CREDENTIAL_ID'),
    smartWalletAuthorityPubkey: null,
    isLoading: false,
    error: null,
  });
  const smartWallet = useMemo(() => {
    return new SmartWalletContract(connection);
  }, [connection]);

  const connect = useCallback(async () => {
    setWalletState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const popup = window.open(
        WALLET_CONNECT_URL,
        'WalletAction',
        'width=600,height=400'
      );

      await new Promise((resolve, reject) => {
        const handleMessage = async (event: MessageEvent) => {
          if (event.data.type === 'WALLET_CONNECTED') {
            const { credentialId, publickey } = event.data.data;
            localStorage.setItem('CREDENTIAL_ID', credentialId);
            localStorage.setItem('PUBLIC_KEY', publickey);
            const txs = await smartWallet.createInitSmartWalletTransaction({
              secp256r1PubkeyBytes: Array.from(Buffer.from(publickey, 'base64')),
              payer: NONCE_KEYPAIR.publicKey,
            })
            txs.feePayer = NONCE_KEYPAIR.publicKey;
            txs.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            txs.sign(NONCE_KEYPAIR)
            const txid = await connection.sendRawTransaction(txs.serialize());

            console.log('Transaction ID:', txid);
            const listSmartWalletAuthority =
              await smartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
                data: Array.from(Buffer.from(publickey, 'base64')),
              });

            const smartWalletAuthority = listSmartWalletAuthority[0];

            const smartWalletAuthorityData = await smartWallet.getSmartWalletAuthorityData(
              smartWalletAuthority
            );

            const smartWalletPubkey = smartWalletAuthorityData.smartWalletPubkey;
            const smartWalletAuthorityPubkey = smartWalletPubkey.toBase58()
            setWalletState({
              credentialId,
              publicKey: publickey,
              isConnected: true,
              isLoading: false,
              error: null,
              smartWalletAuthorityPubkey,
            });
            window.removeEventListener('message', handleMessage);
            resolve({ smartWalletAuthorityPubkey });
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
      smartWalletAuthorityPubkey: null,
    });
  }, []);

  const signMessage = useCallback(async (base64Tx: string) => {
    try {
      const credentialId = localStorage.getItem('CREDENTIAL_ID');
      const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
      if (!credentialId || !storedPublicKey) {
        throw new Error('Please connect wallet first');
      }

      const popup = window.open(
        `https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=sign&message=${encodeURIComponent(base64Tx)}`,
        'WalletAction',
        'width=600,height=400'
      );

      const handleMessage = async (event: MessageEvent) => {
        if (event.data.type === 'SIGNATURE_CREATED') {
          const { normalized, msg, publickey } = event.data.data;
          const listSmartWalletAuthority =
            await smartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
              data: Array.from(publickey),
            });

          const smartWalletAuthority = listSmartWalletAuthority[0];

          const smartWalletAuthorityData = await smartWallet.getSmartWalletAuthorityData(
            smartWalletAuthority
          );
          const { message, messageBytes } = await smartWallet.getMessage(
            smartWalletAuthorityData
          );
          const smartWalletPubkey = smartWalletAuthorityData.smartWalletPubkey;


          const txn = await smartWallet.createVerifyAndExecuteTransaction({
            arbitraryInstruction: base64ToInstruction(base64Tx),
            pubkey: publickey,
            signature: normalized,
            message,
            payer: NONCE_KEYPAIR.publicKey,
            smartWalletPubkey,
            smartWalletAuthority,
          });

          txn.sign([NONCE_KEYPAIR]);

          const result = await connection.sendTransaction(txn, {
            preflightCommitment: 'confirmed',
          });
        }
      }
      window.addEventListener('message', handleMessage);

      const checkPopupClosed = setInterval(() => {
        if (popup && popup.closed) {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          throw new Error('Popup closed unexpectedly');
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkPopupClosed);
        window.removeEventListener('message', handleMessage);
        throw new Error('Connection timeout');
      }, 60000);

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }
    } catch (error) {
      throw error;
    }
  }, []);

  return {
    ...walletState,
    smartWallet,
    connect,
    disconnect,
    signMessage,
  };
}; 