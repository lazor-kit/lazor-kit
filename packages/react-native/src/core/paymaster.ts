/*
  Paymaster service integration for Kora

  JSON-RPC client for the paymaster service that sponsors fees on LazorKit
  wallet transactions.
*/
import { PublicKey } from '@solana/web3.js';
import {
  SignatureReusedError,
  SignatureTooOldError,
  isSignatureReusedError,
  signatureTooOldVerdict,
} from '../program/protocol';
import {
  MIN_ATTEMPT_MS,
  SEND_ATTEMPT_TIMEOUT_MS,
  SEND_BUDGET_MS,
  isOffline,
  parseRetryAfter,
  retryDelayMs,
  sendFailureKind,
} from './sendPolicy';

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** How long any request but a send may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How one send is bounded and when it is tried again (see ./sendPolicy). */
export interface PaymasterSendOptions {
  /**
   * Whether the transaction's blockhash is still valid. Asked before every
   * retry: once it says `false`, the bytes are not sent again (they could not
   * land). A check that throws does not stop the retry.
   */
  readonly canResend?: () => Promise<boolean>;
  /** The whole send's time budget, retries and waits included. Default `SEND_BUDGET_MS` (60 s). */
  readonly budgetMs?: number;
  /** Attempts for a transient failure (a 429 does not count). Default 3. */
  readonly maxAttempts?: number;
  /** The first backoff, doubled each attempt. Default 1000 ms. */
  readonly baseDelayMs?: number;
}

/**
 * A paymaster request that returned no result.
 *
 * For `signAndSendTransaction` it also says what may have happened to the
 * transaction: `signature` when the paymaster reported one with its error (it
 * sent the transaction, which then failed, expired, was not confirmed in
 * time, or had already been processed), and `maybeSent` when the transaction
 * may be on its way although no signature came back.
 */
