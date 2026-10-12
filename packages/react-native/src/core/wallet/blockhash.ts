/**
 * Whether a transaction's blockhash can still land it: the cluster's block
 * height (at `confirmed`) is not past its `lastValidBlockHeight`. The
 * paymaster asks this before it resends the same bytes (see
 * ../paymaster/sendPolicy). Bounded in time; a read that fails or takes too
 * long throws, which the paymaster takes as "still valid" (the same bytes are
 * safe to send again).
 */
import type { Connection } from '@solana/web3.js';

const READ_TIMEOUT_MS = 5_000;

export async function blockhashStillValid(connection: Connection, lastValidBlockHeight: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('block height read timed out')), READ_TIMEOUT_MS);
  });
  try {
    const height = await Promise.race([connection.getBlockHeight('confirmed'), timeout]);
    return height <= lastValidBlockHeight;
  } finally {
    clearTimeout(timer);
  }
}
