/**
 * What can go wrong, as an app sees it: one class per kind of failure, the
 * kind (`errorKind`) to branch on, and the words to show a user
 * (`userMessage`).
 *
 * A user who says no is not an error the app should report: closing the
 * passkey sheet, cancelling the review, closing the portal, "Not now", "None of
 * these". All of them are `UserRejectedError`, with a `reason`. The 3.x names
 * (`PortalCancelledError`, `WalletConfirmationDeclinedError`) are subclasses,
 * so `instanceof` on either keeps working. No rejection sets the store's
 * `error`.
 *
 * Classes are matched by `name` as well as by `instanceof` (see
 * ../program/errorShape), so the ESM and CJS copies of this package agree.
 */
import { errorChain, isNamedError } from './program/errorShape';

export type UserRejectionReason =
    | 'passkey-closed'
    | 'review-cancelled'
    | 'portal-closed'
    | 'not-now'
    | 'wallet-declined'
    | 'abandoned';

/**
 * The user said no, or the app abandoned the call (`disconnect` during
 * `connect`). Nothing was signed, sent, created or saved.
 */
export class UserRejectedError extends Error {
    readonly code = 'USER_REJECTED';
    constructor(
        readonly reason: UserRejectionReason,
        message: string = REJECTION_TEXT[reason],
    ) {
        super(message);
        this.name = 'UserRejectedError';
    }
}

const REJECTION_TEXT: Record<UserRejectionReason, string> = {
    'passkey-closed': 'The passkey sheet was closed, so nothing was signed or sent.',
    'review-cancelled': 'The transaction was not approved, so nothing was signed or sent.',
    'portal-closed': 'The LazorKit portal was closed before it finished, so nothing was signed.',
    'not-now': 'No passkey was used or created, so no wallet was connected.',
    'wallet-declined': 'None of the wallets this passkey is on was chosen, so no wallet was connected.',
    abandoned: 'disconnect was called while connecting, so no wallet was connected.',
};

/** The rejection names, for errors from another copy of the package. */
const REJECTION_NAMES = ['UserRejectedError', 'PortalCancelledError', 'WalletConfirmationDeclinedError'];

/** True for any `UserRejectedError` (its subclasses included), from any copy of the package. */
export function isUserRejection(error: unknown): boolean {
    return (
        error instanceof UserRejectedError ||
        REJECTION_NAMES.some((name) => isNamedError(error, name)) ||
        (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'USER_REJECTED')
    );
}

/** A pinned passkey prompt was answered by another passkey. Nothing was created, signed or sent. */
export class PasskeyMismatchError extends Error {
    readonly code = 'PASSKEY_MISMATCH';
    constructor(message = 'Another passkey answered than the one asked for, so nothing was created, signed or sent.') {
        super(message);
        this.name = 'PasskeyMismatchError';
    }
}

/**
 * A passkey with no wallet yet, whose public key two of its assertions did not
 * pin. Nothing was created.
 */
export class KeyRecoveryError extends Error {
    readonly code = 'KEY_RECOVERY';
    constructor(message: string) {
        super(message);
        this.name = 'KeyRecoveryError';
    }
}

/**
 * Passkeys cannot be used here: no WebAuthn (an in-app browser view, an old
 * browser), or the browser refused the ceremony as unsupported.
 */
