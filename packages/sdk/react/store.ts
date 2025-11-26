/**
 * Wallet Store - Zustand store with integrated business logic
 * Includes state management, persistence, and wallet actions
 */

import { Connection } from '@solana/web3.js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { 
  WalletState, 
  connectAction, 
  disconnectAction, 
  signAndSendTransactionAction,
  createPasskeyOnlyAction,
  createSmartWalletOnlyAction,
  buildSmartWalletTransaction
} from '../actions';
import { WalletInfo, WalletConfig, storage } from '../core/storage';
import { DEFAULTS, DEFAULT_COMMITMENT } from '../config';

/**
 * Create wallet store with integrated business logic and persistence
 */
export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      // State
      wallet: null,
      config: {
        portalUrl: DEFAULTS.PORTAL_URL,
        paymasterUrl: DEFAULTS.PAYMASTER_URL,
        rpcUrl: DEFAULTS.RPC_ENDPOINT,
      },
      connection: new Connection(DEFAULTS.RPC_ENDPOINT!, DEFAULT_COMMITMENT),
      isLoading: false,
      isConnecting: false,
      isSigning: false,
      error: null,

      // State setters
      setConfig: (config: WalletConfig) => {
        try {
          const connection = new Connection(
            config.rpcUrl || DEFAULTS.RPC_ENDPOINT!,
            DEFAULT_COMMITMENT
          );
          set({ config, connection });
        } catch (error) {
          console.error('Failed to update wallet configuration:', error, { config });
          throw new Error(`Failed to update configuration: ${error}`);
        }
      },

      setWallet: (wallet: WalletInfo | null) => {
        try {
          set({ wallet });
        } catch (error) {
          console.error('Failed to set wallet:', error, { wallet });
          throw error;
        }
      },

      setLoading: (isLoading: boolean) => set({ isLoading }),
      setConnecting: (isConnecting: boolean) => set({ isConnecting }),
      setSigning: (isSigning: boolean) => set({ isSigning }),
      
      setConnection: (connection: Connection) => {
        try {
          set({ connection });
        } catch (error) {
          console.error('Failed to set connection:', error, { endpoint: connection?.rpcEndpoint });
          throw error;
        }
      },
      
      setError: (error: Error | null) => {
        set({ error });
        if (error) {
          console.error('Error state set:', error);
        }
      },
      
      clearError: () => {
        set({ error: null });
      },

      // Wallet actions
      connect: () => connectAction(get, set),
      disconnect: () => disconnectAction(set),
      signAndSendTransaction: (instruction) => signAndSendTransactionAction(get, set, instruction),
      createPasskeyOnly: () => createPasskeyOnlyAction(get, set),
      createSmartWalletOnly: (passkeyData) => createSmartWalletOnlyAction(get, set, passkeyData),
      buildSmartWalletTransaction: (payer, instruction) => buildSmartWalletTransaction(get, payer, instruction),
    }),
    {
      name: 'lazorkit-wallet-store',
      storage: createJSONStorage(() => storage),
      partialize: (state: WalletState) => ({
        wallet: state.wallet,
        config: state.config,
      }),
    }
  )
);