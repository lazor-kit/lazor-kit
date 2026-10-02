/**
 * What a session's (or a delegate key's) policy names, and the program's
 * refusals when a transaction moves an asset it does not name.
 *
 * Under LazorKit v2 a policy names what may leave the vault, and nothing it
 * does not name may (D13): with no `Sol*` action the vault's SOL may not fall
 * (`ActionUnlistedSolOutflow`, 3037), rent the vault pays for a new account
 * included; a mint with no `Token*` action may not leave the vault's token
 * accounts (`ActionUnlistedTokenOutflow`, 3038). Both are net over one
 * Execute, and what comes in always passes. wSOL is a mint of its own: a SOL
 * limit does not name it.
 */
import { PublicKey } from '@solana/web3.js';
import { Actions, type SessionAction } from '../program';
import { PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET } from '../program/utils';
import { chainHasError, errorChainText, isNamedError } from '../program/errorShape';
import type { SpendingLimits } from '../types';

/** The most actions the program accepts in one policy. */
export const MAX_POLICY_ACTIONS = 16;

const U64_MAX = (1n << 64n) - 1n;

function amount(what: string, value: unknown): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new RangeError(`spendingLimits.${what} must be a bigint from 0 to 2^64 - 1; got ${String(value)}`);
    }
    return value;
}

function windowSlots(what: string, value: unknown): bigint {
    const slots = amount(what, value);
    if (slots === 0n) throw new RangeError(`spendingLimits.${what} must be at least 1 slot`);
    return slots;
}

/**
 * The session actions a `SpendingLimits` preset stands for: the SOL limits,
 * then each token's, in the order given. Throws, before anything is read or
 * prompted, on a token with no limit or a mint that is not a public key, on a
 * mint named twice, on an amount outside a u64, on a window of 0 slots, and
 * on more than 16 actions in all (what the program accepts).
 *
 * An asset this preset does not name cannot leave the vault: give a SOL limit
 * whenever the session may spend SOL, rent for an account the vault pays for
 * included, and a `tokens` entry for each mint it may spend.
 *
 * The same actions bound a delegate key: `serializeActions(spendingLimitsToActions(limits))`
 * is a `policy` for `addAuthority`.
 */
export function spendingLimitsToActions(limits: SpendingLimits | undefined): SessionAction[] {
    if (!limits) return [];
    const actions: SessionAction[] = [];
    if (limits.solLifetimeCap !== undefined) {
        actions.push(Actions.solLimit(amount('solLifetimeCap', limits.solLifetimeCap)));
    }
    if (limits.solPerTxMax !== undefined) {
        actions.push(Actions.solMaxPerTx(amount('solPerTxMax', limits.solPerTxMax)));
    }
    if (limits.solRecurring) {
        actions.push(Actions.solRecurringLimit({
            limit: amount('solRecurring.limit', limits.solRecurring.limit),
            window: windowSlots('solRecurring.windowSlots', limits.solRecurring.windowSlots),
        }));
    }
    const named = new Set<string>();
    (limits.tokens ?? []).forEach((token, i) => {
        const at = `tokens[${i}]`;
        let mint: PublicKey;
        try {
            mint = new PublicKey(token?.mint ?? '');
        } catch {
            throw new TypeError(`spendingLimits.${at}.mint must be the token's mint address; got ${String(token?.mint)}`);
        }
        if (named.has(mint.toBase58())) {
            throw new Error(`spendingLimits.tokens names mint ${mint.toBase58()} twice: give each mint one entry`);
        }
        named.add(mint.toBase58());
        const before = actions.length;
        if (token.lifetimeCap !== undefined) {
            actions.push(Actions.tokenLimit({ mint, remaining: amount(`${at}.lifetimeCap`, token.lifetimeCap) }));
        }
        if (token.perTxMax !== undefined) {
            actions.push(Actions.tokenMaxPerTx({ mint, max: amount(`${at}.perTxMax`, token.perTxMax) }));
        }
        if (token.recurring) {
            actions.push(Actions.tokenRecurringLimit({
                mint,
                limit: amount(`${at}.recurring.limit`, token.recurring.limit),
                window: windowSlots(`${at}.recurring.windowSlots`, token.recurring.windowSlots),
            }));
        }
        if (actions.length === before) {
            throw new Error(
                `spendingLimits.${at} (mint ${mint.toBase58()}) has no limit: give it lifetimeCap, perTxMax or recurring`,
            );
        }
    });
    // NOTE: do NOT auto-append a ProgramWhitelist here. Adding any
    // whitelist entry switches the session from "allow all programs" to
    // "only allow listed programs" — callers that just want spending caps
    // would lose the ability to call SPL Token, ATA, Raydium, etc.
    if (actions.length > MAX_POLICY_ACTIONS) {
        throw new RangeError(
            `spendingLimits makes ${actions.length} actions; a policy holds at most ${MAX_POLICY_ACTIONS}`,
        );
    }
    return actions;
}

/** `SpendingLimits` as the kept session key's record holds it: amounts as decimal text, mints as base58. */
export function spendingLimitsRecord(limits: SpendingLimits | undefined) {
    if (!limits) return undefined;
    const recurring = (r: { limit: bigint; windowSlots: bigint } | undefined) =>
        r ? { limit: r.limit.toString(), windowSlots: r.windowSlots.toString() } : undefined;
    return {
        solLifetimeCap: limits.solLifetimeCap?.toString(),
        solPerTxMax: limits.solPerTxMax?.toString(),
        solRecurring: recurring(limits.solRecurring),
        tokens: limits.tokens?.map((token) => ({
            mint: new PublicKey(token.mint).toBase58(),
            lifetimeCap: token.lifetimeCap?.toString(),
            perTxMax: token.perTxMax?.toString(),
            recurring: recurring(token.recurring),
        })),
    };
}

