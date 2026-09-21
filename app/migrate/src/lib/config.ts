import { PublicKey } from '@solana/web3.js';

/**
 * Everything the page needs, from the environment. Defaults point at devnet so
 * a local run cannot touch mainnet by accident.
 *
 * The RPC must allow `getProgramAccounts` with memcmp filters: finding a user's
 * v1 wallet from their passkey is a scan, and most public endpoints refuse it.
 */
export const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com',
  portalUrl: import.meta.env.VITE_PORTAL_URL ?? 'https://portal.lazor.sh',
  paymasterUrl: import.meta.env.VITE_PAYMASTER_URL ?? 'https://kora.devnet.lazorkit.com',
  paymasterApiKey: import.meta.env.VITE_PAYMASTER_API_KEY ?? '',
  programId: import.meta.env.VITE_PROGRAM_ID
    ? new PublicKey(import.meta.env.VITE_PROGRAM_ID as string)
    : undefined,
};

export const explorerTx = (signature: string): string => {
  const cluster = config.rpcUrl.includes('mainnet') ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
};
