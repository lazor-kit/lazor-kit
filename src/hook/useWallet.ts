import { useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import { WalletState } from '../models/WalletState';
import { AuthenticationService, ConnectionOptions, SigningOptions } from '../services/authentication';
import { useWalletState } from '../state/WalletStateManager';
import { TransactionInstruction } from '@solana/web3.js';

/**
 * Hook for wallet functionality
 * This is the main entry point for wallet operations
 * @param connection Optional Solana connection instance
 */
export const useWallet = (connection?: any) => {
  // Use the wallet state manager for state management
  const { state, updateState } = useWalletState();
  
  // Create authentication service with state updater and optional connection
  const authService = new AuthenticationService(updateState, connection);

  /**
   * Connect to wallet
   * @param options Optional connection configuration options
   * @returns Promise with smart wallet public key or undefined if connection fails
   */
  const connect = useCallback(async (options?: ConnectionOptions) => {
    try {
      return await authService.connect(options);
    } catch (error) {
      console.error('Connection error:', error);
      return undefined;
    }
  }, [authService]);

  /**
   * Disconnect from wallet
   * @returns boolean indicating success of disconnect operation
   */
  const disconnect = useCallback((): boolean => {
    try {
      authService.disconnect();
      return true;
    } catch (error) {
      console.error('Disconnect error:', error);
      return false;
    }
  }, [authService]);

  /**
   * Sign a message with the wallet
   * @param instruction The transaction instruction to sign
   * @param options Optional signing configuration options
   * @returns Promise with transaction ID or throws an error if signing fails
   */
  const signMessage = useCallback(async (instruction: TransactionInstruction, options?: SigningOptions): Promise<string> => {
    if (!state.isConnected) {
      throw new Error('Wallet not connected. Please connect wallet before signing.');
    }
    
    try {
      return await authService.signMessage(instruction, options);
    } catch (error) {
      console.error('Signing error:', error);
      throw error;
    }
  }, [authService, state.isConnected]);

  /**
   * Check if wallet is connected
   * @returns boolean indicating if wallet is connected
   */
  const isConnected = useCallback((): boolean => {
    return !!state.isConnected;
  }, [state.isConnected]);
  
  // Return wallet state and methods
  return {
    ...state,
    connect,
    disconnect,
    signMessage,
    isConnected,
  };
};
