import { useCallback } from 'react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useLazorkitStore } from './store';
import { WalletAccount } from '../types';
import { Transaction } from '@solana/web3.js';
/**
 * Hook for interacting with the Lazorkit wallet
 * Provides wallet state and methods for connecting, disconnecting, and signing transactions
 */
export const useWallet = () => {
  const { sdk, account, isConnecting, isSigning, error } = useLazorkitStore();

  /**
   * Connects to wallet
   * @returns Promise resolving to wallet account information
   */
  const connect = useCallback(async (): Promise<WalletAccount> => {
    if (!sdk) {
      throw new Error('Lazorkit SDK not initialized');
    }

    try {
      const account = await sdk.connect();
      return account;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [sdk]);

  /**
   * Disconnects from wallet
   */
  const disconnect = useCallback(async (): Promise<void> => {
    if (!sdk) {
      throw new Error('Lazorkit SDK not initialized');
    }

    try {
      await sdk.disconnect();
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      throw error;
    }
  }, [sdk]);

  /**
   * Builds and signs a transaction with the instruction
   * @param instruction Transaction instruction to append
   * @returns Promise resolving to transaction
   */
  const signTransaction = useCallback(
    async (instruction: TransactionInstruction): Promise<Transaction> => {
      if (!sdk) {
        throw new Error('Lazorkit SDK not initialized');
      }

      if (!account) {
        throw new Error('Wallet not connected');
      }

      try {
        const transaction = await sdk.signTransaction(instruction);
        return transaction;
      } catch (error) {
        console.error('Failed to sign transaction:', error);
        throw error;
      }
    },
    [sdk, account]
  );

  /**
   * Signs and sends a transaction with the provided instruction
   * @param instruction Transaction instruction to append
   * @returns Promise resolving to transaction signature
   */
  const signAndSendTransaction = useCallback(
    async (instruction: TransactionInstruction): Promise<string> => {
      if (!sdk) {
        throw new Error('Lazorkit SDK not initialized');
      }

      if (!account) {
        throw new Error('Wallet not connected');
      }

      try {
        const signature = await sdk.signAndSendTransaction(instruction);
        return signature;
      } catch (error) {
        console.error('Failed to sign and send transaction:', error);
        throw error;
      }
    },
    [sdk, account]
  );

  // Get the smart wallet public key from the account if available
  const smartWalletPubkey = account?.smartWallet 
    ? new PublicKey(account.smartWallet) 
    : null;

  return {
    // State
    smartWalletPubkey,
    isConnected: !!account,
    isLoading: isConnecting || isSigning,
    isConnecting,
    isSigning,
    error,
    account,

    // Actions
    connect,
    disconnect,
    signTransaction,
    signAndSendTransaction,
  };
};
