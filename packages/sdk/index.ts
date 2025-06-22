// src/index.ts
// Core exports
export * from './core/Lazorkit';
export { SmartWallet } from './core/wallet/SmartWallet';
export { Paymaster } from './core/wallet/Paymaster';

// Type exports
export * from './types';


// React exports
export * from './core/react';

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

