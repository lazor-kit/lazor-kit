/**
 * What to show a person when something goes wrong, in plain English, for
 * people who have never used a crypto wallet: `describeError(error)`. And
 * where a send stands once it has ended, `sendStatusOf(error)`, so an app
 * never says "failed" about a transaction that may still land.
 *
 * Errors are read by `name`, `code` and text, through everything they wrap
 * (`cause`, `error`), so the ESM and CJS copies of the package agree and a
 * wallet-adapter wrapper does not hide what it carries. Program errors are
 * read with the program's own error list (`ERROR_NAMES`, `extractErrorCode`).
 *
 * This file is the same in @lazorkit/wallet (core/describeError.ts) and
 * @lazorkit/wallet-mobile-adapter (src/core/describeError.ts), imports aside:
 * the mobile adapter's tests check that.
 */
import { errorChain, errorChainText, isNamedError } from '../program/errorShape';
import {
  ERROR_NAMES,
  extractErrorCode,
  PROGRAM_ID_DEVNET,
  PROGRAM_ID_DEVNET_V1,
  PROGRAM_ID_MAINNET,
  PROGRAM_ID_MAINNET_V1,
} from '../program';

/** A stable name for what went wrong, to branch on and to count. */
export type ErrorDescriptionCode =
  | 'user-rejected'
  | 'outcome-unknown'
  | 'previous-pending'
  | 'tx-expired'
  | 'tx-failed'
  | 'insufficient-funds'
  | 'wrong-network'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'paymaster'
  | 'popup-blocked'
  | 'browser-failed'
  | 'busy'
  | 'not-connected'
  | 'passkey-unavailable'
  | 'passkey-mismatch'
  | 'key-recovery'
  | 'key-mismatch'
  | 'wallet-mismatch'
  | 'wallet-needs-confirmation'
  | 'wallet-chooser-not-shown'
  | 'request-too-large'
  | 'transaction-too-large'
  | 'request-out-of-date'
  | 'portal-reply-mismatch'
  | 'portal-request-invalid'
  | 'portal-challenge-mismatch'
  | 'portal-unsupported'
  | 'portal-chain-unavailable'
  | 'portal-refused'
  | 'v1-retired'
  | 'v1-migrated'
  | 'config'
  | `program-${number}`
  | 'unknown';

/** What `describeError` says about an error. */
export interface ErrorDescription {
  /** A short heading: "Payment cancelled", "Still checking…". */
  title: string;
  /** One or two sentences: what happened, and what did not. */
  message: string;
  /** What the person can do next, when there is something. */
  action?: string;
  /**
   * Trying the same thing again may work. Never true when `maybeSent` is:
   * a transaction that may still land must not be sent twice.
   */
  retryable: boolean;
  /**
   * The transaction may have been sent and may still land. Show it as
   * pending ("Still checking…"), never as failed, and do not let the person
   * pay again until it has settled.
   */
  maybeSent: boolean;
  code: ErrorDescriptionCode;
  /** The LazorKit program's name for the error, when it is one of its errors (`ERROR_NAMES`). */
  programError?: string;
}

/**
 * Where a send stands. While it runs: `'reviewing'` (Embedded mode's review
 * sheet, web only), `'signing'` (the passkey prompt or the portal),
 * `'submitted'` (`onSubmitted` was called, web only: it is on its way). Once
 * it has ended: `'confirmed'` (the promise resolved), or `sendStatusOf(error)`
 * when it rejected: `'cancelled'`, `'checking'` or `'failed'`.
 *
 * `'checking'` is not `'failed'`: the transaction may still land. Show it as
 * pending, and do not offer to send it again.
 */
export type SendStatus = 'idle' | 'reviewing' | 'signing' | 'submitted' | 'confirmed' | 'checking' | 'failed' | 'cancelled';

/**
 * Where a send that rejected with `error` stands: `'cancelled'` (the person
 * said no; nothing was signed or sent), `'checking'` (it may have been sent:
 * its outcome is not known yet) or `'failed'` (it was not sent, or it landed
 * and failed).
 */
