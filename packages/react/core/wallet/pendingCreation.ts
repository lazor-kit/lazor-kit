/**
 * Portal mode's wallet creations whose outcome is not known yet, so that a
 * quick retry does not create a second wallet for the same passkey.
 *
 * A portal-mode wallet's address comes from a random seed. When the
 * paymaster's answer to its creation is lost, the connect fails with
 * `TransactionOutcomeUnknownError` at once, and the creation may still land.
 * A connect made meanwhile would not find it yet (or would offer it to the
 * user as a wallet never signed for), and would create another one under a
 * new seed. So the seed is kept, per program, relying party and credential,
 * until the creation is known to have landed, or for `TTL_MS`:
 * - the next creation for the same passkey key uses the same seed, so it can
 *   only ever create that one wallet (a second send of it fails, harmlessly,
 *   once the first has landed);
 * - a connect that finds that wallet, proven to be this passkey's and
 *   controlled by it alone, adopts it without asking (see `settleCandidates`).
 *
 * Kept in this page's memory, and in localStorage (best effort) so a reload
 * keeps it too. The seed is no secret once its creation has been sent.
 */
import { Buffer } from 'buffer';

/** Longer than any blockhash lives: by then the creation has landed or never will. */
const TTL_MS = 10 * 60_000;
const STORAGE_PREFIX = 'lazorkit:pending-creation:';

export interface PendingCreation {
    /** The seed the wallet's address comes from. */
    readonly seed: Uint8Array;
    /** The wallet PDA (base58) that seed gives. */
    readonly walletPda: string;
    /** The passkey key it is created for. */
    readonly compressedPubkey: Uint8Array;
}

interface Stored {
    seed: string;
    walletPda: string;
    compressedPubkey: string;
    at: number;
}

const memory = new Map<string, Stored>();

function keyOf(programId: string, credentialIdHash: Uint8Array, rpId: string): string {
    return `${programId}:${rpId}:${Buffer.from(credentialIdHash).toString('hex')}`;
}

function storage(): Storage | undefined {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        return undefined;
    }
}

function read(key: string): Stored | undefined {
    const inMemory = memory.get(key);
    if (inMemory) return inMemory;
    try {
        const raw = storage()?.getItem(STORAGE_PREFIX + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as Partial<Stored>;
        if (
            typeof parsed.seed !== 'string' ||
            typeof parsed.walletPda !== 'string' ||
            typeof parsed.compressedPubkey !== 'string' ||
            typeof parsed.at !== 'number'
        ) {
            return undefined;
        }
        return parsed as Stored;
    } catch {
        return undefined;
    }
}

/** The creation still pending for this passkey on this program and relying party, if any. */
export function pendingCreation(programId: string, credentialIdHash: Uint8Array, rpId: string): PendingCreation | null {
    const key = keyOf(programId, credentialIdHash, rpId);
    const stored = read(key);
    if (!stored) return null;
    if (Date.now() - stored.at > TTL_MS) {
        forgetCreation(programId, credentialIdHash, rpId);
        return null;
    }
    const seed = new Uint8Array(Buffer.from(stored.seed, 'base64'));
    const compressedPubkey = new Uint8Array(Buffer.from(stored.compressedPubkey, 'base64'));
    if (seed.length !== 32 || compressedPubkey.length !== 33) return null;
    return { seed, walletPda: stored.walletPda, compressedPubkey };
}

/** Kept before the creation is sent; forgotten once it is known to have landed. */
export function rememberCreation(
    programId: string,
    credentialIdHash: Uint8Array,
    rpId: string,
    creation: PendingCreation,
): void {
    const key = keyOf(programId, credentialIdHash, rpId);
    const stored: Stored = {
        seed: Buffer.from(creation.seed).toString('base64'),
        walletPda: creation.walletPda,
        compressedPubkey: Buffer.from(creation.compressedPubkey).toString('base64'),
        at: Date.now(),
    };
    memory.set(key, stored);
    try {
        storage()?.setItem(STORAGE_PREFIX + key, JSON.stringify(stored));
    } catch {
        // Best effort: this page still has it.
    }
}

export function forgetCreation(programId: string, credentialIdHash: Uint8Array, rpId: string): void {
    const key = keyOf(programId, credentialIdHash, rpId);
    memory.delete(key);
    try {
        storage()?.removeItem(STORAGE_PREFIX + key);
    } catch {
        // Nothing stored either.
    }
}
