/**
 * LazorKit Wallet Mobile Adapter - Main Entry Point
 *
 * React Native SDK for LazorKit smart wallets on Solana with
 * WebAuthn/passkey authentication via the LazorKit portal.
 */

// First: @lazorkit/sdk-legacy's @noble/hashes looks for `crypto` once, when
// it loads, and React Native has it only once this polyfill has run.
import 'react-native-get-random-values';

export { LazorKitProvider } from './react/provider';
export { WalletChooser } from './react/WalletChooser';
export { useWallet, useWallet as useLazorWallet } from './react/hook';
export { useWalletStore } from './react/store';
export * from './types';
export { logger } from './core/logger';
// How a sent transaction ended: every send resolves once it is confirmed.
export {
  TransactionFailedError,
  TransactionExpiredError,
  ConfirmationTimeoutError,
} from './core/wallet/sequence';
export * from './config';
export * from './program';
