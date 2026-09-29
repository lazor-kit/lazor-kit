/**
 * A passkey authority's transactions, one after another.
 *
 * A passkey signature commits to its authority's counter + 1. The counter is
 * read when the challenge is prepared, before the prompt opens, and the
 * program rejects any other value with SignatureReused (3006). A signed
 * challenge cannot be repaired afterwards, because it is bound to that counter.
 * So each signature must be prepared from state that already includes every
 * earlier transaction of the same authority. This module makes sure of that:
 *
 * - `confirmSent` waits until a transaction is confirmed. It rejects when the
 *   transaction failed on chain or expired without landing. Every send in the
 *   wallet waits for it before resolving, whenever the paymaster answered: a
 *   relayer that answers once the RPC has accepted a transaction, or Kora with
 *   `respond_after` "sent", answers before the transaction has executed.
 * - `withAuthority` runs one flow per authority at a time, from the counter
 *   read to the settled transaction. A second call for the same passkey waits
 *   for the first instead of preparing from the same counter. That covers a
 *   dApp sending two transactions at once through the adapter, and the adapter
 *   and the store both in use.
 * - Each authority's lane remembers the slot its last transaction landed in.
 *   The next challenge is read at `confirmed` from a node at or past that slot
 *   (`minContextSlot`). A load-balanced RPC node that has not executed that
 *   transaction yet then answers "not there yet" instead of the spent counter.
 *   A send whose outcome is still unknown (its wait timed out) is settled
 *   before the next challenge is read.
 *
 * Module state: one page, shared by the store, the adapter and the Wallet
 * Standard wallet.
 */
import type { Commitment, Connection, PublicKey, TransactionError } from '@solana/web3.js';
import { SignatureReusedError, isSignatureReusedError } from '../program';

/** A sent transaction, with what it takes to tell when it can no longer land. */
export interface SentTransaction {
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
}

/** The transaction landed and failed: fees were paid, nothing else changed. */
export class TransactionFailedError extends Error {
    constructor(
        readonly signature: string,
        readonly transactionError: TransactionError,
        /** The slot it landed in. */
        readonly slot: number,
    ) {
        super(`Transaction ${signature} failed on chain: ${JSON.stringify(transactionError)}`);
        this.name = 'TransactionFailedError';
    }
}

/** The transaction's blockhash expired before it landed: it never will. */
export class TransactionExpiredError extends Error {
    constructor(readonly signature: string) {
        super(`Transaction ${signature} was not confirmed before its blockhash expired, so it did not land.`);
        this.name = 'TransactionExpiredError';
    }
}

/** No outcome within the wait. The transaction may still land. */
export class ConfirmationTimeoutError extends Error {
    constructor(
        readonly signature: string,
        readonly waitedMs: number,
    ) {
        super(
            `Transaction ${signature} was not confirmed within ${Math.round(waitedMs / 1000)} s, and it may ` +
                'still land. Check its status before sending it again.',
        );
        this.name = 'ConfirmationTimeoutError';
    }
}

const POLL_MS = 400;
const BLOCK_HEIGHT_EVERY_MS = 2_000;
const MAX_WAIT_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `sent` is confirmed and return the slot it landed in. The first
 * status read is immediate, so a transaction the paymaster already confirmed
 * (Kora's default) costs one call. Polls `getSignatureStatuses` rather than
 * subscribing, so it works on any RPC URL, with or without websockets.
 *
 * Throws `TransactionFailedError` when it landed and failed,
 * `TransactionExpiredError` when its blockhash expired first, and
 * `ConfirmationTimeoutError` when neither is known after two minutes.
 */
export async function confirmSent(connection: Connection, sent: SentTransaction): Promise<number> {
    const started = Date.now();
    let lastHeightCheck = 0;
    let pastLastValidHeight = false;
    for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await sleep(POLL_MS);
        let status: Awaited<ReturnType<Connection['getSignatureStatuses']>>['value'][number] | undefined;
        try {
            status = (await connection.getSignatureStatuses([sent.signature])).value[0];
        } catch {
            status = undefined; // a failed read says nothing; try again
        }
        if (status) {
            const settled =
                status.confirmationStatus === 'confirmed' ||
                status.confirmationStatus === 'finalized' ||
                status.confirmations === null;
            if (settled) {
                if (status.err) throw new TransactionFailedError(sent.signature, status.err, status.slot);
                return status.slot;
            }
        } else if (status === null) {
            // Unknown to the node. Past its last valid block height, one more
            // read (this loop's next) that still finds nothing means it never
            // landed: a block that held it would be confirmed by now.
            if (pastLastValidHeight) throw new TransactionExpiredError(sent.signature);
            if (Date.now() - lastHeightCheck >= BLOCK_HEIGHT_EVERY_MS) {
                lastHeightCheck = Date.now();
                try {
                    pastLastValidHeight = (await connection.getBlockHeight('confirmed')) > sent.lastValidBlockHeight;
                } catch {
                    // Try again on the next round.
                }
            }
        }
        if (Date.now() - started > MAX_WAIT_MS) throw new ConfirmationTimeoutError(sent.signature, Date.now() - started);
    }
}

