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

// Core exports (for advanced usage)
export { SmartWallet } from './core/wallet/SmartWallet';
export { Paymaster } from './core/wallet/Paymaster';
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

