/**
 * Wallet Hook - Provides clean interface to wallet functionality
 * Business logic is handled by store actions
 */

import { useCallback } from 'react';
import { PublicKey, TransactionInstruction, AddressLookupTableAccount } from '@solana/web3.js';
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
  connect: (options?: { feeMode?: 'paymaster' | 'user' }) => Promise<WalletInfo>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (payload: {
    instructions: TransactionInstruction[],
    transactionOptions?: {
      feeToken?: string,
      addressLookupTableAccounts?: AddressLookupTableAccount[],
      computeUnitLimit?: number,
      clusterSimulation?: 'devnet' | 'mainnet'
    }
  }) => Promise<string>;
  signMessage: (message: string) => Promise<{ signature: string, signedPayload: string }>;
  verifyMessage: (args: { signedPayload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array }) => Promise<boolean>;
}

import { verifySignatureBrowser } from '../utils/verify';

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
    signMessage,
  } = useWalletStore();

  /**
   * Handle wallet connection
   */
  const handleConnect = useCallback(async (options?: { feeMode?: 'paymaster' | 'user' }): Promise<WalletInfo> => {
    try {
      return await connect(options);
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
    async (payload: {
      instructions: TransactionInstruction[],
      transactionOptions?: { feeToken?: string, addressLookupTableAccounts?: AddressLookupTableAccount[], computeUnitLimit?: number, clusterSimulation?: 'devnet' | 'mainnet' }
    }): Promise<string> => {
      try {
        return await signAndSendTransaction({
          instructions: payload.instructions,
          transactionOptions: payload.transactionOptions
        });
      } catch (error) {
        console.error('Failed to sign and send transaction:', error);
        throw error;
      }
    },
    [signAndSendTransaction]
  );

  /**
   * Handle message signing
   */
  const handleSignMessage = useCallback(
    async (message: string): Promise<{ signature: string, signedPayload: string }> => {
      try {
        return await signMessage(message);
      } catch (error) {
        console.error('Failed to sign message:', error);
        throw error;
      }
    },
    [signMessage]
  );

  /**
   * Verify message helper
   */
  const handleVerifyMessage = useCallback(
    async ({ signedPayload, signature, publicKey }: { signedPayload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array }): Promise<boolean> => {
      // Convert Uint8Arrays to base64 strings for the helper
      const signedPayloadB64 = Buffer.from(signedPayload).toString('base64');
      const signatureB64 = Buffer.from(signature).toString('base64');
      const publicKeyB64 = Buffer.from(publicKey).toString('base64');

      return await verifySignatureBrowser({
        signedPayload: signedPayloadB64,
        signature: signatureB64,
        publicKey: publicKeyB64
      });
    },
    []
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
    signMessage: handleSignMessage,
    verifyMessage: handleVerifyMessage,
  };
};