export class PaymasterError extends Error {
  /** The JSON-RPC error code, when the paymaster answered with one. */
  readonly code?: number;
  /** The JSON-RPC error's `data`, as the paymaster sent it. */
  readonly data?: unknown;
  /** The HTTP status, when it was not a success. */
  readonly httpStatus?: number;
  /** The transaction's signature, when the paymaster sent it and said so in its error. */
  readonly signature?: string;
  /**
   * The transaction may have been sent although its signature is not known:
   * the answer was lost (a network error, a timeout, a gateway error), or the
   * same bytes turned out to be already processed.
   */
  maybeSent: boolean;
  /** Nothing was sent: the device said it was offline, so the request was not made. */
  readonly offline?: boolean;
  /** A rate-limited answer's `Retry-After`, in milliseconds, when it gave one. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    details: {
      code?: number;
      data?: unknown;
      httpStatus?: number;
      maybeSent?: boolean;
      offline?: boolean;
      retryAfterMs?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'PaymasterError';
    this.code = details.code;
    this.data = details.data;
    this.httpStatus = details.httpStatus;
    this.maybeSent = details.maybeSent ?? false;
    if (details.offline) this.offline = true;
    if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs;
    const reported = (details.data as { signature?: unknown } | undefined)?.signature;
    if (typeof reported === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(reported)) this.signature = reported;
    if (details.cause !== undefined) (this as { cause?: unknown }).cause = details.cause;
  }
}

/**
 * One JSON-RPC call, bounded in time. Throws `PaymasterError`; for a send,
 * `maybeSent` is set when the request may have reached the paymaster and its
 * answer was lost.
 */
const rpcRequest = async <T>(
  method: string,
  params: any,
  paymasterUrl: string,
  apiKey?: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> => {
  const sending = method === 'signAndSendTransaction';
  if (isOffline()) {
    throw new PaymasterError('RPC request not made: this device is offline, so nothing was sent', { offline: true });
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(paymasterUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
      signal: abort.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new PaymasterError(
      abort.signal.aborted
        ? `RPC request got no answer within ${timeoutMs / 1000} s`
        : `RPC request failed: ${(error as Error)?.message ?? error}`,
      { maybeSent: sending, cause: error }
    );
  }

  // A gateway timeout or a server error can come after the paymaster sent the
  // transaction; a 4xx (bad request, auth, rate limit) is a refusal before
  // anything is sent, and so is an error the paymaster wrote itself with a
  // success status (a signature it reports is kept apart, in `signature`).
  const lost = sending && !response.ok && (response.status >= 500 || response.status === 408);
  const retryAfterMs = response.ok ? undefined : parseRetryAfter(response.headers?.get?.('retry-after'));
  try {
    let json: JsonRpcResponse<T> | undefined;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }

    if (json?.error) {
      throw new PaymasterError(`RPC error: ${json.error.message}`, {
        code: json.error.code,
        data: json.error.data,
        httpStatus: response.ok ? undefined : response.status,
        maybeSent: lost,
        retryAfterMs,
      });
    }

    if (!response.ok) {
      throw new PaymasterError(`RPC request failed with status ${response.status}`, {
        httpStatus: response.status,
        maybeSent: lost,
        retryAfterMs,
      });
    }

    if (!json || !json.result) {
      throw new PaymasterError('RPC result is undefined', { maybeSent: sending });
    }

    return json.result;
  } catch (error) {
    if (error instanceof PaymasterError) throw error;
    // Reading the body failed or timed out after the paymaster started to answer.
    throw new PaymasterError(`RPC request failed: ${(error as Error)?.message ?? error}`, {
      maybeSent: sending,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Retrieves the fee payer signer from the paymaster.
 */
export const getFeePayer = async (paymasterUrl: string, apiKey?: string): Promise<PublicKey> => {
  interface GetPayerSignerResult {
    payment_address: string;
    signer_address: string;
  }

  const result = await rpcRequest<GetPayerSignerResult>(
    'getPayerSigner',
    [],
    paymasterUrl,
    apiKey
  );

  if (!result.signer_address) {
    throw new Error('Failed to get fee payer');
  }

  return new PublicKey(result.signer_address);
};

/**
 * Signs and broadcasts a transaction via the paymaster. Resolves when the
 * paymaster answers, which may be before the transaction has executed:
 * callers confirm it themselves.
 *
 * Retried as ./sendPolicy says, with the same bytes, so it can land at most
 * once: a transient failure (a network error, a timeout, a 5xx) up to
 * `options.maxAttempts` (3) times, a rate limit (429) waited out; both only
 * while the send's budget (60 s) lasts and, with `options.canResend`, while
 * the blockhash is valid. A refusal that cannot change (a program error, an
 * allowlist, missing funds, a failed simulation, a 4xx) is not sent again.
 *
 * Throws `PaymasterError` with `signature` when the paymaster reports the
 * transaction's signature with its error (confirm that signature for the
 * outcome), and with `maybeSent` when an answer was lost or the bytes were
 * already processed. When no attempt may have been sent: LazorKit's
 * SignatureReused (3006) is `SignatureReusedError` (the passkey signature in
 * it is bound to a counter already used), and its InvalidSignatureAge (3007)
 * is `SignatureTooOldError` (the approval was sent more than 150 slots after
 * its challenge): ask the user to approve again.
 */
export const signAndExecuteTransaction = async (
  base64EncodedTransaction: string,
  paymasterUrl: string,
  signerKey: string,
  apiKey?: string,
  feeToken?: string,
  options: PaymasterSendOptions = {}
) => {
  interface SignAndSendResult {
    signature: string;
    signed_transaction: string;
    signer_pubkey: string;
  }
  const budgetMs = options.budgetMs ?? SEND_BUDGET_MS;
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const deadline = Date.now() + budgetMs;
  let maybeSent = false;
  let attempts = 0;
  let rateLimited = 0;
  for (;;) {
    let result: SignAndSendResult;
    try {
      result = await rpcRequest<SignAndSendResult>(
        'signAndSendTransaction',
        {
          transaction: base64EncodedTransaction,
          signer_key: signerKey,
          ...(feeToken && { fee_token: feeToken }),
        },
        paymasterUrl,
        apiKey,
        Math.max(1, Math.min(SEND_ATTEMPT_TIMEOUT_MS, deadline - Date.now()))
      );
    } catch (caught) {
      const error =
        caught instanceof PaymasterError
          ? caught
          : new PaymasterError((caught as Error)?.message ?? String(caught), { cause: caught });
      if (error.signature) throw error;
      if (/already been processed|AlreadyProcessed/i.test(`${error.message} ${JSON.stringify(error.data ?? '')}`)) {
        error.maybeSent = true;
        throw error;
      }
      maybeSent ||= error.maybeSent;
      const kind = sendFailureKind(error);
      if (kind === 'final') throw finalFailure(error, maybeSent);
      let delay: number;
      if (kind === 'rate-limited') {
        rateLimited++;
        delay = retryDelayMs(rateLimited, baseDelayMs, error.retryAfterMs);
      } else {
        attempts++;
        if (attempts >= maxAttempts) throw notSentAgain(error, maybeSent, `${attempts} attempts failed`);
        delay = retryDelayMs(attempts, baseDelayMs);
      }
      if (Date.now() + delay + MIN_ATTEMPT_MS > deadline) {
        throw notSentAgain(error, maybeSent, `the send's ${Math.round(budgetMs / 1000)} s limit was reached`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (options.canResend && !(await stillValid(options.canResend))) {
        throw notSentAgain(error, maybeSent, 'its blockhash has expired, so it could not land');
      }
      continue;
    }
    if (!result.signature) {
      throw new PaymasterError('Failed to sign and execute transaction', { maybeSent: true });
    }
    return result.signature;
  }
};

/**
 * What to throw for a refusal the same bytes would get again: the named
 * error for LazorKit's 3006 and 3007 when no attempt may have been sent; the
 * `PaymasterError` with `maybeSent` when one may have.
 */
function finalFailure(error: PaymasterError, maybeSent: boolean): unknown {
  if (maybeSent) {
    error.maybeSent = true;
    return error;
  }
  if (isSignatureReusedError(error)) return new SignatureReusedError(error);
  if (signatureTooOldVerdict(error) !== 'other') return new SignatureTooOldError(error);
  return error;
}

/** The last attempt's error, saying why the bytes were not sent again. */
function notSentAgain(last: PaymasterError, maybeSent: boolean, why: string): PaymasterError {
  return new PaymasterError(`${last.message} (not sent again: ${why})`, {
    code: last.code,
    data: last.data,
    httpStatus: last.httpStatus,
    maybeSent: maybeSent || last.maybeSent,
    offline: last.offline,
    retryAfterMs: last.retryAfterMs,
    cause: last,
  });
}

/** `canResend`, where a check that fails says nothing: the same bytes are safe to send again. */
async function stillValid(canResend: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await canResend()) !== false;
  } catch {
    return true;
  }
}

/**
 * Signs a transaction with the paymaster but does NOT broadcast it.
 */
export const signTransaction = async (
  base64EncodedTransaction: string,
  paymasterUrl: string,
  signerKey: string,
  apiKey?: string,
  _feeToken?: string
) => {
  interface SignTransactionResult {
    signature: string;
    signed_transaction: string;
    signer_pubkey: string;
  }

  const result = await rpcRequest<SignTransactionResult>(
    'signTransaction',
    {
      transaction: base64EncodedTransaction,
      signer_key: signerKey,
    },
    paymasterUrl,
    apiKey
  );

  if (!result.signed_transaction) {
    throw new Error('Failed to sign transaction');
  }

  return {
    signature: result.signature,
    signed_transaction: result.signed_transaction,
  };
};

/**
 * Retrieves the list of tokens supported by the paymaster for fee payment.
 */
export const getSupportedFeeTokens = async (
  paymasterUrl: string,
  apiKey?: string
) => {
  interface GetSupportedTokensResult {
    tokens: string[];
  }

  const result = await rpcRequest<GetSupportedTokensResult>(
    'getSupportedTokens',
    [],
    paymasterUrl,
    apiKey
  );

  if (!result.tokens) {
    throw new Error('Failed to get supported fee tokens');
  }

  return result.tokens;
};
