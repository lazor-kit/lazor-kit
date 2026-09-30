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
 * - `sendAndConfirm` hands a transaction to the paymaster and waits until it
 *   is confirmed. It rejects when the transaction failed on chain or is known
 *   not to have landed, and says so when its outcome is not known. Every send
 *   in the adapter goes through it: a relayer that answers once the RPC has
 *   accepted a transaction, or Kora with `respond_after` "sent", answers
 *   before the transaction has executed.
 * - "Did not land" is only concluded from a node that has passed the slot at
 *   which the transaction's blockhash expired, and from its transaction
 *   history, not from a status cache that forgets a signature after a few
 *   minutes. Every RPC request is bounded in time.
 * - `withAuthority` runs one flow per authority at a time, from the counter
 *   read to the settled transaction. A second call for the same passkey waits
 *   for the first instead of preparing from the same counter. (The store also
 *   refuses a second request while one is signing; this holds for any caller.)
 * - Each authority's lane remembers the slot its last transaction landed in
 *   (or, when that is not known, a slot past which it can no longer land).
 *   The next challenge is read at `confirmed` from a node at or past that slot
 *   (`minContextSlot`). A load-balanced RPC node that has not executed that
 *   transaction yet then answers "not there yet" instead of the spent counter.
 *   A send whose outcome is still unknown is settled before the next challenge
 *   is read; when it cannot be, nothing is signed.
 *
 * Module state: one per app, shared by every action of the store. The floor
 * slot and an unsettled send are also kept in AsyncStorage for a while, so the
 * app, restarted, reads its first challenge from a node that has them too.
 */
import type { Commitment, Connection, PublicKey, SignatureStatus, TransactionError } from '@solana/web3.js';
import { SignatureReusedError, signatureReusedVerdict } from '../../program';
import { PaymasterError } from '../paymaster';

/** A transaction handed to the paymaster: what it takes to tell when it can no longer land. */
export interface SendAttempt {
  blockhash: string;
  lastValidBlockHeight: number;
}

/** A sent transaction, with what it takes to tell when it can no longer land. */
export interface SentTransaction extends SendAttempt {
  signature: string;
}

/** The transaction landed and failed: fees were paid, nothing else changed. */
export class TransactionFailedError extends Error {
  constructor(
    readonly signature: string,
    readonly transactionError: TransactionError,
    /** The slot it landed in. */
    readonly slot: number,
    /** Its logs, when they were read. */
    readonly logs?: string[],
  ) {
    super(`Transaction ${signature} failed on chain: ${JSON.stringify(transactionError)}`);
    this.name = 'TransactionFailedError';
  }
}

/**
 * The transaction's blockhash expired, and a node that has passed that point
 * has no record of it, in its transaction history included: it did not land,
 * and it never will.
 */
export class TransactionExpiredError extends Error {
  constructor(readonly signature: string) {
    super(`Transaction ${signature} did not land before its blockhash expired, and it cannot land any more.`);
    this.name = 'TransactionExpiredError';
  }
}

/**
 * Whether the transaction landed is not known, so it must not simply be sent
 * again: check its `signature`, or the state it would change, first.
 * `signature` is undefined when the paymaster's answer, which carries it, was
 * lost.
 */
