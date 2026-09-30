/**
 * The deferred flow's window, and what happens when TX2 comes too late.
 *
 * TX1 (Authorize) consumes the passkey's counter and writes a DeferredExec
 * account, with the paymaster's rent in it. The program accepts TX2
 * (ExecuteDeferred) through `expires_at` = TX1's slot + `expiryOffset`, and
 * refuses it after that with DeferredAuthorizationExpired (3014). The rent
 * comes back when TX2 runs, or, once the window has passed, with
 * ReclaimDeferred signed by the Authorize payer.
 *
 * The window is counted in slots, and a slot has no fixed length: devnet ran
 * at about 230 ms a slot in September 2026, mainnet nearer 400 ms. So the
 * default window is sized from the wallet's own worst case, in time, at a fast
 * slot. `authorizeAndExecute` builds TX2 only once TX1 is confirmed, and it
 * waits up to two minutes for that (plus up to 90 s for the paymaster's
 * answer to TX1).
 */
import type { Connection, PublicKey } from '@solana/web3.js';
import { DEFAULTS } from '../../config';

/** The program's DeferredAuthorizationExpired, seen as `custom program error: 0xbc6`. */
export const DEFERRED_EXPIRED_CODE = 3014;

/** The `expiryOffset` range the program accepts; outside it, Authorize fails with InvalidExpiryWindow (3016). */
export const MIN_DEFERRED_EXPIRY_SLOTS = 10;
export const MAX_DEFERRED_EXPIRY_SLOTS = 9_000;

/**
 * The window the wallet authorizes when the caller passes no `expiryOffset`
 * (`DEFAULTS.DEFERRED_EXPIRY_SLOTS`, 1500 slots). That is 5 minutes at 200 ms a
 * slot (faster than devnet or mainnet runs) and about 10 minutes at 400 ms,
 * against the wallet's own worst case of about 3.5 minutes between TX1
 * landing and TX2 being sent.
 */
export const DEFAULT_DEFERRED_EXPIRY_SLOTS: number = DEFAULTS.DEFERRED_EXPIRY_SLOTS;

/** DeferredExec: [header 8][instructions_hash 32][accounts_hash 32][wallet 32][authority 32][payer 32][expires_at u64]. */
const EXPIRES_AT_OFFSET = 168;
const READ_TIMEOUT_MS = 10_000;

/**
 * TX2 of a deferred execution can no longer run: the authorization TX1 wrote
 * has expired (DeferredAuthorizationExpired, 3014). Nothing in the payload
 * ran. The passkey approval is spent (TX1 used its counter), so ask the user
 * to approve again.
 *
 * The DeferredExec account keeps the paymaster's rent until the Authorize
 * payer closes it with ReclaimDeferred (`LazorKitClient.reclaimDeferred`
 * with `deferredExecPda`), which the program allows once `expiresAtSlot`
 * has passed.
 */
export class DeferredExpiredError extends Error {
    readonly code = DEFERRED_EXPIRED_CODE;
    constructor(
        /** The DeferredExec account TX1 wrote, which still holds the rent. */
        readonly deferredExecPda: PublicKey,
        /** TX1's (Authorize) signature, when this call sent it. */
        readonly authorizeSignature: string | undefined,
        /** The last slot the program accepted TX2 in, when it was read. */
        readonly expiresAtSlot: bigint | undefined,
        cause?: unknown,
    ) {
        super(
            `The deferred authorization ${deferredExecPda.toBase58()} expired` +
                (expiresAtSlot !== undefined ? ` after slot ${expiresAtSlot}` : '') +
                ' before its ExecuteDeferred ran (DeferredAuthorizationExpired, 3014), so nothing in it ran' +
                (authorizeSignature ? `. Authorize: ${authorizeSignature}` : '') +
                '. Ask the user to approve again; the account keeps its rent until the Authorize payer reclaims it.',
        );
        this.name = 'DeferredExpiredError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        const e = error as { logs?: unknown; data?: unknown; cause?: unknown; transactionError?: unknown };
        return [
            error.message,
            JSON.stringify(e.logs ?? ''),
            JSON.stringify(e.data ?? ''),
            JSON.stringify(e.transactionError ?? ''),
            e.cause instanceof Error ? e.cause.message : String(e.cause ?? ''),
        ].join(' ');
    }
    return typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error));
}

