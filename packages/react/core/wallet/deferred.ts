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
 * default window is sized from the wallet's own wait, in time, at a fast
 * slot. `authorizeAndExecute` builds TX2 only once TX1 is confirmed, and it
 * waits up to two minutes for that (plus up to 90 s for the paymaster's
 * answer to TX1). That is a budget, not a bound: the RPC reads around it and
 * TX2's own send take time too.
 *
 * The window is also how long an approval nobody executes stays executable:
 * the program has no way to cancel an authorization before it expires.
 */
import type { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { DEFAULTS } from '../../config';
import {
    PROGRAM_ID_DEVNET,
    PROGRAM_ID_DEVNET_V1,
    PROGRAM_ID_MAINNET,
    PROGRAM_ID_MAINNET_V1,
} from '../program/utils';

/** The program's DeferredAuthorizationExpired, seen as `custom program error: 0xbc6`. */
export const DEFERRED_EXPIRED_CODE = 3014;

/** The `expiryOffset` range the program accepts; outside it, Authorize fails with InvalidExpiryWindow (3016). */
export const MIN_DEFERRED_EXPIRY_SLOTS = 10;
export const MAX_DEFERRED_EXPIRY_SLOTS = 9_000;

/**
 * The window the wallet authorizes when the caller passes no `expiryOffset`
 * (`DEFAULTS.DEFERRED_EXPIRY_SLOTS`, 1500 slots). That is 5 minutes at 200 ms a
 * slot (faster than devnet or mainnet runs) and about 10 minutes at 400 ms,
 * against the wallet's own budget of about 3.5 minutes between TX1 landing
 * and TX2 being sent.
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
 * The error has the shape of a 3014, from whichever program: web3.js text
 * (`0xbc6`), a TransactionError in JSON (`"Custom":3014`) or as Kora prints it
 * (`Custom(3014)`). The same bytes can never pass again once the slot is past
 * `expires_at`, so the paymaster does not resend one.
 */
export function hasDeferredExpiredCode(error: unknown): boolean {
    const text = errorText(error);
    return (
        /custom program error: 0xbc6\b/i.test(text) ||
        /"Custom":\s*3014\b/.test(text) ||
        /Custom\(\s*3014\s*\)/.test(text)
    );
}

function isLazorKitProgramId(id: string): boolean {
    return [PROGRAM_ID_MAINNET, PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET_V1, PROGRAM_ID_DEVNET_V1].some(
        (programId) => programId.toBase58() === id,
    );
}

/**
 * Whose 3014 this is, as far as the error itself says. An inner program may
 * use 3014 too (Anchor's `AccountNotAssociatedTokenAccount`), and the
 * ExecuteDeferred that CPI'd it then fails with the same code. Only logs tell
 * them apart: the first program that failed with it.
 *
 * - `'lazorkit'`: the logs name LazorKit as the first to fail with it.
 * - `'other'`: not a 3014, or the logs name another program.
 * - `'unknown'`: a 3014 with no logs that name who failed with it (Kora's
 *   text, a TransactionError read from chain).
 */
function deferredExpiredVerdict(error: unknown): 'lazorkit' | 'other' | 'unknown' {
    if (!hasDeferredExpiredCode(error)) return 'other';
    const firstFailure = /Program (\w{32,44}) failed: custom program error: 0xbc6\b/i.exec(errorText(error));
    if (!firstFailure) return 'unknown';
    return isLazorKitProgramId(firstFailure[1]) ? 'lazorkit' : 'other';
}

/**
 * True when the error says a deferred authorization expired: a
 * `DeferredExpiredError` (also one from another copy of this package), or a
 * 3014 whose logs name LazorKit as the first program to fail with it.
 *
 * A 3014 that names no program is not claimed: an inner program may return
 * the same code. `authorizeAndExecute` and `executeDeferred` tell the two
 * apart themselves, and report an expiry as `DeferredExpiredError`.
 */
export function isDeferredExpiredError(error: unknown): boolean {
    if (error instanceof DeferredExpiredError) return true;
    const e = error as { name?: unknown; code?: unknown } | null | undefined;
    if (e && e.name === 'DeferredExpiredError' && e.code === DEFERRED_EXPIRED_CODE) return true;
    return deferredExpiredVerdict(error) === 'lazorkit';
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
    commitment: Commitment = 'confirmed',
): Promise<{ slot: number; expiresAtSlot: bigint | undefined }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`RPC request timed out after ${READ_TIMEOUT_MS} ms`)), READ_TIMEOUT_MS);
    });
    try {
        const { context, value } = await Promise.race([
            connection.getAccountInfoAndContext(deferredExecPda, commitment),
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

/** What a TX2 failure carries about the authorization it was for. */
export interface DeferredFailureContext {
    /** The DeferredExec account TX1 wrote. */
    deferredExecPda?: PublicKey;
    /** TX1's (Authorize) signature, when this call sent it. */
    authorizeSignature?: string;
    /** The last slot the program accepts TX2 in, when it was read. */
    expiresAtSlot?: bigint;
}

function withContext(error: unknown, context: DeferredFailureContext): unknown {
    if (!(error instanceof Error) || !Object.isExtensible(error)) return error;
    const target = error as Error & DeferredFailureContext;
    for (const key of ['deferredExecPda', 'authorizeSignature', 'expiresAtSlot'] as const) {
        if (context[key] !== undefined && target[key] === undefined) {
            (target as unknown as Record<string, unknown>)[key] = context[key];
        }
    }
    return error;
}

/** The slot a transaction that failed on chain landed in (`TransactionFailedError`). */
function landedSlot(error: unknown): number | undefined {
    const e = error as { slot?: unknown; transactionError?: unknown } | null | undefined;
    return e && typeof e.slot === 'number' && e.transactionError !== undefined ? e.slot : undefined;
}

/**
 * Whether TX2's 3014 is the authorization's expiry. The program checks
 * `clock.slot > expires_at` before it runs any inner instruction, and returns
 * 3014 nowhere else, so:
 *
 * 1. Logs that name the first program to fail with it decide.
 * 2. On chain, the slot it landed in decides: past `expires_at`, LazorKit
 *    refused it; at or before, an inner program returned it.
 * 3. From the paymaster's simulation, whose slot is not known: an expiry only
 *    when the chain is past `expires_at` now (read at `processed`, the bank a
 *    paymaster simulates on; `confirmed` trails it). Then the same
 *    authorization can never run.
 *
 * Anything else (no logs, the account not read) is not called an expiry.
 */
async function isExpiry(
    connection: Connection,
    deferredExecPda: PublicKey,
    error: unknown,
    known: bigint | undefined,
): Promise<{ expired: boolean; expiresAtSlot: bigint | undefined }> {
    const byLogs = deferredExpiredVerdict(error);
    if (byLogs !== 'unknown') return { expired: byLogs === 'lazorkit', expiresAtSlot: known };
    const slot = landedSlot(error);
    let expiresAtSlot = known;
    let now: number | undefined;
    if (slot === undefined || expiresAtSlot === undefined) {
        try {
            const read = await readDeferredExpiry(connection, deferredExecPda, 'processed');
            now = read.slot;
            expiresAtSlot ??= read.expiresAtSlot;
        } catch {
            // Not read: it cannot be told from here.
        }
    }
    if (expiresAtSlot === undefined) return { expired: false, expiresAtSlot };
    if (slot !== undefined) return { expired: BigInt(slot) > expiresAtSlot, expiresAtSlot };
    return { expired: now !== undefined && BigInt(now) > expiresAtSlot, expiresAtSlot };
}

/**
 * Send TX2 (`send`) for the authorization at `deferredExecPda`, unless it has
 * already expired, and report an expiry as `DeferredExpiredError`.
 *
 * - Before sending: when the account reads as expired, nothing is sent. A
 *   failed read does not hold TX2 back.
 * - After a 3014 (from the paymaster's simulation, or on chain): it is an
 *   expiry only when that is established (`isExpiry`). Otherwise the error is
 *   thrown as it came: an inner program's 3014, or one whose owner cannot be
 *   told, is not reported as an expiry.
 * - Any error from TX2 carries `deferredExecPda`, `authorizeSignature` (when
 *   this call sent TX1) and `expiresAtSlot` (when it was read).
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
        if (hasDeferredExpiredCode(error)) {
            const verdict = await isExpiry(connection, deferredExecPda, error, expiresAtSlot);
            expiresAtSlot = verdict.expiresAtSlot;
            if (verdict.expired) throw new DeferredExpiredError(deferredExecPda, authorizeSignature, expiresAtSlot, error);
        }
        throw withContext(error, { deferredExecPda, authorizeSignature, expiresAtSlot });
    }
}
