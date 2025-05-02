import { useState, useEffect } from 'react';
import { useWallet } from './useWallet';
import { Connection } from '@solana/web3.js';

export const useSmartWallet = ({ connection }: { connection: Connection }) => {
  const { publicKey, isConnected, smartWallet } = useWallet({ connection });
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected && publicKey) {
      const initializeSmartWallet = async () => {
        try {
          setIsLoading(true);
          setError(null);

          // Get list of smart wallets for the current public key
          const smartWallets = await smartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
            data: Array.from(publicKey.toBytes())
          });

          if (smartWallets.length > 0) {
            // If smart wallet exists, get its data
            const smartWalletData = await smartWallet.getSmartWalletAuthorityData(smartWallets[0]);
            setSmartWalletAddress(smartWallets[0].toBase58());
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to initialize smart wallet');
        } finally {
          setIsLoading(false);
        }
      };

      initializeSmartWallet();
    } else {
      setSmartWalletAddress(null);
      setError(null);
    }
  }, [isConnected, publicKey]);

  const createSmartWallet = async () => {
    if (!publicKey || !isConnected) {
      setError('Wallet not connected');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Create a new smart wallet
      const transaction = await smartWallet.createInitSmartWalletTransaction({
        secp256r1PubkeyBytes: Array.from(publicKey.toBytes()),
        payer: publicKey
      });

      // TODO: Sign and send the transaction
      // This is where you would implement the actual transaction signing and sending logic
      console.log('Smart wallet creation transaction:', transaction);

      // After successful creation, update the state
      const smartWallets = await smartWallet.getListSmartWalletAuthorityByPasskeyPubkey({
        data: Array.from(publicKey.toBytes())
      });
      setSmartWalletAddress(smartWallets[0].toBase58());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create smart wallet');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    smartWalletAddress,
    isLoading,
    error,
    createSmartWallet,
  };
}; 