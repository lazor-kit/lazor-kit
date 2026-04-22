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
export type { DeferredPayload, SessionAction } from './core/program';

