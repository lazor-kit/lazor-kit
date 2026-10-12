/**
 * Wallet creations whose outcome is not known yet, so that a quick retry
 * does not create a second wallet for the same passkey.
 *
 * A wallet's address comes from a random seed. When the paymaster's answer to
 * its creation is lost, connect fails with `TransactionOutcomeUnknownError` at
 * once, and the creation may still land. A connect made meanwhile would not
 * find it yet (or would offer it to the user as a wallet never signed for),
 * and would create another one under a new seed. So the seed is kept, per
 * program, relying party and credential, until the creation is known to have
 * landed, or for `TTL_MS`:
 * - the next creation for the same passkey key uses the same seed, so it can
 *   only ever create that one wallet;
 * - a connect that finds that wallet, proven to be this passkey's and
 *   controlled by it alone, adopts it without asking (see `resolveWallet`).
 *
 * Kept in memory, for as long as the app runs (as @lazorkit/wallet keeps it
 * for a page, and across reloads).
 */
import { Buffer } from 'buffer';

/** Longer than any blockhash lives: by then the creation has landed or never will. */
const TTL_MS = 10 * 60_000;

export interface PendingCreation {
  /** The seed the wallet's address comes from. */
  readonly seed: Uint8Array;
  /** The wallet PDA (base58) that seed gives. */
  readonly walletPda: string;
  /** The passkey key it is created for. */
  readonly compressedPubkey: Uint8Array;
}

const memory = new Map<string, PendingCreation & { at: number }>();

function keyOf(programId: string, credentialIdHash: Uint8Array, rpId: string): string {
  return `${programId}:${rpId}:${Buffer.from(credentialIdHash).toString('hex')}`;
}

/** The creation still pending for this passkey on this program and relying party, if any. */
export function pendingCreation(programId: string, credentialIdHash: Uint8Array, rpId: string): PendingCreation | null {
  const key = keyOf(programId, credentialIdHash, rpId);
  const stored = memory.get(key);
  if (!stored) return null;
  if (Date.now() - stored.at > TTL_MS) {
    memory.delete(key);
    return null;
  }
  return stored;
}

/** Kept before the creation is sent; forgotten once it is known to have landed. */
export function rememberCreation(
  programId: string,
  credentialIdHash: Uint8Array,
  rpId: string,
  creation: PendingCreation,
): void {
  memory.set(keyOf(programId, credentialIdHash, rpId), {
    seed: new Uint8Array(creation.seed),
    walletPda: creation.walletPda,
    compressedPubkey: new Uint8Array(creation.compressedPubkey),
    at: Date.now(),
  });
}

export function forgetCreation(programId: string, credentialIdHash: Uint8Array, rpId: string): void {
  memory.delete(keyOf(programId, credentialIdHash, rpId));
}
