import { PublicKey } from '@solana/web3.js';

const optionalKey = (value: unknown): PublicKey | undefined =>
  value ? new PublicKey(value as string) : undefined;

/**
 * Everything the page needs, from the environment. Defaults point at devnet so
 * a local run cannot touch mainnet by accident.
 *
 * Two program ids are involved. LazorKit v2 runs at its own id, and the v1 id
 * — where the user's old wallet lives — runs a sunset binary that serves the
 * migration and nothing else. The migration executes at the v1 id and
 * delivers into a v2 wallet at the v2 id. Both are inferred from the RPC URL
 * (the SDK pairs each cluster's v2 id with its v1 id); set them only for a
 * non-standard pairing, like the devnet rehearsal slot.
 *
 * The RPC must allow `getProgramAccounts` with memcmp filters: finding a user's
 * v1 wallet from their passkey is a scan, and most public endpoints refuse it.
 */
export const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com',
  portalUrl: import.meta.env.VITE_PORTAL_URL ?? 'https://portal.lazor.sh',
  /** Must sponsor both program ids: setup runs at v2, the migration at v1. */
  paymasterUrl: import.meta.env.VITE_PAYMASTER_URL ?? 'https://kora.devnet.lazorkit.com',
  paymasterApiKey: import.meta.env.VITE_PAYMASTER_API_KEY ?? '',
  /** The v2 program. Inferred from the RPC URL when unset. */
  programId: optionalKey(import.meta.env.VITE_PROGRAM_ID),
  /** The v1 program. Paired with the v2 id when unset. */
  v1ProgramId: optionalKey(import.meta.env.VITE_V1_PROGRAM_ID),
};

export const explorerTx = (signature: string): string => {
  const cluster = config.rpcUrl.includes('mainnet') ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
};
