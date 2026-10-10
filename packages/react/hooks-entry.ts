/**
 * `@lazorkit/wallet/hooks`: the Advanced tier's React hooks. The same
 * `useWallet` and store as the root entry (one per page), the page's client,
 * and the fine-grained status a custom button needs.
 *
 * Coming in a later 4.x, with the 3.x names and parameters: `useSessions`,
 * `useAuthorities`, `useDeferred`, and a headless connect flow.
 */
export { useWallet } from './react/useWallet';
export { useWalletStore } from './react/store';
export { useLazorkitClient, useWalletStatus, useLazorkitState } from './react/hooks';
export type {
  WalletHookInterface,
  EasyWallet,
  ConnectHookOptions,
  SignAndSendHookPayload,
} from './react/useWallet';
export type { LazorkitClient, LazorkitClientState } from './core/client/createClient';
export type { WalletStatus, Step } from './core/embedded/types';