/**
 * `confirmSent` for a transaction that consumes no passkey counter, with the
 * same error mapping as a passkey send: a landed failure that is LazorKit's
 * 3006 is reported as `SignatureReusedError`. Resolves with the landed slot.
 */
export async function confirmOrThrow(connection: Connection, sent: SentTransaction): Promise<number> {
    try {
        return await confirmSent(connection, sent);
    } catch (error) {
        throw asSignatureReused(error);
    }
}

function asSignatureReused(error: unknown): unknown {
    if (error instanceof TransactionFailedError && isSignatureReusedError(error.transactionError)) {
        return new SignatureReusedError(error);
    }
    return error;
}

interface Lane {
    /** Resolves when the flow holding this lane now, and every one queued before, is done. */
    tail: Promise<void>;
    /** Sent for this authority, outcome not known yet. */
    unsettled?: SentTransaction;
    /** The slot this authority's last settled transaction landed in. */
    floorSlot?: number;
}

/** By authority PDA (base58). */
const lanes = new Map<string, Lane>();

function laneOf(authority: PublicKey): Lane {
    const key = authority.toBase58();
    let lane = lanes.get(key);
    if (!lane) {
        lane = { tail: Promise.resolve() };
        lanes.set(key, lane);
    }
    return lane;
}

function noteLanded(lane: Lane, slot: number): void {
    lane.floorSlot = Math.max(lane.floorSlot ?? 0, slot);
}

/**
 * Record that a transaction touching `authority` landed in `slot`, for one that
 * did not consume its counter: a wallet's creation. The first challenge read
 * after it is made at or past that slot, where the authority exists.
 */
export function noteAuthorityLanded(authority: PublicKey, slot: number): void {
    noteLanded(laneOf(authority), slot);
}

/** The read options a passkey challenge takes (`Secp256r1Params`). */
export interface ChallengeReads {
    commitment: Commitment;
    minContextSlot?: number;
}

/** What a flow holding an authority's lane can do. */
export interface AuthorityTurn {
    /**
     * How to read the next challenge: at `confirmed`, from a node at or past
     * the slot this authority's last transaction landed in. A send whose
     * outcome is still unknown is waited for first. When it cannot be
     * settled, this throws rather than sign a counter that send may still use.
     */
    challengeReads(connection: Connection): Promise<ChallengeReads>;
    /**
     * Wait until `sent`, a transaction that consumes this authority's counter,
     * is confirmed; resolve with its signature. On any outcome that is known
     * (landed, failed, expired) the lane moves past it. A failure that is
     * LazorKit's 3006 is reported as `SignatureReusedError`.
     */
    confirm(connection: Connection, sent: SentTransaction): Promise<string>;
}

async function settle(lane: Lane, connection: Connection): Promise<void> {
    const sent = lane.unsettled;
    if (!sent) return;
    try {
        noteLanded(lane, await confirmSent(connection, sent));
    } catch (error) {
        if (error instanceof TransactionFailedError) noteLanded(lane, error.slot);
        // Expired: it never landed, so the counter never moved.
        else if (!(error instanceof TransactionExpiredError)) throw error;
    }
    if (lane.unsettled === sent) lane.unsettled = undefined;
}

function turnOf(lane: Lane): AuthorityTurn {
    return {
        async challengeReads(connection) {
            await settle(lane, connection);
            return lane.floorSlot !== undefined
                ? { commitment: 'confirmed', minContextSlot: lane.floorSlot }
                : { commitment: 'confirmed' };
        },
        async confirm(connection, sent) {
            lane.unsettled = sent;
            try {
                noteLanded(lane, await confirmSent(connection, sent));
                lane.unsettled = undefined;
                return sent.signature;
            } catch (error) {
                if (error instanceof TransactionFailedError) {
                    // Failed: its changes, the counter's included, were rolled back.
                    noteLanded(lane, error.slot);
                    lane.unsettled = undefined;
                } else if (error instanceof TransactionExpiredError) {
                    lane.unsettled = undefined;
                }
                // Timed out: stays unsettled, and the next turn settles it first.
                throw asSignatureReused(error);
            }
        },
    };
}

/**
 * Run `fn` with this authority's lane to itself: calls for the same authority
 * run one after another, in the order they were made. Hold it from before the
 * challenge is prepared until the transaction it signs is confirmed.
 */
export async function withAuthority<T>(authority: PublicKey, fn: (turn: AuthorityTurn) => Promise<T>): Promise<T> {
    const lane = laneOf(authority);
    const previous = lane.tail;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    lane.tail = previous.then(() => mine);
    await previous;
    try {
        return await fn(turnOf(lane));
    } finally {
        release();
    }
}
