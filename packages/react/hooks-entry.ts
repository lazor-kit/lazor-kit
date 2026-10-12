/**
 * `@lazorkit/wallet/hooks`: the Advanced tier's React hooks. The same
 * `useWallet` and store as the root entry (one per page), the page's client,
 * and the fine-grained status a custom button needs.
 *
 * `useSessions`, `useAuthorities` and `useDeferred`: the session, authority
 * and deferred actions, with `useWallet()`'s names and parameters (where they
 * warn that they move here). Coming in a later 4.x: a headless connect flow.
 */
export { useWallet } from './react/useWallet';
export { useWalletStore } from './react/store';
export { useLazorkitClient, useWalletStatus, useLazorkitState } from './react/hooks';
export { useSessions, useAuthorities, useDeferred } from './react/advancedHooks';
export type { SessionsHook, AuthoritiesHook, DeferredHook } from './react/advancedHooks';
export type {
  WalletHookInterface,
  EasyWallet,
  ConnectHookOptions,
  SignAndSendHookPayload,
} from './react/useWallet';
export type { LazorkitClient, LazorkitClientState } from './core/client/createClient';
export type { WalletStatus, Step } from './core/embedded/types';
