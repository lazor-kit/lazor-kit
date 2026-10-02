import { Lazorkit } from '@lazorkit/sdk';
import { Connection, PublicKey } from '@solana/web3.js';

// Initialize Lazorkit SDK
export const lazorkit = new Lazorkit({
  apiKey: process.env.NEXT_PUBLIC_LAZORKIT_API_KEY!,
  network: 'devnet',
});

// Solana connection
export const connection = new Connection(
  process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
);

// USDC Mint on devnet
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);

/**
 * Get USDC balance for a given wallet
 */
export async function getUSDCBalance(walletAddress: string): Promise<number> {
  try {
    const tokenAccounts = await connection.getTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: USDC_MINT }
    );

    if (tokenAccounts.value.length === 0) {
      return 0;
    }

    const accountInfo = await connection.getTokenAccountBalance(
      tokenAccounts.value[0].pubkey
    );

    return accountInfo.value.uiAmount || 0;
  } catch (error) {
    console.error('Error getting USDC balance:', error);
    return 0;
  }
}