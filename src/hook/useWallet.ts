import { useState, useCallback } from 'react';
import { Connection, PublicKey, Keypair, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { createSmartWalletTransaction } from '../core/createSmartWallet';
import { getSmartWalletPdaByCreator } from '../core/getAddress';
import { createVerifyAndExecuteTransaction } from '../core/verifyAndExecute';

interface WalletState {
  credentialId: string | null;
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  smartWalletAuthorityPubkey: string | null;

}

const keypair = Keypair.fromSecretKey(new Uint8Array([91, 139, 202, 42, 20, 31, 61, 11, 170, 237, 184, 147, 253, 10, 63, 240, 131, 46, 231, 211, 253, 181, 58, 104, 242, 192, 0, 143, 19, 252, 47, 158, 219, 165, 97, 103, 220, 26, 173, 243, 207, 52, 18, 44, 64, 84, 249, 104, 158, 221, 84, 61, 36, 240, 55, 20, 76, 59, 142, 34, 100, 132, 243, 236]));
const connection = new Connection('https://rpc.lazorkit.xyz/', {
  wsEndpoint: 'https://rpc.lazorkit.xyz/ws/',
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

const WALLET_CONNECT_URL = 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=connect';

function delay(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export const useWallet = () => {
  const [walletState, setWalletState] = useState<WalletState>({
    credentialId: localStorage.getItem('CREDENTIAL_ID'),
    publicKey: localStorage.getItem('PUBLIC_KEY'),
    isConnected: !!localStorage.getItem('CREDENTIAL_ID'),
    smartWalletAuthorityPubkey: null,
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
        const handleMessage = async (event: MessageEvent) => {
          if (event.data.type === 'WALLET_CONNECTED') {
            const { credentialId, publickey } = event.data.data;
            localStorage.setItem('CREDENTIAL_ID', credentialId);
            localStorage.setItem('PUBLIC_KEY', publickey);
            await createSmartWalletTransaction({
                secp256k1PubkeyBytes: Array.from(Buffer.from(publickey, "base64")),
                connection: connection,
            });
            await delay(2);

            const smartWalletPubkey = await getSmartWalletPdaByCreator(
              connection,
              Array.from(Buffer.from(publickey, "base64"))
            );
            console.log(smartWalletPubkey);
            setWalletState({
              credentialId,
              publicKey: smartWalletPubkey,
              isConnected: true,
              isLoading: false,
              error: null,
              smartWalletAuthorityPubkey: smartWalletPubkey,
            });
            window.removeEventListener('message', handleMessage);
            resolve({ smartWalletPubkey });
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

  const signMessage = useCallback(async (instruction: TransactionInstruction) => {
    try {
      const popup = window.open(
        `https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=sign&message=hello}`,
        'WalletAction',
        'width=600,height=400'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }

      // Return a Promise that resolves with the txid when signature is created
      return new Promise<string>((resolve, reject) => {
        const handleMessage = async (event: MessageEvent) => {
          if (event.data.type === 'SIGNATURE_CREATED') {
            try {
              const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
              if (!storedPublicKey) {
                throw new Error('Public key not found');
              }

              const smartWalletPubkey = await getSmartWalletPdaByCreator(
                connection,
                Array.from(Buffer.from(storedPublicKey, "base64"))
              );

              const { normalized, msg } = event.data.data;

              const txn = await createVerifyAndExecuteTransaction({
                arbitraryInstruction: instruction,
                pubkey: Buffer.from(storedPublicKey, "base64"),
                signature: Buffer.from(normalized, "base64"),
                message: Buffer.from(msg, "base64"),
                connection: connection,
                payer: keypair.publicKey,
                smartWalletPda: new PublicKey(smartWalletPubkey),
              });

              txn.partialSign(keypair);
              const txid = await connection.sendRawTransaction(txn.serialize(), {
                skipPreflight: true
              });

              console.log('Transaction ID:', txid);

              // Resolve the promise with the txid
              resolve(txid);
            } catch (err) {
              reject(err);
            }
          }
        };

        // Attach the event listener to the window
        window.addEventListener('message', handleMessage);

        // Check if the popup is closed
        const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        // Timeout for connection
        const timeout = setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Connection timeout'));
        }, 60000);

        // Cleanup on successful execution
        const cleanup = () => {
          clearInterval(checkPopupClosed);
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
        };
      });
    } catch (error) {
      console.error('Error signing message:', error);
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
