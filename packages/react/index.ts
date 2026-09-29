/**
 * LazorKit Web SDK - Main Entry Point
 * Web SDK with React components, hooks, and core wallet functionality
 */

// React exports (main interface)
export { LazorkitProvider } from './react/LazorkitProvider';
export { useWallet } from './react/useWallet';
export { useWalletStore } from './react/store';

// Type exports
export type { WalletInfo, WalletConfig } from '././core/storage';
export type { WalletHookInterface, ConnectHookOptions } from './react/useWallet';
export type { SpendingLimits } from './core/types';

// Core exports (for advanced usage)
export { DialogManager, PortalCancelledError } from './core/portal';
export { StorageManager } from '././core/storage';

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

export { Paymaster } from './core/paymaster/paymaster';
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

