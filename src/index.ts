// src/index.ts
// Core exports
export { Lazorkit } from './core/Lazorkit';
export { DialogManager } from './core/dialog/DialogManager';
export { SmartWallet } from './core/wallet/SmartWallet';
export { Paymaster } from './core/wallet/Paymaster';

// Type exports
export * from './types';

// Utility exports
export * from './utils';

// Constant exports
export * from './constants';

// Re-export commonly used Solana types
export { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  Connection,
  Keypair
} from '@solana/web3.js';