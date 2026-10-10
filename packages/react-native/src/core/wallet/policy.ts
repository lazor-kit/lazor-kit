/**
 * The program's refusals when a session's transaction moves an asset its
 * actions do not name.
 *
 * Under LazorKit v2 a policy (a session's actions, or a delegate's policy)
 * names what may leave the vault, and nothing it does not name may (D13):
 * with no `Sol*` action the vault's SOL may not fall
 * (`ActionUnlistedSolOutflow`, 3037), rent the vault pays for a new account
 * included; a mint with no `Token*` action may not leave the vault's token
 * accounts (`ActionUnlistedTokenOutflow`, 3038). Both are net over one
 * Execute, and what comes in always passes. wSOL is a mint of its own: a SOL
 * action does not name it. The same as the web SDK's.
 */
import { PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET } from '../../program/utils';
import { chainHasError, errorChain, errorChainText, isNamedError } from '../../program/errorShape';
import { serializeActions, type SessionAction } from '../../program/utils';
import { MAX_PASSKEY_SESSION_ACTIONS_BYTES } from '@lazorkit/sdk-legacy/approval';

/** The most actions the program accepts in one policy. */
export const MAX_POLICY_ACTIONS = 16;

/**
 * The most bytes of actions a session may carry: 224. They travel in the
 * CreateSession transaction beside the passkey's WebAuthn response, and a
 * transaction holds 1232 bytes. `@lazorkit/sdk-legacy` sizes the
 * clientDataJSON at 320 bytes and refuses a typed request with more actions
 * than fit then (`MAX_PASSKEY_SESSION_ACTIONS_BYTES`). The same as the web
 * SDK's.
 */
export const MAX_POLICY_ACTION_BYTES = MAX_PASSKEY_SESSION_ACTIONS_BYTES;

/**
 * Throws a RangeError when `actions` could not land in a CreateSession
 * transaction: more than 16 actions, or more than 224 bytes of them. Checked
 * before the portal opens, so the user is never asked to approve a session
 * that cannot be sent.
 */
export function checkSessionActionsFit(actions: readonly SessionAction[]): void {
  if (actions.length > MAX_POLICY_ACTIONS) {
    throw new RangeError(`createSession got ${actions.length} actions; a session holds at most ${MAX_POLICY_ACTIONS}`);
  }
  const bytes = serializeActions([...actions]).length;
  if (bytes > MAX_POLICY_ACTION_BYTES) {
    throw new RangeError(
      `createSession got ${bytes} bytes of actions; at most ${MAX_POLICY_ACTION_BYTES} fit in the ` +
        "transaction beside the passkey's response. A sol* action takes 19 bytes (solRecurringLimit 43), " +
        'tokenMaxPerTx and tokenLimit 51, tokenRecurringLimit 75: drop an action, or a mint.',
    );
  }
}

/** The program's ActionUnlistedSolOutflow, seen as `custom program error: 0xbdd`. */
export const UNLISTED_SOL_OUTFLOW_CODE = 3037;
/** The program's ActionUnlistedTokenOutflow, seen as `custom program error: 0xbde`. */
export const UNLISTED_TOKEN_OUTFLOW_CODE = 3038;

/** Which key signed: a session key, or a delegate (ROLE_SPENDER) authority key. */
export type PolicySigner = 'session' | 'authority';

const subject = (signer: PolicySigner) => (signer === 'authority' ? 'This key' : 'This session');

/**
 * The transaction would have lowered the wallet's SOL balance, and the
 * signer's actions name no SOL (`ActionUnlistedSolOutflow`, 3037). Rent the
 * vault pays for a new account counts. Nothing in it ran. A session needs a
 * `Sol*` action (`Actions.solMaxPerTx`, `solLimit` or `solRecurringLimit`)
 * to spend SOL.
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
 * mint the signer's actions do not name (`ActionUnlistedTokenOutflow`,
 * 3038). Nothing in it ran. A session spends a token only with a `Token*`
 * action (`Actions.tokenMaxPerTx`, `tokenLimit` or `tokenRecurringLimit`)
 * for its mint; wSOL is a mint of its own.
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
 * Whether the send's outcome is not known: a `TransactionOutcomeUnknownError`
 * (or `ConfirmationTimeoutError`), or a paymaster error with `maybeSent`, in
 * the chain. A refusal it carries may have come after the transaction was
 * sent (a 5xx answer), so it may have landed.
 */
function outcomeUnknown(error: unknown): boolean {
  return errorChain(error).some((link) => {
    if (isNamedError(link, 'TransactionOutcomeUnknownError') || isNamedError(link, 'ConfirmationTimeoutError')) {
      return true;
    }
    try {
      return typeof link === 'object' && link !== null && (link as { maybeSent?: unknown }).maybeSent === true;
    } catch {
      return false;
    }
  });
}

/**
 * The error a session send reports: a policy refusal for an asset its
 * actions do not name as `UnlistedSolOutflowError` /
 * `UnlistedTokenOutflowError`, with the original as `cause`; anything else as
 * it came. Nothing ran in such a refusal, so an error whose outcome is not
 * known (`TransactionOutcomeUnknownError`, `maybeSent`) is left as it came.
 */
export function toPolicyError(error: unknown, signer: PolicySigner): unknown {
  if (
    error instanceof UnlistedSolOutflowError ||
    error instanceof UnlistedTokenOutflowError ||
    isNamedError(error, 'UnlistedSolOutflowError', UNLISTED_SOL_OUTFLOW_CODE) ||
    isNamedError(error, 'UnlistedTokenOutflowError', UNLISTED_TOKEN_OUTFLOW_CODE) ||
    outcomeUnknown(error)
  ) {
    return error;
  }
  if (isUnlistedSolOutflowError(error)) return new UnlistedSolOutflowError(signer, error);
  if (isUnlistedTokenOutflowError(error)) return new UnlistedTokenOutflowError(signer, error);
  return error;
}