export class TransactionOutcomeUnknownError extends Error {
  constructor(
    message: string,
    readonly signature: string | undefined,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'TransactionOutcomeUnknownError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** No outcome within the wait, and its blockhash had not expired yet: it may still land. */
export class ConfirmationTimeoutError extends TransactionOutcomeUnknownError {
  constructor(
    readonly signature: string,
    readonly waitedMs: number,
  ) {
    super(
      `Transaction ${signature} was not confirmed within ${Math.round(waitedMs / 1000)} s, and it may ` +
        'still land. Check its status before sending it again.',
      signature,
    );
    this.name = 'ConfirmationTimeoutError';
  }
}

/**
 * Nothing was signed or sent for this call. The passkey's previous
 * transaction (`pendingSignature`; undefined when the paymaster's answer for
 * it was lost) has no known outcome yet, and a signature prepared now could
 * be bound to a counter that transaction may still use. Try again later.
 */
export class PreviousTransactionPendingError extends Error {
  constructor(readonly pendingSignature: string | undefined) {
    super(
      `Nothing was signed or sent: this passkey's previous transaction${pendingSignature ? ` ${pendingSignature}` : ''} ` +
        'has no known outcome yet, and a new signature could be prepared from a counter it may still use. ' +
        'Try again once it has settled.',
    );
    this.name = 'PreviousTransactionPendingError';
  }
}

const POLL_MS = 400;
const EXPIRY_CHECK_EVERY_MS = 2_000;
const MAX_WAIT_MS = 120_000;
/** Settling a send whose own wait already ran out: this long, then `PreviousTransactionPendingError`. */
const SETTLE_RETRY_MS = 15_000;
/** One RPC request. Past this it counts as a failed read, and the next poll sends a new one. */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Without transaction history, a node's "unknown signature" is believed only
 * this close past the expiry slot: its status cache (about 300 rooted slots)
 * still holds every slot the transaction could have landed in.
 */
const STATUS_CACHE_TRUST_SLOTS = 64;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `request`, or a rejection once it has taken `REQUEST_TIMEOUT_MS` or run past `deadline`. */
function bounded<T>(request: Promise<T>, deadline: number): Promise<T> {
  const ms = Math.max(0, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC request timed out after ${ms} ms`)), ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/** How a send ended, as far as the chain says. */
type Outcome =
  | { kind: 'landed'; slot: number }
  | { kind: 'failed'; slot: number; err: TransactionError }
  /** Not on chain, per a node at or past `expiredAt` (a slot past its last valid block height). */
  | { kind: 'expired'; expiredAt: number }
  /**
   * Not known. `expiredAt`: a slot past which it can no longer land, when one
   * was seen. `noHistory`: the RPC keeps no transaction history to tell.
   */
  | { kind: 'unknown'; expiredAt?: number; noHistory?: boolean };

function isSettled(status: SignatureStatus): boolean {
  return (
    status.confirmationStatus === 'confirmed' ||
    status.confirmationStatus === 'finalized' ||
    status.confirmations === null
  );
}

function settledOutcome(status: SignatureStatus): Outcome {
  return status.err ? { kind: 'failed', slot: status.slot, err: status.err } : { kind: 'landed', slot: status.slot };
}

function historyUnavailable(error: unknown): boolean {
  return (
    (error as { code?: unknown })?.code === -32011 ||
    /history is not available|transaction history/i.test(String((error as Error)?.message ?? error))
  );
}

/**
 * Follow `sent` until its outcome is known or `deadline` passes. Without a
 * signature (the paymaster's answer was lost) only its expiry can be seen.
 *
 * The first status read is immediate, so a transaction the paymaster already
 * confirmed (Kora's default) costs one call. Polls rather than subscribing,
 * so it works on any RPC URL, with or without websockets.
 */
async function watch(connection: Connection, sent: SendAttempt & { signature?: string }, deadline: number): Promise<Outcome> {
  let expiredAt: number | undefined;
  let lastExpiryCheck = -Infinity;
  let noHistory = false;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      if (Date.now() >= deadline) return { kind: 'unknown', expiredAt };
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
    }

    // 1. Its status, from the node's cache of recent signatures.
    let recent: { status: SignatureStatus | null; slot: number } | undefined;
    if (sent.signature) {
      try {
        const read = await bounded(connection.getSignatureStatuses([sent.signature]), deadline);
        recent = { status: read.value[0], slot: read.context.slot };
      } catch {
        recent = undefined; // a failed read says nothing; try again
      }
      if (recent?.status && isSettled(recent.status)) return settledOutcome(recent.status);
    }

    // 2. Has its blockhash expired? One bank gives both its block height
    // and its slot, so the slot is one past which it cannot land.
    if (expiredAt === undefined && Date.now() - lastExpiryCheck >= EXPIRY_CHECK_EVERY_MS) {
      lastExpiryCheck = Date.now();
      try {
        const info = await bounded(connection.getEpochInfo('confirmed'), deadline);
        if (info.blockHeight !== undefined && info.blockHeight > sent.lastValidBlockHeight) {
          expiredAt = info.absoluteSlot;
        }
      } catch {
        // Try again on a later round.
      }
    }
    if (expiredAt === undefined) continue;
    if (!sent.signature) return { kind: 'unknown', expiredAt };

    // 3. It can no longer land. Whether it did is read from a node at or
    // past `expiredAt`, in its transaction history: a status cache drops a
    // signature a few minutes after it landed.
    if (!noHistory) {
      try {
        const read = await bounded(
          connection.getSignatureStatuses([sent.signature], { searchTransactionHistory: true }),
          deadline,
        );
        const status = read.value[0];
        if (status && isSettled(status)) return settledOutcome(status);
        if (!status && read.context.slot >= expiredAt) return { kind: 'expired', expiredAt };
        // Only processed so far, or a node behind `expiredAt`: read again.
      } catch (error) {
        if (historyUnavailable(error)) noHistory = true;
      }
    }
    if (noHistory && recent && !recent.status && recent.slot >= expiredAt) {
      // No history on this RPC: the status cache alone decides, while it
      // still covers every slot the transaction could have landed in.
      if (recent.slot - expiredAt <= STATUS_CACHE_TRUST_SLOTS) return { kind: 'expired', expiredAt };
      return { kind: 'unknown', expiredAt, noHistory: true };
    }
  }
}

/** A failed transaction, as the error to report: `SignatureReusedError` when it is LazorKit's 3006. */
async function failure(
  connection: Connection,
  signature: string,
  outcome: { slot: number; err: TransactionError },
  mapReused: boolean,
): Promise<Error> {
  const failed = new TransactionFailedError(signature, outcome.err, outcome.slot);
  if (!mapReused) return failed;
  let verdict = signatureReusedVerdict(outcome.err);
  let logs: string[] | undefined;
  if (verdict === 'unknown') {
    // An on-chain TransactionError has no logs, and an inner program's
    // 3006 looks the same as LazorKit's: the logs say which failed first.
    try {
      const tx = await bounded(
        connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }),
        Date.now() + REQUEST_TIMEOUT_MS,
      );
      logs = tx?.meta?.logMessages ?? undefined;
    } catch {
      logs = undefined;
    }
    if (logs) verdict = signatureReusedVerdict({ err: outcome.err, logs });
  }
  if (verdict === 'other') return logs ? new TransactionFailedError(signature, outcome.err, outcome.slot, logs) : failed;
  return new SignatureReusedError(logs ? new TransactionFailedError(signature, outcome.err, outcome.slot, logs) : failed);
}

/** The outcome as a result: the landed slot, or the error for it. */
async function outcomeResult(
  connection: Connection,
  sent: SentTransaction,
  outcome: Outcome,
  waitedMs: number,
  mapReused: boolean,
): Promise<number> {
  switch (outcome.kind) {
    case 'landed':
      return outcome.slot;
    case 'failed':
      throw await failure(connection, sent.signature, outcome, mapReused);
    case 'expired':
      throw new TransactionExpiredError(sent.signature);
    case 'unknown':
      if (outcome.expiredAt === undefined) throw new ConfirmationTimeoutError(sent.signature, waitedMs);
      throw new TransactionOutcomeUnknownError(
        `Transaction ${sent.signature} can no longer land (its blockhash has expired), but whether it did ` +
          (outcome.noHistory
            ? 'could not be read: this RPC keeps no transaction history. '
            : `could not be read within ${Math.round(waitedMs / 1000)} s. `) +
          'Check its status before sending it again.',
        sent.signature,
      );
  }
}

/**
 * Wait until `sent` is confirmed and return the slot it landed in.
 *
 * Throws `TransactionFailedError` when it landed and failed,
 * `TransactionExpiredError` when it is known not to have landed, and
 * `TransactionOutcomeUnknownError` (`ConfirmationTimeoutError` while it may
 * still land) when neither is known after two minutes.
 */
export async function confirmSent(connection: Connection, sent: SentTransaction): Promise<number> {
  const started = Date.now();
  const outcome = await watch(connection, sent, started + MAX_WAIT_MS);
  return outcomeResult(connection, sent, outcome, Date.now() - started, false);
}

/**
 * `confirmSent` for a transaction that consumes no passkey counter, with the
 * same error mapping as a passkey send: a landed failure that is LazorKit's
 * 3006 is reported as `SignatureReusedError`. Resolves with the landed slot.
 */
export async function confirmOrThrow(connection: Connection, sent: SentTransaction): Promise<number> {
  const started = Date.now();
  const outcome = await watch(connection, sent, started + MAX_WAIT_MS);
  return outcomeResult(connection, sent, outcome, Date.now() - started, true);
}

/** A send for this authority whose outcome is not known yet. */
interface PendingSend extends SendAttempt {
  /** Undefined when the paymaster's answer was lost. */
  signature?: string;
  /** When it was handed to the paymaster (ms). */
  since: number;
}

interface Lane {
  key: string;
  /** Resolves when the flow holding this lane now, and every one queued before, is done. */
  tail: Promise<void>;
  /** Sent for this authority, outcome not known yet. */
  unsettled?: PendingSend;
  /** A slot at or past this authority's last settled transaction. */
  floorSlot?: number;
}

/** By authority PDA (base58). */
const lanes = new Map<string, Lane>();

function laneOf(authority: PublicKey): Lane {
  const key = authority.toBase58();
  let lane = lanes.get(key);
  if (!lane) {
    lane = { key, tail: Promise.resolve() };
    lanes.set(key, lane);
  }
  return lane;
}

// ─── Kept across reloads and tabs ───────────────────────────────────────────

const STORAGE_PREFIX = 'lazorkit:passkey-lane:';
/** A stored floor older than this is ignored: every node is well past it, or it is from another chain. */
const STORED_FLOOR_TTL_MS = 10 * 60_000;

interface StoredLane {
  floorSlot?: number;
  floorAt?: number;
  unsettled?: PendingSend;
}

interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let asyncStorage: KeyValueStore | null | undefined;

function storage(): KeyValueStore | undefined {
  if (asyncStorage === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require('@react-native-async-storage/async-storage').default;
      asyncStorage = loaded && typeof loaded.getItem === 'function' ? loaded : null;
    } catch {
      asyncStorage = null;
    }
  }
  return asyncStorage ?? undefined;
}

async function readStored(key: string): Promise<StoredLane | undefined> {
  try {
    const raw = await storage()?.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as StoredLane) : undefined;
  } catch {
    return undefined;
  }
}

/** Writes in call order, so a later state is never overwritten by an earlier one. */
let writes: Promise<void> = Promise.resolve();

function writeStored(key: string, value: StoredLane): void {
  const store = storage();
  if (!store) return;
  writes = writes
    .then(() =>
      value.floorSlot === undefined && !value.unsettled
        ? store.removeItem(STORAGE_PREFIX + key)
        : store.setItem(STORAGE_PREFIX + key, JSON.stringify(value)),
    )
    .catch(() => {
      // Best effort: without storage the lane still holds while the app runs.
    });
}

function isPendingSend(value: unknown): value is PendingSend {
  const p = value as PendingSend | undefined;
  return (
    !!p &&
    typeof p.blockhash === 'string' &&
    typeof p.lastValidBlockHeight === 'number' &&
    typeof p.since === 'number' &&
    (p.signature === undefined || typeof p.signature === 'string')
  );
}

/** Take in what a reload or another tab stored for this authority. */
async function restore(lane: Lane): Promise<void> {
  const stored = await readStored(lane.key);
  if (!stored) return;
  if (
    typeof stored.floorSlot === 'number' &&
    typeof stored.floorAt === 'number' &&
    Date.now() - stored.floorAt < STORED_FLOOR_TTL_MS
  ) {
    lane.floorSlot = Math.max(lane.floorSlot ?? 0, stored.floorSlot);
  }
  if (!lane.unsettled && isPendingSend(stored.unsettled)) lane.unsettled = stored.unsettled;
}

function persist(lane: Lane): void {
  writeStored(lane.key, {
    ...(lane.floorSlot !== undefined ? { floorSlot: lane.floorSlot, floorAt: Date.now() } : {}),
    ...(lane.unsettled ? { unsettled: lane.unsettled } : {}),
  });
}

// ─── The lane ───────────────────────────────────────────────────────────────

function noteLanded(lane: Lane, slot: number): void {
  lane.floorSlot = Math.max(lane.floorSlot ?? 0, slot);
  persist(lane);
}

/**
 * Record that a transaction touching `authority` landed in `slot`, for one that
 * did not consume its counter: a wallet's creation. The first challenge read
 * after it is made at or past that slot, where the authority exists.
 */
export function noteAuthorityLanded(authority: PublicKey, slot: number): void {
  noteLanded(laneOf(authority), slot);
}

/**
 * Move the lane past `pending` when the outcome settles its counter: landed
 * or failed (at that slot), or past its expiry (a node at or past that slot
 * shows whatever it did). False when it may still land.
 */
function settleWith(lane: Lane, pending: PendingSend, outcome: Outcome): boolean {
  if (outcome.kind === 'landed' || outcome.kind === 'failed') {
    lane.floorSlot = Math.max(lane.floorSlot ?? 0, outcome.slot);
  } else if (outcome.expiredAt !== undefined) {
    lane.floorSlot = Math.max(lane.floorSlot ?? 0, outcome.expiredAt);
  } else {
    return false;
  }
  if (lane.unsettled === pending) lane.unsettled = undefined;
  persist(lane);
  return true;
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
     * settled, this throws `PreviousTransactionPendingError` rather than sign
     * a counter that send may still use.
     */
  challengeReads(connection: Connection): Promise<ChallengeReads>;
  /**
     * Wait until `sent`, a transaction that consumes this authority's counter,
     * is confirmed; resolve with its signature. On any outcome that settles
     * the counter (landed, failed, past its expiry) the lane moves past it. A
     * failure that is LazorKit's 3006 is reported as `SignatureReusedError`.
     */
  confirm(connection: Connection, sent: SentTransaction): Promise<string>;
  /**
     * The paymaster may have sent a transaction consuming this authority's
     * counter, but its signature did not come back. The next challenge waits
     * until that transaction can no longer land.
     */
  sentUnknown(attempt: SendAttempt): void;
}

async function settle(lane: Lane, connection: Connection): Promise<void> {
  await restore(lane);
  const pending = lane.unsettled;
  if (!pending) return;
  // Up to two minutes from its send, and at least a short while more for a
  // send whose own wait already ran out.
  const deadline = Math.max(pending.since + MAX_WAIT_MS, Date.now() + SETTLE_RETRY_MS);
  const outcome = await watch(connection, pending, deadline);
  if (!settleWith(lane, pending, outcome)) throw new PreviousTransactionPendingError(pending.signature);
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
      const started = Date.now();
      const pending: PendingSend = { ...sent, since: started };
      lane.unsettled = pending;
      persist(lane);
      const outcome = await watch(connection, pending, started + MAX_WAIT_MS);
      // Not settled: it stays unsettled, and the next turn settles it first.
      settleWith(lane, pending, outcome);
      await outcomeResult(connection, sent, outcome, Date.now() - started, true);
      return sent.signature;
    },
    sentUnknown(attempt) {
      lane.unsettled = { blockhash: attempt.blockhash, lastValidBlockHeight: attempt.lastValidBlockHeight, since: Date.now() };
      persist(lane);
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

/**
 * Hand a transaction to the paymaster (`send`) and resolve with its signature
 * once it is confirmed.
 *
 * - `turn`: the lane of the passkey authority whose counter it consumes; the
 *   next challenge for that passkey is then read from state that includes it.
 * - `createsAuthority`: a passkey authority it creates; its first challenge
 *   is read at or past the creation.
 * - `simulateLogs`: this transaction's logs, simulated now. Used when the
 *   paymaster rejected it with a 3006 and no logs, to tell LazorKit's
 *   `SignatureReused` from an inner program's error with the same code.
 *
 * When the paymaster reports the signature of a transaction it sent along
 * with an error, that signature is followed like any other. When its answer
 * was lost, the call rejects with `TransactionOutcomeUnknownError` (no
 * signature), and the passkey's next challenge waits until that transaction
 * can no longer land.
 */
export async function sendAndConfirm(params: {
  connection: Connection;
  attempt: SendAttempt;
  send: () => Promise<string>;
  turn?: AuthorityTurn;
  createsAuthority?: PublicKey;
  simulateLogs?: () => Promise<readonly string[] | null | undefined>;
}): Promise<string> {
  let signature: string;
  try {
    signature = await params.send();
  } catch (error) {
    if (error instanceof PaymasterError && error.signature) {
      signature = error.signature;
    } else if (error instanceof PaymasterError && error.maybeSent) {
      params.turn?.sentUnknown(params.attempt);
      throw new TransactionOutcomeUnknownError(
        `The paymaster may have sent this transaction, but its answer did not come back (${error.message}), ` +
          'so its signature is not known. Check the state it would change before sending it again.',
        undefined,
        error,
      );
    } else if (error instanceof SignatureReusedError && params.simulateLogs) {
      throw await withLogs(error, params.simulateLogs);
    } else {
      throw error;
    }
  }
  const sent: SentTransaction = { signature, ...params.attempt };
  if (params.turn) return params.turn.confirm(params.connection, sent);
  const slot = await confirmOrThrow(params.connection, sent);
  if (params.createsAuthority) noteAuthorityLanded(params.createsAuthority, slot);
  return signature;
}

/**
 * A 3006 the paymaster reported without logs (Kora prints only the
 * TransactionError): simulate the transaction for them. When the first
 * program to fail is not LazorKit, report the paymaster's error, with the
 * logs, instead of `SignatureReusedError`.
 */
async function withLogs(
  error: SignatureReusedError,
  simulateLogs: () => Promise<readonly string[] | null | undefined>,
): Promise<Error> {
  const cause = (error as { cause?: unknown }).cause;
  if (signatureReusedVerdict(cause) !== 'unknown') return error;
  let logs: readonly string[] | null | undefined;
  try {
    logs = await bounded(simulateLogs(), Date.now() + REQUEST_TIMEOUT_MS);
  } catch {
    logs = undefined;
  }
  if (!logs || signatureReusedVerdict({ cause: String(cause), logs }) !== 'other') return error;
  const reported = cause instanceof Error ? cause : new Error(String(cause));
  (reported as { logs?: readonly string[] }).logs = logs;
  return reported;
}
