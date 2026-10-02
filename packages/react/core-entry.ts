/**
 * `@lazorkit/wallet/core`: everything that does not need React. The wallet
 * client (`createLazorkitClient`), Embedded mode's building blocks, the error
 * taxonomy, message verification, the protocol helpers, and the 3.x exports
 * that were never React's. Server code (a route handler verifying a message)
 * imports from here: the root and `/hooks` entries are client modules.
 *
 * The root entry re-exports all of this, so no 3.x import path breaks.
 */

// The wallet without React: one client per page, over the page's one store.
export { createLazorkitClient, getLazorkitClient, deriveStatus } from './core/client/createClient';
export type { LazorkitClient, LazorkitClientState } from './core/client/createClient';
export { resolveConfig, validateRpId } from './core/client/validate';
export type {
  LazorkitClientConfig,
  LazorkitOptions,
  EmbeddedOptions,
  PortalOptions,
  RpIdCheck,
} from './core/client/validate';

// Errors: one kind per failure, and the words to show a user.
export {
  UserRejectedError,
  isUserRejection,
  PasskeyMismatchError,
  KeyRecoveryError,
  PasskeyUnavailableError,
  LazorkitConfigError,
  NetworkError,
  WalletVerificationError,
  errorKind,
  userMessage,
} from './core/errors';
export type { ErrorKind, UserRejectionReason, LazorkitConfigProblem } from './core/errors';

// Embedded mode's building blocks.
export {
  passkeyCapabilities,
  derToLowS,
  publicKeyFromAttestation,
} from './core/embedded/webauthn';
export type { PasskeyCapabilities } from './core/embedded/webauthn';
export { forgetEmbeddedDevice } from './core/embedded/records';
export { builtinEmbeddedUi } from './core/embedded/sheets';
export type {
  WalletStatus,
  Step,
  Availability,
  ConnectHow,
  CeremonyKind,
  LazorkitEvent,
  EmbeddedUi,
  TxReview,
  TxReviewRow,
} from './core/embedded/types';

// Type exports
export type { WalletInfo, WalletConfig } from './core/storage';
export type {
  SpendingLimits,
  ActionCallbacks,
  ConnectOptions,
  DisconnectOptions,
  RemoveAuthorityOptions,
  SignMessageOptions,
  SignAndSendPayload,
  SignAndSendTransactionPayload,
  WalletState,
} from './core/types';
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

// Core exports (for advanced usage)
export { DialogManager, PortalCancelledError } from './core/portal';
export { StorageManager } from './core/storage';
// Deletes the session and authority keys the SDK keeps (createSession,
// addAuthority), e.g. at sign-out.
export { forgetStoredKeys } from './core/keys';
// A kept key signs only for the wallet it was made for: the refusal when
// another wallet, or none, is connected.
export { KeyWalletMismatchError, isKeyWalletMismatchError } from './core/wallet/keyBinding';
export type { KeyWalletMismatchReason } from './core/wallet/keyBinding';

// Configuration exports
export * from './config';

// Utility exports
export * from './utils';
// Passkey credential helper — exposed so UIs can derive authorityPda from
// `wallet.credentialId` without reaching into private SDK paths.
export { getCredentialHash } from './core/wallet/utils';

// Re-export commonly used Solana types
export {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
  Keypair
} from '@solana/web3.js';

export { Paymaster, PaymasterError } from './core/paymaster/paymaster';
export * from './core/adapter';
export { LazorKitClient } from './core/program';
// Program helpers: PDAs, actions, serialize/deserialize, constants, etc.
export {
  findWalletPda,
  findVaultPda,
  findAuthorityPda,
  findSessionPda,
  findDeferredExecPda,
  findProtocolConfigPda,
  findFeeRecordPda,
  findTreasuryShardPda,
  readAuthorityPubkey,
  readAuthorityCounter,
  serializeDeferredPayload,
  deserializeDeferredPayload,
  Actions,
  ROLE_OWNER,
  ROLE_ADMIN,
  ROLE_SPENDER,
  AUTH_TYPE_ED25519,
  AUTH_TYPE_SECP256R1,
  PROGRAM_ID,
  PROGRAM_ADDRESS,
} from './core/program';
// v1 and v2 side by side: which protocol a wallet is on, the program ids of
// both, and the error a v1 wallet gets once LazorKit v1 is retired.
export {
  V1WalletRetiredError,
  isRetiredDeploymentError,
  RETIRED_DEPLOYMENT_CODE,
  PROGRAM_ID_MAINNET,
  PROGRAM_ID_DEVNET,
  PROGRAM_ID_MAINNET_V1,
  PROGRAM_ID_DEVNET_V1,
} from './core/program';
export type { ProtocolVersion } from './core/program';
export {
  V1WalletMigratedError,
  registerCluster,
} from './core/program';
// A passkey signature over a counter already used (3006), and how a sent
// transaction ended: every send resolves once it is confirmed.
export {
  SignatureReusedError,
  isSignatureReusedError,
  SIGNATURE_REUSED_CODE,
} from './core/program';
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
// Which wallet is a passkey's own (the credential hash alone is public): what
// connect asks the user when it will not adopt one on its own.
export {
  WalletNeedsConfirmationError,
  WalletConfirmationDeclinedError,
} from './core/wallet/confirmation';
export type {
  WalletChoice,
  ConfirmWalletRequest,
  ConfirmWalletHandler,
  OnConfirmWallet,
} from './core/wallet/confirmation';
// The rule itself, from @lazorkit/sdk-legacy, for apps that find wallets on
// their own.
export {
  createOwnershipChallenge,
  OWNERSHIP_PROOF_DOMAIN,
  verifyOwnershipProof,
  pickOwnWallet,
  selectWalletByAddress,
} from './core/program';
export type {
  OwnershipProof,
  PasskeyWalletCandidate,
  WalletFacts,
  AuthorityRoleName,
} from './core/program';
// Runtime error decoding helpers.
export { errorFromCode, extractErrorCode, ERROR_NAMES } from './core/program';
export type { DeferredPayload, SessionAction } from './core/program';

// On-chain session-state helpers — read the cap/expiry/actions a session
// was minted with, so clients can render "X SOL remaining, Y m until expiry"
// without re-implementing the byte layout.
export { SessionAccount, AuthorityAccount } from './core/program';
export { SessionActionType, serializeActions } from './core/program';

