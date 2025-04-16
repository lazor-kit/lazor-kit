import { useState, useCallback } from 'react';
import { PublicKey , Keypair} from '@solana/web3.js';
import { Connection } from '@solana/web3.js';
import { SmartWalletContract } from '../sdk';
import { Buffer } from 'buffer';
import { base64ToInstruction } from '../sdk/utils';
interface WalletState {
  credentialId: string | null;
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  smartWalletAuthorityPubkey: string | null;
}
const keypair = Keypair.fromSecretKey(new Uint8Array([91,139,202,42,20,31,61,11,170,237,184,147,253,10,63,240,131,46,231,211,253,181,58,104,242,192,0,143,19,252,47,158,219,165,97,103,220,26,173,243,207,52,18,44,64,84,249,104,158,221,84,61,36,240,55,20,76,59,142,34,100,132,243,236]))

const connection = new Connection('http://127.0.0.1:8899');
const SmartWallet = new SmartWalletContract(connection);

const WALLET_CONNECT_URL = 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=connect';

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
            const txs = await SmartWallet.createInitSmartWalletTransaction({
              secp256r1PubkeyBytes: Array.from(Buffer.from(publickey, 'base64')),
              payer: keypair.publicKey,
            })
            txs.feePayer = keypair.publicKey;
            txs.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            txs.sign(keypair)
            const txid = await connection.sendRawTransaction(txs.serialize());

            console.log('Transaction ID:', txid);
            const listSmartWalletAuthority =
            await SmartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
              data: Array.from(Buffer.from(publickey, 'base64')),
            });

            const smartWalletAuthority = listSmartWalletAuthority[0];

            const smartWalletAuthorityData = await SmartWallet.getSmartWalletAuthorityData(
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
          const { normalized , msg , publickey} = event.data.data;
          const listSmartWalletAuthority =
          await SmartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
            data: Array.from(publickey),
          });

        const smartWalletAuthority = listSmartWalletAuthority[0];

        const smartWalletAuthorityData = await SmartWallet.getSmartWalletAuthorityData(
          smartWalletAuthority
        );
        const { message, messageBytes } = await SmartWallet.getMessage(
          smartWalletAuthorityData
        );
        const smartWalletPubkey = smartWalletAuthorityData.smartWalletPubkey;

        
        const txn = await SmartWallet.createVerifyAndExecuteTransaction({
          arbitraryInstruction: base64ToInstruction(base64Tx),
          pubkey: publickey,
          signature: normalized,
          message,
          payer: keypair.publicKey,
          smartWalletPubkey,
          smartWalletAuthority,
        });
    
        txn.sign([keypair]);
    
        const result = await connection.sendTransaction(txn, {
          preflightCommitment: 'confirmed',
        });
      }}
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
    connect,
    disconnect,
    signMessage,
  };
}; 