// ─── The refusals ────────────────────────────────────────────────────

/** The program's ActionUnlistedSolOutflow, seen as `custom program error: 0xbdd`. */
export const UNLISTED_SOL_OUTFLOW_CODE = 3037;
/** The program's ActionUnlistedTokenOutflow, seen as `custom program error: 0xbde`. */
export const UNLISTED_TOKEN_OUTFLOW_CODE = 3038;

/** Which kept key signed: the session key, or a delegate (ROLE_SPENDER) authority key. */
export type PolicySigner = 'session' | 'authority';

const subject = (signer: PolicySigner) => (signer === 'authority' ? 'This key' : 'This session');

/**
 * The transaction would have lowered the wallet's SOL balance, and the
 * signer's policy names no SOL (`ActionUnlistedSolOutflow`, 3037). Rent the
 * vault pays for a new account counts. Nothing in it ran. A session needs a
 * SOL limit (`solPerTxMax`, `solLifetimeCap` or `solRecurring`) to spend SOL.
 */
export class UnlistedSolOutflowError extends Error {
    readonly code = UNLISTED_SOL_OUTFLOW_CODE;
    constructor(
        /** The key that signed: the session's, or a delegate authority's. */
        readonly signer: PolicySigner = 'session',
        cause?: unknown,
    ) {
        super(`${subject(signer)} is not allowed to spend SOL`);
        this.name = 'UnlistedSolOutflowError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/**
 * The transaction would have lowered the wallet's balance of a token whose
 * mint the signer's policy does not name (`ActionUnlistedTokenOutflow`,
 * 3038). Nothing in it ran. A session spends a token only with a
 * `spendingLimits.tokens` entry for its mint; wSOL is a mint of its own.
 */
export class UnlistedTokenOutflowError extends Error {
    readonly code = UNLISTED_TOKEN_OUTFLOW_CODE;
    constructor(
        /** The key that signed: the session's, or a delegate authority's. */
        readonly signer: PolicySigner = 'session',
        cause?: unknown,
    ) {
        super(`${subject(signer)} is not allowed to spend this token`);
        this.name = 'UnlistedTokenOutflowError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

function isLazorKitV2ProgramId(id: string): boolean {
    return id === PROGRAM_ID_MAINNET.toBase58() || id === PROGRAM_ID_DEVNET.toBase58();
}

/**
 * Whose `code` (3037 or 3038) this error is, as far as the error itself says:
 * `'lazorkit'` when the logs name the LazorKit v2 program as the first to
 * fail with it, `'other'` when it is not that code or the logs name another
 * program, `'unknown'` when no log names who failed with it (Kora's text, a
 * TransactionError read from chain).
 */
function outflowVerdict(error: unknown, code: number): 'lazorkit' | 'other' | 'unknown' {
    const text = errorChainText(error);
    const hex = `0x${code.toString(16)}`;
    const shape = new RegExp(`custom program error: ${hex}\\b|"Custom":\\s*${code}\\b|Custom\\(\\s*${code}\\s*\\)`, 'i');
    if (!shape.test(text)) return 'other';
    const firstFailure = new RegExp(`Program (\\w{32,44}) failed: custom program error: ${hex}\\b`, 'i').exec(text);
    if (!firstFailure) return 'unknown';
    return isLazorKitV2ProgramId(firstFailure[1]) ? 'lazorkit' : 'other';
}

/**
 * True for an `UnlistedSolOutflowError` (also one from another copy of this
 * package, by `name` and `code`, and one wrapped in `cause` or in a
 * wallet-adapter `WalletError`'s `error`), and for LazorKit's raw
 * `ActionUnlistedSolOutflow` (3037): web3.js text (`0xbdd`), a
 * TransactionError (`"Custom":3037`) or Kora's text (`Custom(3037)`). A raw
 * 3037 whose logs name another program as the first to fail is not
 * LazorKit's; one with no logs counts as LazorKit's (no Anchor error uses
 * the code).
 */
export function isUnlistedSolOutflowError(error: unknown): boolean {
    if (chainHasError(error, UnlistedSolOutflowError, 'UnlistedSolOutflowError', UNLISTED_SOL_OUTFLOW_CODE)) return true;
    return outflowVerdict(error, UNLISTED_SOL_OUTFLOW_CODE) !== 'other';
}

/** As `isUnlistedSolOutflowError`, for `UnlistedTokenOutflowError` and the raw 3038 (`0xbde`). */
export function isUnlistedTokenOutflowError(error: unknown): boolean {
    if (chainHasError(error, UnlistedTokenOutflowError, 'UnlistedTokenOutflowError', UNLISTED_TOKEN_OUTFLOW_CODE)) {
        return true;
    }
    return outflowVerdict(error, UNLISTED_TOKEN_OUTFLOW_CODE) !== 'other';
}

/**
 * The error a session or delegate send reports: a policy refusal for an
 * asset it does not name as `UnlistedSolOutflowError` /
 * `UnlistedTokenOutflowError`, with the original as `cause`; anything else as
 * it came.
 */
export function toPolicyError(error: unknown, signer: PolicySigner): unknown {
    if (
        error instanceof UnlistedSolOutflowError ||
        error instanceof UnlistedTokenOutflowError ||
        isNamedError(error, 'UnlistedSolOutflowError', UNLISTED_SOL_OUTFLOW_CODE) ||
        isNamedError(error, 'UnlistedTokenOutflowError', UNLISTED_TOKEN_OUTFLOW_CODE)
    ) {
        return error;
    }
    if (isUnlistedSolOutflowError(error)) return new UnlistedSolOutflowError(signer, error);
    if (isUnlistedTokenOutflowError(error)) return new UnlistedTokenOutflowError(signer, error);
    return error;
}