export class PasskeyUnavailableError extends Error {
    readonly code = 'PASSKEY_UNAVAILABLE';
    constructor(message = "Passkeys don't work in this browser view. Open this page in Safari or Chrome.", cause?: unknown) {
        super(message);
        this.name = 'PasskeyUnavailableError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

export type LazorkitConfigProblem =
    | 'no-mode'
    | 'no-rp-id'
    | 'no-app-name'
    | 'bad-rp-id'
    | 'ip-rp-id'
    | 'mainnet-paymaster'
    | 'localhost-mainnet'
    | 'ip-host'
    | 'insecure-context'
    | 'rp-id-refused'
    | 'reconfigured';

/**
 * The app's configuration (or the page it runs on) cannot work. A developer
 * error, not a user's: `problem` says which, the message says how to fix it.
 */
export class LazorkitConfigError extends Error {
    readonly code = 'LAZORKIT_CONFIG';
    constructor(
        readonly problem: LazorkitConfigProblem,
        message: string,
        cause?: unknown,
    ) {
        super(message);
        this.name = 'LazorkitConfigError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/**
 * The chain could not be read (an RPC failure, a rate limit that outlasted
 * the back-off). Nothing was created: a failed read is never taken as "no
 * wallet".
 */
export class NetworkError extends Error {
    readonly code = 'NETWORK';
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'NetworkError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/**
 * The wallet the relayer landed is not the one this passkey asked for: no
 * Owner authority with this passkey's key, credential and relying party, or
 * another Owner beside it. Nothing was saved.
 */
export class WalletVerificationError extends Error {
    readonly code = 'WALLET_VERIFICATION';
    constructor(
        message: string,
        /** The wallet PDA that was checked. */
        readonly wallet: string,
    ) {
        super(message);
        this.name = 'WalletVerificationError';
    }
}

export type ErrorKind =
    | 'rejected'
    | 'other-passkey'
    | 'key-recovery'
    | 'unavailable'
    | 'config'
    | 'network'
    | 'tx-failed'
    | 'tx-expired'
    | 'tx-unknown'
    | 'previous-pending'
    | 'signature-reused'
    | 'v1-retired'
    | 'v1-migrated'
    | 'key-mismatch'
    | 'policy'
    | 'wallet-mismatch'
    | 'unknown';

/**
 * Which kind of failure this is, for an app to branch on. Reads the error
 * and what it wraps (`cause`, `error`), by class and by name.
 */
export function errorKind(error: unknown): ErrorKind {
    const chain = errorChain(error);
    if (chain.some(isUserRejection)) return 'rejected';
    const has = (name: string, code?: number | string) => chain.some((link) => isNamedError(link, name, code));
    if (has('PasskeyMismatchError')) return 'other-passkey';
    if (has('KeyRecoveryError')) return 'key-recovery';
    if (has('PasskeyUnavailableError')) return 'unavailable';
    if (has('LazorkitConfigError')) return 'config';
    if (has('WalletVerificationError')) return 'wallet-mismatch';
    if (has('V1WalletRetiredError', 4018)) return 'v1-retired';
    if (has('V1WalletMigratedError')) return 'v1-migrated';
    if (has('SignatureReusedError', 3006)) return 'signature-reused';
    if (has('KeyWalletMismatchError', 'KEY_WALLET_MISMATCH')) return 'key-mismatch';
    // A session or delegate key's policy does not name what it would spend
    // (3037 / 3038). Before the kinds of what it wraps: a paymaster's refusal
    // or the failed transaction.
    if (has('UnlistedSolOutflowError', 3037) || has('UnlistedTokenOutflowError', 3038)) return 'policy';
    if (has('PreviousTransactionPendingError')) return 'previous-pending';
    if (has('TransactionOutcomeUnknownError') || has('ConfirmationTimeoutError')) return 'tx-unknown';
    if (has('TransactionExpiredError')) return 'tx-expired';
    if (has('TransactionFailedError')) return 'tx-failed';
    if (has('NetworkError')) return 'network';
    if (has('PaymasterError') && !hasProgramCode(error)) return 'network';
    return 'unknown';
}

function hasProgramCode(error: unknown): boolean {
    let text = '';
    try {
        text = JSON.stringify((error as { data?: unknown })?.data ?? '') + String((error as Error)?.message ?? '');
    } catch {
        text = String((error as Error)?.message ?? '');
    }
    return /custom program error|"Custom"|Custom\(/i.test(text);
}

/**
 * What to tell the user, in short English, or `null` for nothing (a
 * rejection while connecting: the user knows they said no). `context` says
 * what was being done: `'connect'` (default) or `'send'`.
 */
export function userMessage(error: unknown, context: 'connect' | 'send' = 'connect'): string | null {
    switch (errorKind(error)) {
        case 'rejected':
            return context === 'send' ? 'Nothing signed, nothing sent.' : null;
        case 'other-passkey':
            return 'Another passkey answered. Nothing was created or sent.';
        case 'key-recovery':
            return 'Nothing was created; try again.';
        case 'unavailable':
            return "Passkeys don't work in this browser view. Open this page in Safari or Chrome.";
        case 'config':
            return (error as Error)?.message ?? 'This app is not set up for passkeys.';
        case 'network':
            return context === 'send'
                ? "Couldn't reach the network. Nothing was sent."
                : "Couldn't reach the network. Nothing was created.";
        case 'tx-failed': {
            const reason = failureReason(error);
            return `The transaction failed${reason ? `: ${reason}` : ''}. Nothing else changed.`;
        }
        case 'tx-expired':
            return "It didn't go through. It's safe to try again.";
        case 'tx-unknown':
            return "Checking whether it went through. Don't send it again yet.";
        case 'previous-pending':
            return 'Your previous transaction is still pending. Nothing was signed.';
        case 'signature-reused':
            return 'Nothing was sent. Try again.';
        case 'v1-retired':
            return "This wallet's old version is retired. Move it to the new version to continue.";
        case 'v1-migrated':
            return 'This wallet moved. Sign in again.';
        case 'key-mismatch':
            return linkNamed(error, 'KeyWalletMismatchError')?.reason === 'disconnected'
                ? 'The wallet was disconnected during this send. Nothing was sent; send it again.'
                : 'This key belongs to another wallet. Nothing was sent.';
        case 'policy': {
            const refusal = linkNamed(error, 'UnlistedSolOutflowError') ?? linkNamed(error, 'UnlistedTokenOutflowError');
            const who = refusal?.signer === 'authority' ? 'This key' : 'This session';
            const what = refusal?.name === 'UnlistedSolOutflowError' ? 'SOL' : 'this token';
            return `${who} isn't allowed to spend ${what}. Nothing was spent.`;
        }
        case 'wallet-mismatch':
            return "The wallet that was created isn't this passkey's. Nothing was saved; try again.";
        default:
            return 'Something went wrong. Nothing was signed or sent.';
    }
}

/** The first link of the error's chain with this `name`, as the fields `userMessage` reads. */
function linkNamed(error: unknown, name: string): { name: string; reason?: unknown; signer?: unknown } | undefined {
    return errorChain(error).find((link) => isNamedError(link, name)) as
        | { name: string; reason?: unknown; signer?: unknown }
        | undefined;
}

/**
 * Why a landed transaction failed, from its logs when it carries them (the
 * first `Program … failed: …` line), else its TransactionError's custom code.
 */
function failureReason(error: unknown): string | null {
    for (const link of errorChain(error)) {
        const logs = (link as { logs?: unknown })?.logs;
        if (Array.isArray(logs)) {
            const line = logs.find((l): l is string => typeof l === 'string' && / failed: /.test(l));
            if (line) return line.replace(/^Program \w+ failed: /, '');
        }
        const custom = ((link as { transactionError?: unknown })?.transactionError as
            | { InstructionError?: [number, { Custom?: number } | string] }
            | undefined)?.InstructionError?.[1];
        if (custom && typeof custom === 'object' && typeof custom.Custom === 'number') return `error ${custom.Custom}`;
        if (typeof custom === 'string') return custom;
    }
    return null;
}
