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
// Signed messages: the challenge every signMessage signs (never the app's
// bytes); the offline check for a message signature by a key; and the check
// that a wallet signed one, with the key read from the chain.
export {
  SIGNED_MESSAGE_DOMAIN,
  signedMessageChallenge,
  verifySignedMessage,
} from './core/message/signedMessage';
export type {
  SignMessageResult,
  SignedMessageInput,
  VerifySignedMessageParams,
} from './core/message/signedMessage';
export { verifyWalletMessage } from './core/message/verifyWalletMessage';
export type { VerifyWalletMessageParams } from './core/message/verifyWalletMessage';
// How a sent transaction ended: every send resolves once it is confirmed.
export {
  TransactionFailedError,
  TransactionExpiredError,
  TransactionOutcomeUnknownError,
  ConfirmationTimeoutError,
  PreviousTransactionPendingError,
} from './core/wallet/sequence';
// A deferred execution whose authorization expired before TX2 ran (3014).
export {
  DeferredExpiredError,
  isDeferredExpiredError,
  DEFERRED_EXPIRED_CODE,
  MIN_DEFERRED_EXPIRY_SLOTS,
  MAX_DEFERRED_EXPIRY_SLOTS,
} from './core/wallet/deferred';
export type { DeferredFailureContext } from './core/wallet/deferred';
// A session send refused for SOL (3037) or a token (3038) its actions do not name.
export {
  UnlistedSolOutflowError,
  UnlistedTokenOutflowError,
  isUnlistedSolOutflowError,
  isUnlistedTokenOutflowError,
  UNLISTED_SOL_OUTFLOW_CODE,
  UNLISTED_TOKEN_OUTFLOW_CODE,
} from './core/wallet/policy';
export type { PolicySigner } from './core/wallet/policy';
export { PaymasterError } from './core/paymaster';
// What a `txVersion: 'v1'` request (SIMD-0385, experimental, devnet only)
// throws when it cannot be sent. Nothing was sent; never thrown otherwise.
export { TransactionTooLargeError, PayloadExceedsProgramLimitsError } from './core/wallet/txv1';
export * from './config';
export * from './program';
