import type { Commitment } from '@solana/web3.js';

export const DEFAULT_COMMITMENT: Commitment = 'confirmed';

export const STORAGE_KEYS = {
  WALLET: 'lazor-wallet-store',
} as const;
