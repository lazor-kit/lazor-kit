/*
  Paymaster service integration for Kora

  JSON-RPC client for the paymaster service that sponsors fees on LazorKit
  wallet transactions.
*/
import { PublicKey } from '@solana/web3.js';
import { SignatureReusedError, isSignatureReusedError } from '../program/protocol';

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

/** How long a `signAndSendTransaction` request may take: a paymaster may hold it until the transaction is confirmed. */
const SEND_TIMEOUT_MS = 90_000;
/** How long any other request may take. */
const REQUEST_TIMEOUT_MS = 30_000;

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

  constructor(
    message: string,
    details: { code?: number; data?: unknown; httpStatus?: number; maybeSent?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'PaymasterError';
    this.code = details.code;
    this.data = details.data;
    this.httpStatus = details.httpStatus;
    this.maybeSent = details.maybeSent ?? false;
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
  apiKey?: string
): Promise<T> => {
  const sending = method === 'signAndSendTransaction';
  const timeoutMs = sending ? SEND_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
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
      });
    }

    if (!response.ok) {
      throw new PaymasterError(`RPC request failed with status ${response.status}`, {
        httpStatus: response.status,
        maybeSent: lost,
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
 * Signs and immediately broadcasts a transaction via the paymaster. Resolves
 * when the paymaster answers, which may be before the transaction has
 * executed: callers confirm it themselves. It is not retried.
 *
 * Throws `PaymasterError` with `signature` when the paymaster reports the
 * transaction's signature with its error (confirm that signature for the
 * outcome), and with `maybeSent` when its answer was lost or the bytes were
 * already processed. A rejection with LazorKit's SignatureReused (3006)
 * throws `SignatureReusedError`: the passkey signature in it is bound to a
 * counter already used, so these bytes can never succeed and are not sent
 * again.
 */
export const signAndExecuteTransaction = async (
  base64EncodedTransaction: string,
  paymasterUrl: string,
  signerKey: string,
  apiKey?: string,
  feeToken?: string
) => {
  interface SignAndSendResult {
    signature: string;
    signed_transaction: string;
    signer_pubkey: string;
  }
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
      apiKey
    );
  } catch (error) {
    if (error instanceof PaymasterError && !error.signature && !error.maybeSent) {
      if (/already been processed|AlreadyProcessed/i.test(`${error.message} ${JSON.stringify(error.data ?? '')}`)) {
        error.maybeSent = true;
      } else if (isSignatureReusedError(error)) {
        throw new SignatureReusedError(error);
      }
    }
    throw error;
  }

  if (!result.signature) {
    throw new PaymasterError('Failed to sign and execute transaction', { maybeSent: true });
  }

  return result.signature;
};

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
