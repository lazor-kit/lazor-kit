/**
 * Wallet Store - Zustand store with integrated business logic
 * Includes state management, persistence, and wallet actions
 */

import { Connection } from '@solana/web3.js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  connectAction,
  disconnectAction,
  signAndSendTransactionAction,
  signMessageAction,
  createSessionAction,
  revokeSessionAction,
  signAndSendWithSessionAction,
  addAuthorityAction,
  removeAuthorityAction,
  signAndSendWithAuthorityAction,
  authorizeAndExecuteAction,
  authorizeDeferredAction,
  executeDeferredAction,
} from '../core/wallet/actions';

import { WalletInfo, WalletConfig, storage } from '../core/storage';
import { DEFAULTS, DEFAULT_COMMITMENT } from '../config';
import { WalletState } from '../core/types';
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
        paymasterConfig: {
          paymasterUrl: DEFAULTS.PAYMASTER_URL,
        },
        rpcUrl: DEFAULTS.RPC_ENDPOINT,
      },
      connection: new Connection(DEFAULTS.RPC_ENDPOINT!, DEFAULT_COMMITMENT),
      isLoading: false,
      isConnecting: false,
      isSigning: false,
      error: null,

      // State setters
      setConfig: (config: WalletConfig) => {
        const connection = new Connection(
          config.rpcUrl || DEFAULTS.RPC_ENDPOINT!,
          DEFAULT_COMMITMENT
        );
        set({ config, connection });
      },

      setWallet: (wallet: WalletInfo | null) => set({ wallet }),

      setLoading: (isLoading: boolean) => set({ isLoading }),
      setConnecting: (isConnecting: boolean) => set({ isConnecting }),
      setSigning: (isSigning: boolean) => set({ isSigning }),

      setConnection: (connection: Connection) => set({ connection }),

      setError: (error: Error | null) => set({ error }),

      clearError: () => {
        set({ error: null });
      },

      // Wallet actions
      connect: (options) => connectAction(get, set, options),
      disconnect: () => disconnectAction(set),
      signAndSendTransaction: (payload) => signAndSendTransactionAction(get, set, payload),
      signMessage: (message) => signMessageAction(get, set, message),

      // Session key actions
      createSession: (payload) => createSessionAction(get, set, payload ?? {}),
      revokeSession: (payload) => revokeSessionAction(get, set, payload ?? {}),
      signAndSendWithSession: (payload) => signAndSendWithSessionAction(get, set, payload),

      // Ed25519 authority actions
      addAuthority: (payload) => addAuthorityAction(get, set, payload ?? {}),
      removeAuthority: (targetAuthorityPda) => removeAuthorityAction(get, set, { targetAuthorityPda }),
      signAndSendWithAuthority: (payload) => signAndSendWithAuthorityAction(get, set, payload),

      // Deferred execution
      authorizeAndExecute: (payload) => authorizeAndExecuteAction(get, set, payload),
      authorizeDeferred: (payload) => authorizeDeferredAction(get, set, payload),
      executeDeferred: (payload) => executeDeferredAction(get, set, payload),
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