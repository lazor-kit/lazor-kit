/**
 * LazorKit Wallet Mobile Adapter - Zustand Wallet Store (react layer)
 *
 * This file mirrors the previous src/wallet-store.ts but lives under react/
 * and imports from the new core & config modules.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { findVaultPda } from '../program';
import {
  WalletStateClient,
  WalletInfo,
  WalletConfig,
  ConnectOptions,
  SignOptions,
  AddAuthorityPayload,
  AuthorizeExecutePayload,
  AuthorizePayload,
  CreateSessionPayload,
  ExecuteDeferredPayload,
  ReclaimDeferredPayload,
  RemoveAuthorityPayload,
  RevokeSessionPayload,
  SessionSignPayload,
  SignAndSendTransactionPayload,
  TransferSolPayload,
  TxCallbacks,
} from '../types';
import { DEFAULT_COMMITMENT, DEFAULTS, STORAGE_KEYS } from '../config';
import { logger } from '../core/logger';
import {
  addAuthorityEd25519Action,
  authorizeDeferredAction,
  authorizeAndExecuteAction,
  connectAction,
  createSessionAction,
  disconnectAction,
  executeDeferredAction,
  listAuthoritiesAction,
  reclaimDeferredAction,
  removeAuthorityAction,
  revokeSessionAction,
  signAndExecuteTransaction,
  signAndSendWithSessionAction,
  signMessageAction,
  transferSolAction,
} from '../actions';
// AsyncStorage dynamic import remains unchanged
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AsyncStorage: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (error) {
  // Warning log removed
}

const storage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (!AsyncStorage || typeof AsyncStorage.getItem !== 'function') {
        // Warning log removed
        return null;
      }
      const result = await AsyncStorage.getItem(name);
      // Debug log removed
      return result;
    } catch (error) {
      logger.error('Error reading from AsyncStorage:', error, { key: name });
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      if (!AsyncStorage || typeof AsyncStorage.setItem !== 'function') {
        // Warning log removed
        return;
      }
      await AsyncStorage.setItem(name, value);
      // Debug log removed
    } catch (error) {
      logger.error('Error writing to AsyncStorage:', error, {
        key: name,
        valueLength: value.length,
      });
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (!AsyncStorage || typeof AsyncStorage.removeItem !== 'function') {
        // Warning log removed
        return;
      }
      await AsyncStorage.removeItem(name);
      // Debug log removed
    } catch (error) {
      logger.error('Error removing from AsyncStorage:', error, { key: name });
    }
  },
};

export const useWalletStore = create<WalletStateClient>()(
  persist(
    (set, get) => ({
      wallet: null,
      config: {
        portalUrl: DEFAULTS.PORTAL_URL,
        configPaymaster: {
          paymasterUrl: DEFAULTS.PAYMASTER_URL,
        },
        rpcUrl: DEFAULTS.RPC_ENDPOINT,
      },
      connection: new Connection(DEFAULTS.RPC_ENDPOINT!, DEFAULT_COMMITMENT),
      isLoading: false,
      isConnecting: false,
      isSigning: false,
      error: null,

      setConfig: (config: WalletConfig) => {
        try {
          // Info log removed
          const connection = new Connection(
            config.rpcUrl || DEFAULTS.RPC_ENDPOINT!,
            DEFAULT_COMMITMENT
          );
          set({ config, connection });
          // Info log removed
        } catch (error) {
          logger.error('Failed to update wallet configuration:', error, { config });
          throw new Error(`Failed to update configuration: ${error}`);
        }
      },

      setWallet: (wallet: WalletInfo | null) => {
        try {
          set({ wallet });
          // Debug log removed
        } catch (error) {
          logger.error('Failed to set wallet:', error, { wallet });
          throw error;
        }
      },

      setLoading: (isLoading: boolean) => set({ isLoading }),
      setConnecting: (isConnecting: boolean) => set({ isConnecting }),
      setSigning: (isSigning: boolean) => set({ isSigning }),
      setConnection: (connection: Connection) => {
        try {
          set({ connection });
          // Debug log removed
        } catch (error) {
          logger.error('Failed to set connection:', error, { endpoint: connection?.rpcEndpoint });
          throw error;
        }
      },
      setError: (error: Error | null) => {
        set({ error });
        if (error) {
          logger.error('Error state set:', error);
        } else {
          // Debug log removed
        }
      },
      clearError: () => {
        set({ error: null });
        // Debug log removed
      },

      connect: (options: ConnectOptions) => connectAction(get, set, options),
      disconnect: () => disconnectAction(set),
      signAndExecuteTransaction: (payload: SignAndSendTransactionPayload, options: SignOptions) =>
        signAndExecuteTransaction(get, set, payload, options),
      signMessage: (message: string, options: SignOptions) => signMessageAction(get, set, message, options),
      createSession: (payload: CreateSessionPayload, options: SignOptions) =>
        createSessionAction(get, set, payload, options),
      revokeSession: (payload: RevokeSessionPayload, options: SignOptions) =>
        revokeSessionAction(get, set, payload, options),
      signAndSendWithSession: (payload: SessionSignPayload, options) =>
        signAndSendWithSessionAction(get, set, payload, options),
      addAuthorityEd25519: (payload: AddAuthorityPayload, options: SignOptions) =>
        addAuthorityEd25519Action(get, set, payload, options),
      removeAuthority: (payload: RemoveAuthorityPayload, options: SignOptions) =>
        removeAuthorityAction(get, set, payload, options),
      authorizeAndExecute: (payload: AuthorizeExecutePayload, options: SignOptions) =>
        authorizeAndExecuteAction(get, set, payload, options),
      authorizeDeferred: (payload: AuthorizePayload, options: SignOptions) =>
        authorizeDeferredAction(get, set, payload, options),
      executeDeferred: (payload: ExecuteDeferredPayload, options?: TxCallbacks) =>
        executeDeferredAction(get, set, payload, options),
      reclaimDeferred: (payload: ReclaimDeferredPayload, options?: TxCallbacks) =>
        reclaimDeferredAction(get, set, payload, options),
      listAuthorities: () => listAuthoritiesAction(get),
      transferSol: (payload: TransferSolPayload, options: SignOptions) =>
        transferSolAction(get, set, payload, options),
    }),
    {
      name: STORAGE_KEYS.WALLET,
      storage: createJSONStorage(() => storage),
      version: 1,
      partialize: (state: WalletStateClient) => ({
        wallet: state.wallet,
        config: state.config,
      }),
      /**
       * v0 → v1: `smartWallet` used to hold the wallet PDA; now it holds the
       * vault PDA. Derive the vault so persisted users keep working.
       */
      migrate: (persisted: any, fromVersion: number) => {
        if (fromVersion < 1 && persisted?.wallet && !persisted.wallet.walletPda) {
          try {
            const oldWalletPda = new PublicKey(persisted.wallet.smartWallet);
            const [vaultPda] = findVaultPda(oldWalletPda);
            persisted.wallet = {
              ...persisted.wallet,
              smartWallet: vaultPda.toBase58(),
              walletPda: oldWalletPda.toBase58(),
            };
          } catch (err) {
            logger.error('Failed to migrate persisted wallet v0→v1, clearing:', err);
            persisted.wallet = null;
          }
        }
        return persisted;
      },
    }
  )
);