/**
 * The error has the shape of a 3014, as web3.js text (`0xbc6`), a
 * TransactionError in JSON (`"Custom":3014`) or as Kora prints it
 * (`Custom(3014)`). An inner program may use the same code: whether the
 * authorization really expired is read from the chain (`executeBeforeExpiry`).
 */
export function isDeferredExpiredError(error: unknown): boolean {
    const text = errorText(error);
    return (
        /custom program error: 0xbc6\b/i.test(text) ||
        /"Custom":\s*3014\b/.test(text) ||
        /Custom\(\s*3014\s*\)/.test(text)
    );
}

/** Throws when `expiryOffset` is outside what the program accepts; the default when it is absent. */
export function deferredExpiryOffset(expiryOffset: number | undefined): number {
    if (expiryOffset === undefined) return DEFAULT_DEFERRED_EXPIRY_SLOTS;
    if (
        !Number.isInteger(expiryOffset) ||
        expiryOffset < MIN_DEFERRED_EXPIRY_SLOTS ||
        expiryOffset > MAX_DEFERRED_EXPIRY_SLOTS
    ) {
        throw new RangeError(
            `expiryOffset must be a whole number of slots from ${MIN_DEFERRED_EXPIRY_SLOTS} to ${MAX_DEFERRED_EXPIRY_SLOTS}; got ${expiryOffset}`,
        );
    }
    return expiryOffset;
}

/**
 * A DeferredExec account's `expires_at` and the slot it was read at.
 * `expiresAtSlot` is undefined when the account is not there (not yet on
 * that node, executed, or reclaimed) or too short to read.
 */
export async function readDeferredExpiry(
    connection: Connection,
    deferredExecPda: PublicKey,
): Promise<{ slot: number; expiresAtSlot: bigint | undefined }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`RPC request timed out after ${READ_TIMEOUT_MS} ms`)), READ_TIMEOUT_MS);
    });
    try {
        const { context, value } = await Promise.race([
            connection.getAccountInfoAndContext(deferredExecPda, 'confirmed'),
            timeout,
        ]);
        const data = value?.data;
        if (!data || data.length < EXPIRES_AT_OFFSET + 8) return { slot: context.slot, expiresAtSlot: undefined };
        let expiresAtSlot = 0n;
        for (let i = 7; i >= 0; i--) expiresAtSlot = (expiresAtSlot << 8n) | BigInt(data[EXPIRES_AT_OFFSET + i]);
        return { slot: context.slot, expiresAtSlot };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Send TX2 (`send`) for the authorization at `deferredExecPda`, unless it has
 * already expired, and report an expiry as `DeferredExpiredError`.
 *
 * - Before sending: when the account reads as expired, nothing is sent. A
 *   failed read does not hold TX2 back.
 * - After a 3014 (from the paymaster's simulation, or on chain): the account
 *   is read again. Unless it shows the authorization still open (then the
 *   3014 was an inner program's, and that error is thrown as it came), the
 *   call rejects with `DeferredExpiredError`.
 */
export async function executeBeforeExpiry<T>(params: {
    connection: Connection;
    deferredExecPda: PublicKey;
    /** TX1's signature, when this call sent it. */
    authorizeSignature?: string;
    send: () => Promise<T>;
}): Promise<T> {
    const { connection, deferredExecPda, authorizeSignature } = params;
    let expiresAtSlot: bigint | undefined;
    try {
        const read = await readDeferredExpiry(connection, deferredExecPda);
        expiresAtSlot = read.expiresAtSlot;
        if (read.expiresAtSlot !== undefined && BigInt(read.slot) > read.expiresAtSlot) {
            throw new DeferredExpiredError(deferredExecPda, authorizeSignature, read.expiresAtSlot);
        }
    } catch (error) {
        if (error instanceof DeferredExpiredError) throw error;
        // Could not read it: send anyway, and let the program decide.
    }
    try {
        return await params.send();
    } catch (error) {
        if (!isDeferredExpiredError(error)) throw error;
        let stillOpen = false;
        try {
            const read = await readDeferredExpiry(connection, deferredExecPda);
            if (read.expiresAtSlot !== undefined) {
                expiresAtSlot = read.expiresAtSlot;
                stillOpen = BigInt(read.slot) <= read.expiresAtSlot;
            }
        } catch {
            // Could not read it: the 3014 stands.
        }
        if (stillOpen) throw error;
        throw new DeferredExpiredError(deferredExecPda, authorizeSignature, expiresAtSlot, error);
    }
}
