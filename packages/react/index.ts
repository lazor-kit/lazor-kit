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
export type { WalletHookInterface } from './react/useWallet';
export type { SpendingLimits } from './core/types';

// Core exports (for advanced usage)
export { DialogManager } from './core/portal';
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
// Prove which wallet is a passkey's own (the credential hash alone is public).
export { findOwnedCandidates, provenCandidates, chooseOwnWallet } from './core/wallet/ownership';
export type { OwnedCandidate, OwnershipProof } from './core/wallet/ownership';
// Runtime error decoding helpers.
export { errorFromCode, extractErrorCode, ERROR_NAMES } from './core/program';
export type { DeferredPayload, SessionAction } from './core/program';

// On-chain session-state helpers — read the cap/expiry/actions a session
// was minted with, so clients can render "X SOL remaining, Y m until expiry"
// without re-implementing the byte layout.
export { SessionAccount, AuthorityAccount } from './core/program';
export { SessionActionType, serializeActions } from './core/program';

