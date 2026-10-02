/**
 * Wallet Store - Zustand store with integrated business logic
 * Includes state management, persistence, and wallet actions
 */

import { registerCluster } from '../core/program';
import { Connection } from '@solana/web3.js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  abandonConnect,
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
import { reportOutcome } from '../core/wallet/utils';
import { onAdapterDisconnect } from '../core/wallet/disconnects';

import { WalletInfo, WalletConfig, storage } from '../core/storage';
import { DEFAULTS, DEFAULT_COMMITMENT } from '../config';
import { WalletState, type AddAuthorityPayload } from '../core/types';
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
        registerCluster(config.rpcUrl || DEFAULTS.RPC_ENDPOINT, config.cluster);
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

      // Wallet actions. Each call's onSuccess / onFail runs once the action
      // is over (`isSigning` / `isConnecting` cleared, unless the call was
      // refused because another holds it), right before its promise settles;
      // what a callback throws changes nothing (see `reportOutcome`).
      connect: (options) => reportOutcome(options, () => connectAction(get, set, options)),
      disconnect: (options) => reportOutcome(options, () => disconnectAction(get, set, options)),
      signAndSendTransaction: (payload) =>
        reportOutcome(payload, () => signAndSendTransactionAction(get, set, payload)),
      signMessage: (message, options) => reportOutcome(options, () => signMessageAction(get, set, message)),

      // Session key actions
      createSession: (payload) =>
        reportOutcome(
          {
            onSuccess: payload?.onSuccess && ((r) => payload.onSuccess!(r.sessionPda, r.sessionPublicKey)),
            onFail: payload?.onFail,
          },
          () => createSessionAction(get, set, payload ?? {}),
        ),
      revokeSession: (payload) => reportOutcome(payload, () => revokeSessionAction(get, set, payload ?? {})),
      signAndSendWithSession: (payload) =>
        reportOutcome(payload, () => signAndSendWithSessionAction(get, set, payload)),

      // Ed25519 authority actions
      addAuthority: (payload) =>
        reportOutcome(
          {
            onSuccess: payload?.onSuccess && ((r) => payload.onSuccess!(r.authorityPda, r.authorityPublicKey)),
            onFail: payload?.onFail,
          },
          // A call from JavaScript may omit the payload: refused for its role.
          () => addAuthorityAction(get, set, payload ?? ({} as AddAuthorityPayload)),
        ),
      removeAuthority: (targetAuthorityPda, options) =>
        reportOutcome(options, () => removeAuthorityAction(get, set, { targetAuthorityPda })),
      signAndSendWithAuthority: (payload) =>
        reportOutcome(payload, () => signAndSendWithAuthorityAction(get, set, payload)),

      // Deferred execution
      authorizeAndExecute: (payload) => reportOutcome(payload, () => authorizeAndExecuteAction(get, set, payload)),
      authorizeDeferred: (payload) => reportOutcome(payload, () => authorizeDeferredAction(get, set, payload)),
      executeDeferred: (payload) => reportOutcome(payload, () => executeDeferredAction(get, set, payload)),
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

// `LazorkitWalletAdapter.disconnect()` (and the Wallet Standard
// `standard:disconnect`, which calls it) disconnects the store too, as the
// store's own `disconnect` would: a connect still running is abandoned, and
// the wallet goes. The stored wallet is the one both connect, and a store
// left connected would keep a kept key signing after the user signed out:
// the authority key, and a session key kept with `keepSessionKeys`. The
// adapter clears the stored wallet and deletes the session key (unless
// `keepSessionKeys`) itself; `isSigning` is left to the action running, as
// the store's `disconnect` leaves it.
onAdapterDisconnect(() => {
  abandonConnect();
  useWalletStore.setState({ wallet: null, error: null, isConnecting: false, isLoading: false });
});
