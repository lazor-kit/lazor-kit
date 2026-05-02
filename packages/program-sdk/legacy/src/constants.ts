import { PublicKey } from '@solana/web3.js';

/**
 * LazorKit Smart Wallet program addresses, per cluster.
 *
 * The on-chain program embeds its ID via `declare_id!` at compile time
 * (see `assertions/src/lib.rs`). A binary compiled with one ID malfunctions
 * if deployed to the other cluster's program slot — so the two binaries
 * (and their deploy keypairs) are wholly distinct artifacts.
 *
 * Use the matching `LazorKitClient.mainnet(...)` / `.devnet(...)` factory
 * to instantiate a client. There is no ambient default — pick a cluster
 * at the call site so you can't accidentally derive PDAs against the
 * wrong program.
 */

/** Mainnet program address (vanity). */
export const PROGRAM_ADDRESS_MAINNET =
  'LazorjRFNavitUaBu5m3WaNPjU1maipvSW2rZfAFAKi';

/** Devnet program address. */
export const PROGRAM_ADDRESS_DEVNET =
  '4h3XoNReAgEcHVxcZ8sw2aufi9MTr7BbvYYjzjWDyDxS';

/** Mainnet program ID. */
export const PROGRAM_ID_MAINNET = new PublicKey(PROGRAM_ADDRESS_MAINNET);

/** Devnet program ID. */
export const PROGRAM_ID_DEVNET = new PublicKey(PROGRAM_ADDRESS_DEVNET);
