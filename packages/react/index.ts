/**
 * `@lazorkit/wallet`: the Easy tier. `<LazorkitProvider mode=…>`,
 * `<ConnectButton>`, `useWallet()`; and everything in
 * `@lazorkit/wallet/core`, re-exported, so every 3.x import still works.
 *
 * A client module (React). Server code imports `@lazorkit/wallet/core`.
 */
export * from './core-entry';

// React exports (main interface)
export { LazorkitProvider } from './react/LazorkitProvider';
export type { LazorkitProviderProps } from './react/LazorkitProvider';
export { useWallet } from './react/useWallet';
export { useWalletStore } from './react/store';
export { ConnectButton, connectButtonLabel, CONNECT_BUTTON_TEXT } from './react/ConnectButton';
export type { ConnectButtonProps } from './react/ConnectButton';
export type {
  WalletHookInterface,
  EasyWallet,
  ConnectHookOptions,
  DeferredTxPayload,
  SendTxPayload,
  SignAndSendHookPayload,
} from './react/useWallet';
