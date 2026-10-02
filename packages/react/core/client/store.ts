/**
 * The wallet store: one per page, framework-free (`zustand/vanilla`). The
 * React binding (`useWalletStore`) and `createLazorkitClient` both use this
 * one.
 *
 * Persisted to localStorage, read synchronously: once configure has run
 * (../client/configure), the state already holds the stored wallet, with no
 * tick in between. Hydration waits for configure (`skipHydration`), which
 * first points the store at its mode's key: `lazorkit-wallet-store` in
 * portal mode (the 3.x key, written with the 3.x bytes), and
 * `lazorkit:embedded:<rpId>:store` in Embedded mode. A config read back from
 * storage is never used: the app's props are the config.
 */
import { Connection } from '@solana/web3.js';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { registerCluster } from '../program';
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
} from '../wallet/actions';
import { reportOutcome } from '../wallet/utils';
import { type WalletConfig, type WalletInfo, syncStorage } from '../storage';
import { DEFAULTS, DEFAULT_COMMITMENT } from '../../config';
import type { AddAuthorityPayload, WalletState } from '../types';
import { rateLimitedFetch } from './rpc';

/** The 3.x key, still the portal mode's. */
export const PORTAL_STORE_NAME = 'lazorkit-wallet-store';

/** The store's key for a config: portal mode's 3.x key, or Embedded's own per rpId. */
export function storeNameFor(config: WalletConfig): string {
    return config.mode === 'embedded' ? `lazorkit:embedded:${config.rpId}:store` : PORTAL_STORE_NAME;
}

/**
 * What is written. Portal mode: the wallet and the config fields 3.3.1
 * wrote, in its order, so the stored bytes are unchanged. Embedded: the
 * wallet only.
 */
function partialize(state: WalletState): { wallet: WalletInfo | null; config?: Partial<WalletConfig> } {
    const c = state.config;
    if (c.mode === 'embedded') return { wallet: state.wallet };
    return {
        wallet: state.wallet,
        config: {
            portalUrl: c.portalUrl,
            paymasterConfig: c.paymasterConfig,
            v1PaymasterConfig: c.v1PaymasterConfig,
            rpcUrl: c.rpcUrl,
            cluster: c.cluster,
            onConfirmWallet: c.onConfirmWallet,
            trustedAuthorities: c.trustedAuthorities,
            watchMints: c.watchMints,
            keyStorage: c.keyStorage,
        },
    };
}

/** The connection for a config: Embedded reads ride out public RPCs' 429s (see ./rpc). */
export function connectionFor(config: WalletConfig): Connection {
    const endpoint = config.rpcUrl || DEFAULTS.RPC_ENDPOINT!;
    return config.mode === 'embedded'
        ? new Connection(endpoint, { commitment: DEFAULT_COMMITMENT, fetch: rateLimitedFetch })
        : new Connection(endpoint, DEFAULT_COMMITMENT);
}

export const walletStore = createStore<WalletState>()(
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
            step: null,
            availability: 'ok',

            // State setters
            setConfig: (config: WalletConfig) => {
                registerCluster(config.rpcUrl || DEFAULTS.RPC_ENDPOINT, config.cluster);
                set({ config, connection: connectionFor(config) });
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
            name: PORTAL_STORE_NAME,
            storage: createJSONStorage(() => syncStorage),
            partialize: partialize as (state: WalletState) => WalletState,
            // Never the stored config: the app's props are the config. Which
            // stored wallet may be restored is set by configure.
            merge: (_persisted, current) => current,
            skipHydration: true,
        },
    ),
);
