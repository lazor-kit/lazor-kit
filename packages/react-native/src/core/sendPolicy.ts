/**
 * When a paymaster send is tried again, how long it waits, and how long the
 * whole send may take.
 *
 * - A deterministic refusal is never sent again: the same bytes get the same
 *   answer. That is any program error (LazorKit's 3007, 3008, 3009, 3024,
 *   3025, … or an inner program's), a relayer's allowlist refusal ("Program
 *   … is not in the allowed list"), insufficient funds, a failed simulation,
 *   and any other 4xx.
 * - A rate limit (HTTP 429) is waited out, honouring `Retry-After` (capped),
 *   and tried again while the send's time budget lasts. It does not count as
 *   one of the send's attempts.
 * - A transient failure (a network error, a timeout, a 5xx, a blockhash the
 *   relayer's RPC has not seen yet) is tried again with the same bytes, so the
 *   transaction can land at most once, and only while its blockhash is valid.
 * - The whole send, retries and waits included, is bounded: one attempt by
 *   `SEND_ATTEMPT_TIMEOUT_MS`, all of them by `SEND_BUDGET_MS`.
 *
 * This file is the same in @lazorkit/wallet (core/paymaster/sendPolicy.ts) and
 * @lazorkit/wallet-mobile-adapter (src/core/sendPolicy.ts), indentation aside:
 * the mobile adapter's tests check that.
 */

/**
 * How long one `signAndSendTransaction` request may take. A relayer that holds
 * the request until the transaction is confirmed answers in 1–4 s; past this
 * the request counts as lost, and the transaction as maybe sent.
 */
export const SEND_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * How long a whole send may take, every attempt and wait included. A
 * transaction's blockhash lives about 150 blocks (35–60 s), so nothing sent
 * later than this could land anyway.
 */
export const SEND_BUDGET_MS = 60_000;

/** An attempt is not started with less than this left of the budget. */
export const MIN_ATTEMPT_MS = 5_000;

/** The longest wait a 429's `Retry-After` is honoured for. */
export const MAX_RETRY_AFTER_MS = 10_000;

/**
 * What to do after a failed send attempt.
 * - `'final'`: stop. The same bytes would get the same answer.
 * - `'rate-limited'`: wait (`Retry-After`, or a growing backoff), then try again.
 * - `'transient'`: try the same bytes again after a short backoff, while the
 *   blockhash is valid.
 */
export type SendFailureKind = 'final' | 'rate-limited' | 'transient';

/** What a paymaster error carries, as both packages' `PaymasterError` has it. */
export interface SendFailure {
  readonly message: string;
  readonly code?: number;
  readonly httpStatus?: number;
  readonly data?: unknown;
  readonly maybeSent?: boolean;
  /** Nothing was sent: the device was offline before the request. */
  readonly offline?: boolean;
}

/** A program error, in any shape a relayer or web3.js prints it. */
const PROGRAM_ERROR = /custom program error|InstructionError|Custom\(\s*\d+\s*\)|"Custom":\s*\d+/i;

/**
 * Refusals that do not change from one attempt to the next: a relayer's
 * allowlist or limits, missing funds, a failed simulation, a request the
 * relayer cannot read, or one it is not allowed to serve.
 */
const DETERMINISTIC =
  /not in the allowed list|is not allowed|disallowed|insufficient (funds|lamports)|InsufficientFunds|simulation failed|invalid transaction|invalid (params|parameters|request)|exceeds|unauthori[sz]ed|forbidden/i;

/** A blockhash the relayer's RPC has not seen yet: a load-balanced node behind the one the app read from. */
const BLOCKHASH_NOT_FOUND = /blockhash not found|BlockhashNotFound/i;

function textOf(error: SendFailure): string {
  let data = '';
  try {
    data = error.data === undefined ? '' : JSON.stringify(error.data) ?? '';
  } catch {
    data = '';
  }
  return `${error.message} ${data}`;
}

/** Whether a failed send attempt is worth trying again, and how. */
export function sendFailureKind(error: SendFailure): SendFailureKind {
  if (error.offline) return 'final';
  const text = textOf(error);
  if (error.httpStatus === 429 || /\b429\b|too many requests|rate.?limit/i.test(error.message)) return 'rate-limited';
  // Before the program-error and simulation checks: a stale RPC node prints
  // it as a failed simulation, and the next attempt may reach a newer one.
  if (BLOCKHASH_NOT_FOUND.test(text) && !PROGRAM_ERROR.test(text)) return 'transient';
  if (PROGRAM_ERROR.test(text) || DETERMINISTIC.test(text)) return 'final';
  const status = error.httpStatus;
  if (status !== undefined) {
    if (status >= 500 || status === 408) return 'transient';
    if (status >= 400) return 'final';
  }
  // The answer was lost (a network error, a timeout), or the relayer said
  // something not known to be final (its upstream RPC failed, say): the same
  // bytes again, within the attempts and the budget.
  return 'transient';
}

/**
 * How long to wait before the next attempt (1-based `attempt`: the one that
 * just failed). A 429's `Retry-After` when it gave one, but never less than
 * `baseDelayMs` (a `Retry-After: 0` does not turn into a burst); else
 * `baseDelayMs` doubled each attempt. Capped at `MAX_RETRY_AFTER_MS` either way.
 */
export function retryDelayMs(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(Math.max(retryAfterMs, baseDelayMs), MAX_RETRY_AFTER_MS);
  }
  return Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_AFTER_MS);
}

/**
 * A `Retry-After` header as milliseconds: delta-seconds or an HTTP date.
 * Undefined when absent or unreadable.
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * The device says it is offline (`navigator.onLine === false`): a request
 * made now would not leave it. React Native has no such flag, and is never
 * reported offline here.
 */
export function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && (navigator as { onLine?: unknown }).onLine === false;
  } catch {
    return false;
  }
}
