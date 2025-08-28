/**
 * Wallet Hook - Provides clean interface to wallet functionality
 * Business logic is handled by store actions
 */

import { useCallback } from 'react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useWalletStore } from './store';
import { WalletInfo } from '../core/storage';

export interface WalletHookInterface {
  // State
  smartWalletPubkey: PublicKey | null;
  isConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;
  wallet: WalletInfo | null;

  // Actions
  connect: () => Promise<WalletInfo>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (instruction: TransactionInstruction) => Promise<string>;
}

/**
 * Hook for interacting with the Lazorkit wallet
 * Simplified interface for wallet functionality
 */
export const useWallet = (): WalletHookInterface => {
  const {
    wallet,
    isLoading,
    isConnecting,
    isSigning,
    error,
    connect,
    disconnect,
    signAndSendTransaction,
  } = useWalletStore();

  /**
   * Handle wallet connection
   */
  const handleConnect = useCallback(async (): Promise<WalletInfo> => {
    try {
      return await connect();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [connect]);

  /**
   * Handle wallet disconnection
   */
  const handleDisconnect = useCallback(async (): Promise<void> => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      throw error;
    }
  }, [disconnect]);

  /**
   * Handle transaction signing and sending
   */
  const handleSignAndSendTransaction = useCallback(
    async (instruction: TransactionInstruction): Promise<string> => {
      try {
        return await signAndSendTransaction(instruction);
      } catch (error) {
        console.error('Failed to sign and send transaction:', error);
        throw error;
      }
    },
    [signAndSendTransaction]
  );

  // Get the smart wallet public key from the wallet if available
  const smartWalletPubkey = wallet?.smartWallet 
    ? new PublicKey(wallet.smartWallet) 
    : null;

  return {
    // State
    smartWalletPubkey,
    isConnected: !!wallet,
    isLoading: isLoading || isConnecting || isSigning,
    isConnecting,
    isSigning,
    error,
    wallet,

    // Actions
    connect: handleConnect,
    disconnect: handleDisconnect,
    signAndSendTransaction: handleSignAndSendTransaction,
  };
};