export function sendStatusOf(error: unknown): 'cancelled' | 'checking' | 'failed' {
  const description = describeError(error);
  if (description.maybeSent) return 'checking';
  if (description.code === 'user-rejected') return 'cancelled';
  return 'failed';
}

const TRY_AGAIN = 'Try again.';
const SUPPORT = "If it keeps happening, contact the app's support.";

type Text = Omit<ErrorDescription, 'code' | 'maybeSent' | 'programError'>;

function described(
  code: ErrorDescriptionCode,
  text: Text,
  extra: { maybeSent?: boolean; programError?: string } = {},
): ErrorDescription {
  const maybeSent = extra.maybeSent ?? false;
  const description: ErrorDescription = { ...text, retryable: text.retryable && !maybeSent, maybeSent, code };
  if (extra.programError) description.programError = extra.programError;
  return description;
}

/**
 * What to tell a person about `error`, in plain English: a `title`, a
 * `message`, an `action` when there is one, whether trying again may work
 * (`retryable`), and whether the transaction may still land (`maybeSent`).
 *
 * Any value is accepted (an `Error`, a string, a raw RPC error). An error
 * whose transaction may have been sent is always `maybeSent`, whatever else it
 * carries: "Still checking…", never "failed".
 */
export function describeError(error: unknown): ErrorDescription {
  const chain = errorChain(error);
  const has = (name: string) => chain.some((link) => isNamedError(link, name));
  const link = (name: string) => chain.find((l) => isNamedError(l, name)) as Record<string, unknown> | undefined;
  // Everything the error carries (logs, a paymaster's data, a TransactionError),
  // for what the chain said; only the messages, for what the page or the
  // network said (a log line may hold any number).
  const text = errorChainText(error);
  const messages = chain.map(messageOf).join(' ');

  // 1. It may have been sent. First, whatever else the error carries: a
  //    refusal on a later attempt does not undo an earlier one.
  if (mayHaveBeenSent(chain)) {
    return described(
      'outcome-unknown',
      {
        title: 'Still checking…',
        message: "Your transaction may have gone through, but it isn't confirmed yet.",
        action: "Don't pay again. Check your balance or activity in a minute.",
        retryable: false,
      },
      { maybeSent: true },
    );
  }
  if (has('PreviousTransactionPendingError')) {
    return described('previous-pending', {
      title: 'Still checking your last transaction',
      message: "Your previous transaction isn't confirmed yet, so this one wasn't sent.",
      action: 'Wait a moment, then try again.',
      retryable: true,
    });
  }

  // 2. The person said no.
  if (chain.some(isRejection)) {
    return described('user-rejected', {
      title: 'Cancelled',
      message: 'Nothing was signed or sent.',
      retryable: true,
    });
  }

  // 3. The SDK's own errors.
  if (has('TransactionExpiredError')) {
    return described('tx-expired', {
      title: "It didn't go through",
      message: "The network didn't pick up your transaction in time, so nothing happened.",
      action: "It's safe to try again.",
      retryable: true,
    });
  }
  if (has('SignatureReusedError')) return program(3006, 'SignatureReused');
  if (has('SignatureTooOldError')) return program(3007, 'InvalidSignatureAge');
  if (has('DeferredExpiredError')) return program(3014, 'DeferredAuthorizationExpired');
  if (has('UnlistedSolOutflowError')) return program(3037, 'ActionUnlistedSolOutflow');
  if (has('UnlistedTokenOutflowError')) return program(3038, 'ActionUnlistedTokenOutflow');
  if (has('RefundDestinationMismatchError')) return program(3039, 'RefundDestinationMismatch');
  if (has('V1WalletRetiredError')) return program(4018, 'RetiredDeployment');
  if (has('V1WalletMigratedError')) {
    return described('v1-migrated', {
      title: 'Your wallet was upgraded',
      message: 'This wallet moved to the new version of LazorKit.',
      action: 'Sign in again to keep going.',
      retryable: false,
    });
  }
  const keyMismatch = link('KeyWalletMismatchError');
  if (keyMismatch) {
    const reason = keyMismatch.reason;
    if (reason === 'disconnected') {
      return described('key-mismatch', {
        title: 'Wallet disconnected',
        message: 'Your wallet was disconnected while this was being sent, so it was not sent.',
        action: 'Connect and try again.',
        retryable: false,
      });
    }
    if (reason === 'no-wallet') {
      return described('key-mismatch', {
        title: 'Not connected',
        message: "No wallet is connected, so this wasn't sent.",
        action: 'Connect your wallet and try again.',
        retryable: false,
      });
    }
    return described('key-mismatch', {
      title: "This key doesn't match your wallet",
      message: "The key this app saved belongs to another wallet, so this wasn't sent.",
      action: 'Set up access for this wallet again.',
      retryable: false,
    });
  }
  if (has('PasskeyMismatchError')) {
    return described('passkey-mismatch', {
      title: 'A different passkey was used',
      message: "Another passkey answered than the one for this wallet, so nothing happened.",
      action: "Try again and choose this wallet's passkey.",
      retryable: true,
    });
  }
  if (has('KeyRecoveryError')) {
    return described('key-recovery', {
      title: "Couldn't finish setting up",
      message: "Your passkey's details couldn't be read, so no wallet was created.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  if (has('PasskeyUnavailableError')) {
    return described('passkey-unavailable', {
      title: "Passkeys don't work here",
      message: "This browser view can't use passkeys.",
      action: 'Open this page in Safari or Chrome.',
      retryable: false,
    });
  }
  if (has('LazorkitConfigError')) {
    return described('config', {
      title: "This app isn't set up correctly",
      message: "The app's wallet settings have a problem, so this can't continue.",
      action: "Contact the app's support.",
      retryable: false,
    });
  }
  if (has('WalletVerificationError')) {
    return described('wallet-mismatch', {
      title: "Couldn't set up your wallet",
      message: "The new wallet didn't match your passkey, so it wasn't saved.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  if (has('WalletNeedsConfirmationError')) {
    return described('wallet-needs-confirmation', {
      title: 'Choose your wallet',
      message: 'This passkey can open more than one wallet.',
      action: 'Choose the one you recognise.',
      retryable: true,
    });
  }
  if (has('WalletChooserNotShownError')) {
    return described('wallet-chooser-not-shown', {
      title: "Couldn't show your wallets",
      message: 'The list of your wallets could not be shown, so nothing was connected.',
      action: 'Close any open screens and try again.',
      retryable: true,
    });
  }

  // 4. Typed approval requests (createSession, revokeSession, removeAuthority).
  if (has('TypedRequestTooLargeError')) {
    return described('request-too-large', {
      title: 'Request too large',
      message: 'This request is too large to show for approval, so nothing was asked of your passkey.',
      action: SUPPORT,
      retryable: false,
    });
  }
  if (has('TransactionTooLargeError')) {
    return described('transaction-too-large', {
      title: 'Transaction too large',
      message: 'This transaction is too large to send, so nothing was asked of your passkey.',
      action: SUPPORT,
      retryable: false,
    });
  }
  if (has('RequestOutOfDateError')) {
    return described('request-out-of-date', {
      title: 'Please try again',
      message: "The approval page was a little behind, so it didn't ask for your passkey. Nothing was signed.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  if (has('PortalReplyMismatchError')) {
    return described('portal-reply-mismatch', {
      title: "Approval didn't match",
      message: "What was approved doesn't match this request, so nothing was sent.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  const refused = link('PortalRefusedError');
  if (refused) return portalRefused(refused.code);

  // 5. What the chain said: no funds, another network, then a program's error.
  if (/insufficient (funds|lamports)|InsufficientFundsForRent/i.test(text)) {
    return described('insufficient-funds', {
      title: 'Not enough funds',
      message: "Your wallet doesn't have enough to cover this, so it didn't go through.",
      action: 'Add funds or try a smaller amount.',
      retryable: false,
    });
  }
  if (/wrong.network|ProgramAccountNotFound|Attempt to load a program that does not exist|genesis hash/i.test(text)) {
    return wrongNetwork();
  }
  const failure = programFailure(text);
  if (failure && (failure.program === undefined ? failure.code !== 3014 : isLazorKitProgram(failure.program))) {
    const name = ERROR_NAMES[failure.code];
    if (name) return program(failure.code, name);
  }
  if (has('TransactionFailedError') || failure) {
    return described('tx-failed', {
      title: "It didn't go through",
      message: 'Your transaction was refused, so nothing in it happened.',
      action: TRY_AGAIN,
      retryable: true,
    });
  }

  // 6. The page, the network, the services.
  if (/pop-?up.{0,40}blocked|blocked.{0,40}pop-?up/i.test(messages)) {
    return described('popup-blocked', {
      title: 'Pop-up blocked',
      message: 'Your browser blocked the window that asks for your passkey.',
      action: 'Allow pop-ups for this site, then try again.',
      retryable: true,
    });
  }
  if (has('PortalTimeoutError')) {
    return described('browser-failed', {
      title: "Couldn't open the approval page",
      message: "The page that asks for your passkey didn't open or didn't answer in time, so nothing was signed.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  if (/Failed to open browser/i.test(messages)) {
    return described('browser-failed', {
      title: "Couldn't open the approval page",
      message: "The page that asks for your passkey didn't open, so nothing was signed.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  if (/^Already (signing|connecting)|still in progress/i.test(messageOf(error))) {
    return described('busy', {
      title: 'Already in progress',
      message: 'Another request is still open.',
      action: 'Finish or close it first, then try again.',
      retryable: true,
    });
  }
  if (/^No wallet connected/i.test(messageOf(error))) {
    return described('not-connected', {
      title: 'Not connected',
      message: "No wallet is connected, so this wasn't sent.",
      action: 'Connect your wallet and try again.',
      retryable: false,
    });
  }
  if (chain.some((l) => field(l, 'httpStatus') === 429) || /\b429\b|Too Many Requests|rate.?limit/i.test(messages)) {
    return described('rate-limited', {
      title: 'The network is busy',
      message: "Too many requests are going through right now, so this didn't go through.",
      action: 'Wait a few seconds and try again.',
      retryable: true,
    });
  }
  if (has('MinContextSlotNotReachedError') || /timed out|time-?out|no answer within|AbortError|ETIMEDOUT/i.test(messages)) {
    return described('timeout', {
      title: 'Taking too long',
      message: "The network didn't answer in time, so this didn't go through.",
      action: TRY_AGAIN,
      retryable: true,
    });
  }
  const status = chain.map((l) => field(l, 'httpStatus')).find((s) => typeof s === 'number');
  if (
    has('NetworkError') ||
    (typeof status === 'number' && status >= 500) ||
    chain.some((l) => field(l, 'offline') === true) ||
    /failed to fetch|fetch failed|load failed|network ?error|network request failed|offline|ECONN|ENOTFOUND|socket hang up/i.test(messages)
  ) {
    return described('network', {
      title: "Can't reach the network",
      message: "Your device couldn't reach the network, so this didn't go through.",
      action: 'Check your connection and try again.',
      retryable: true,
    });
  }
  if (has('PaymasterError') && /not in the allowed list|is not allowed|disallowed/i.test(messages)) {
    return described('paymaster', {
      title: "Couldn't send this",
      message: "The service that sends transactions for this app doesn't allow this one, so nothing was sent.",
      action: SUPPORT,
      retryable: false,
    });
  }
  if (has('PaymasterError')) {
    return described('paymaster', {
      title: "Couldn't send right now",
      message: "The service that sends transactions for this app didn't accept this one, so nothing was sent.",
      action: `Try again in a moment. ${SUPPORT}`,
      retryable: true,
    });
  }

  return described('unknown', {
    title: 'Something went wrong',
    message: "This didn't finish.",
    action: 'Try again. If you were sending money, check your balance first.',
    retryable: false,
  });
}

/** The transaction may have been sent: an unknown outcome, a lost answer, or a paymaster that sent it and reported an error. */
function mayHaveBeenSent(chain: unknown[]): boolean {
  return chain.some(
    (link) =>
      isNamedError(link, 'TransactionOutcomeUnknownError') ||
      isNamedError(link, 'ConfirmationTimeoutError') ||
      field(link, 'maybeSent') === true ||
      (isNamedError(link, 'PaymasterError') && typeof field(link, 'signature') === 'string'),
  );
}

const REJECTIONS = ['UserRejectedError', 'PortalCancelledError', 'WalletConfirmationDeclinedError'];

function isRejection(link: unknown): boolean {
  const code = field(link, 'code');
  return REJECTIONS.some((name) => isNamedError(link, name)) || code === 'USER_REJECTED' || code === 'PORTAL_CANCELLED';
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = field(error, 'message');
  return typeof message === 'string' ? message : '';
}

const LAZORKIT_PROGRAMS = [PROGRAM_ID_MAINNET, PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET_V1, PROGRAM_ID_DEVNET_V1].map((id) =>
  id.toBase58(),
);

function isLazorKitProgram(id: string): boolean {
  return LAZORKIT_PROGRAMS.includes(id);
}

/**
 * The program error in the error's text: the first program the logs name as
 * failing with a custom error, and its code; else the code alone, as web3.js
 * (`custom program error: 0xbc0`), Kora (`Custom(3008)`) or a landed
 * TransactionError (`"Custom":3008`) print it. A code with no logs is read as
 * LazorKit's, except 3014, which an inner program may raise too (Anchor's
 * `AccountNotAssociatedTokenAccount`) and which only the logs can tell apart.
 */
function programFailure(text: string): { code: number; program?: string } | null {
  const first = /Program (\w{32,44}) failed: custom program error: 0x[0-9a-f]+/i.exec(text);
  if (first) {
    const code = extractErrorCode(first[0]);
    if (code !== null) return { code, program: first[1] };
  }
  const code = extractErrorCode(text);
  if (code !== null) return { code };
  const landed = /"Custom":\s*(\d+)/.exec(text);
  return landed ? { code: Number(landed[1]) } : null;
}

function wrongNetwork(): ErrorDescription {
  return described('wrong-network', {
    title: 'Wrong network',
    message: "This wallet and this app are on different networks, so nothing was signed.",
    action: "Contact the app's support.",
    retryable: false,
  });
}

function portalRefused(code: unknown): ErrorDescription {
  switch (code) {
    case 'wrong-network':
      return wrongNetwork();
    case 'request-invalid':
      return described('portal-request-invalid', {
        title: "This can't be approved",
        message: 'This request would be refused by your wallet, so nothing was signed.',
        action: SUPPORT,
        retryable: false,
      });
    case 'challenge-mismatch':
      return described('portal-challenge-mismatch', {
        title: 'Please try again',
        message: "The approval page couldn't confirm this request, so nothing was signed.",
        action: TRY_AGAIN,
        retryable: true,
      });
    case 'chain-unavailable':
      return described('portal-chain-unavailable', {
        title: "Can't reach the network",
        message: "The approval page couldn't reach the network, so nothing was signed.",
        action: 'Try again in a moment.',
        retryable: true,
      });
    case 'typed-malformed':
    case 'typed-unsupported':
      return described('portal-unsupported', {
        title: 'Update needed',
        message: "The approval page couldn't read this request, so nothing was signed.",
        action: SUPPORT,
        retryable: false,
      });
    default:
      return described('portal-refused', {
        title: "This wasn't approved",
        message: 'The approval page refused this request, so nothing was signed.',
        action: SUPPORT,
        retryable: false,
      });
  }
}

const PER_PAYMENT = 'Send a smaller amount, or approve it with your passkey.';
const HIGHER_LIMIT = 'Approve it with your passkey, or give this app a higher limit.';
const LATER = 'Try again later, or approve it with your passkey.';
const PROTECTED: Text = {
  title: 'Blocked to protect your wallet',
  message: "This would have changed who controls your wallet or its tokens, which isn't allowed here, so it didn't go through.",
  action: "If you didn't expect this, don't approve it again.",
  retryable: false,
};
/** A session's or a delegate key's policy: what the app may do without the passkey. */
const NOT_ALLOWED = (what: string): Text => ({
  title: 'Needs your passkey',
  message: `This app isn't allowed to ${what} without your passkey, so it didn't go through.`,
  action: 'Approve it with your passkey instead.',
  retryable: false,
});

/**
 * The LazorKit program's errors that a person can do something about, in
 * their words. Every other code of `ERROR_NAMES` gets the generic text below.
 * The limits (3021 to 3038) are a session's or a delegate key's: what the app
 * may do without the passkey.
 */
const PROGRAM_TEXT: Record<number, Text> = {
  3002: {
    title: 'Not allowed',
    message: "This key isn't allowed to do that for this wallet, so it didn't go through.",
    retryable: false,
  },
  3006: {
    title: 'Please approve again',
    message: 'Your approval was already used by another transaction, so this one was not sent.',
    action: 'Approve it again.',
    retryable: true,
  },
  3007: {
    title: 'Approval took too long',
    message: 'An approval is only good for about 30 seconds, and this one ran out before it was sent, so nothing was sent.',
    action: 'Try again, and approve right away.',
    retryable: true,
  },
  3008: {
    title: "Session length isn't allowed",
    message: "This app asked for a session length your wallet doesn't allow, so nothing was set up.",
    action: SUPPORT,
    retryable: false,
  },
  3009: {
    title: 'Session ended',
    message: "Your session with this app has ended, so this didn't go through.",
    action: 'Start a new session and try again.',
    retryable: false,
  },
  3014: {
    title: 'Approval expired',
    message: 'This approval ran out of time before it could finish, so nothing in it happened.',
    action: 'Approve it again.',
    retryable: true,
  },
  3016: {
    title: "Time limit isn't allowed",
    message: "This approval's time limit isn't allowed, so nothing was sent.",
    action: SUPPORT,
    retryable: false,
  },
  3021: NOT_ALLOWED('use this feature'),
  3022: NOT_ALLOWED('use this feature'),
  3023: {
    title: 'Over the per-payment limit',
    message: "This is more SOL than this app may send in one payment without your passkey, so it didn't go through.",
    action: PER_PAYMENT,
    retryable: false,
  },
  3024: {
    title: 'Spending limit reached',
    message: "This would go over the SOL this app may spend without your passkey, so it didn't go through.",
    action: HIGHER_LIMIT,
    retryable: false,
  },
  3025: {
    title: 'Spending limit reached for now',
    message: "This would go over the SOL this app may spend without your passkey in this period, so it didn't go through.",
    action: LATER,
    retryable: false,
  },
  3026: {
    title: 'Spending limit reached',
    message: "This would go over what this app may spend of this token without your passkey, so it didn't go through.",
    action: HIGHER_LIMIT,
    retryable: false,
  },
  3027: {
    title: 'Spending limit reached for now',
    message: "This would go over what this app may spend of this token without your passkey in this period, so it didn't go through.",
    action: LATER,
    retryable: false,
  },
  3029: {
    title: 'Over the per-payment limit',
    message: "This is more of this token than this app may send in one payment without your passkey, so it didn't go through.",
    action: PER_PAYMENT,
    retryable: false,
  },
  3030: PROTECTED,
  3031: PROTECTED,
  3032: PROTECTED,
  3037: NOT_ALLOWED('spend SOL'),
  3038: NOT_ALLOWED('spend this token'),
  3039: {
    title: "Refund can't go there",
    message: 'Closing this returns its deposit only to the account that paid it, and this request named a different one, so nothing happened.',
    action: SUPPORT,
    retryable: false,
  },
  4005: {
    title: "Couldn't cover the fee",
    message: "The app couldn't cover the fee for this, so it didn't go through.",
    action: `Try again later. ${SUPPORT}`,
    retryable: false,
  },
  4018: {
    title: 'Wallet needs an upgrade',
    message: 'This wallet is on an older version of LazorKit that no longer sends transactions.',
    action: 'Move it to the new version to continue.',
    retryable: false,
  },
};

const PROGRAM_GENERIC: Text = {
  title: "Your wallet couldn't approve this",
  message: "Your wallet refused this request, so it didn't go through.",
  action: SUPPORT,
  retryable: false,
};

/** A LazorKit program error. 4018 is only ever a retired v1 deployment's: `'v1-retired'`. */
function program(code: number, name: string): ErrorDescription {
  return described(code === 4018 ? 'v1-retired' : `program-${code}`, PROGRAM_TEXT[code] ?? PROGRAM_GENERIC, {
    programError: name,
  });
}
