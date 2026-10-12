/**
 * Paymaster service for handling transaction fees and signing
 */
import {
    Transaction,
    PublicKey,
    VersionedTransaction
} from '@solana/web3.js';
import { Logger } from '../../utils/logger';
import { Buffer } from 'buffer';
import {
    SignatureReusedError,
    SignatureTooOldError,
    V1WalletRetiredError,
    hasRetiredDeploymentCode,
    isRetiredDeploymentError,
    isSignatureReusedError,
    signatureTooOldVerdict,
    type ProtocolVersion,
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
export interface PaymasterConfig {
    paymasterUrl: string;
    apiKey?: string;
}

/** How long any request but a send may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How one send is bounded and when it is tried again (see ./sendPolicy). */
export interface PaymasterSendOptions {
    /**
     * Whether the transaction's blockhash is still valid. Asked before every
     * retry: once it says `false`, the bytes are not sent again (they could
     * not land). A check that throws does not stop the retry.
     */
    canResend?: () => Promise<boolean>;
    /** The whole send's time budget, retries and waits included. Default `SEND_BUDGET_MS` (60 s). */
    budgetMs?: number;
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
     * the answer was lost (a network error, a timeout, a gateway error), or a
     * resend of the same bytes found them already processed.
     */
    maybeSent: boolean;
    /**
     * Nothing was sent: the device was offline (`navigator.onLine === false`)
     * when the request was to be made, so it was not made.
     */
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
        } = {},
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

/** "This transaction has already been processed": the same bytes landed before (the RPC's AlreadyProcessed). */
function isAlreadyProcessed(error: PaymasterError): boolean {
    return /already been processed|AlreadyProcessed/i.test(`${error.message} ${JSON.stringify(error.data ?? '')}`);
}

export class Paymaster {
    private endpoint: string;
    private apiKey?: string;
    private protocolVersion?: ProtocolVersion;
    private readonly beforeAttempt?: () => void;
    private logger = new Logger('Paymaster');

    /**
     * Create a new Paymaster instance
     * @param config Configuration for the paymaster service
     * @param options.protocolVersion The protocol of the wallet whose
     *   transactions this paymaster signs. With `1`, a 4018 that names no
     *   program (Kora's `Custom(4018)`) is the retired v1 program's, and is
     *   thrown as `V1WalletRetiredError` (see `isRetiredDeploymentError`).
     * @param options.beforeAttempt Runs right before each attempt to send, of
     *   every send this paymaster makes, retries included; what it throws
     *   stops the send (see `sendWithRetries`). The SDK makes a paymaster for
     *   each action, and gives a session or authority send its kept key's
     *   check: nothing is sent once the wallet has been disconnected. It is
     *   the paymaster's, not each send method's, so that every way of
     *   sending (each transaction version) runs it.
     */
    constructor(
        config: PaymasterConfig,
        options: { protocolVersion?: ProtocolVersion; beforeAttempt?: () => void } = {},
    ) {
        this.beforeAttempt = options.beforeAttempt;
        this.endpoint = config.paymasterUrl;
        this.apiKey = config.apiKey;
        this.protocolVersion = options.protocolVersion;
    }

    /**
     * A 4018 answer, as the error to throw: `V1WalletRetiredError` when it is
     * the retired v1 program's, the paymaster's own error when whose 4018 it
     * is cannot be told here (the caller, which knows the wallet, can).
     */
    private retiredDeploymentFailure(error: unknown): unknown {
        return isRetiredDeploymentError(error, this.protocolVersion) ? new V1WalletRetiredError(error) : error;
    }

    private getHeaders(): HeadersInit {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }
        return headers;
    }

    /**
     * One JSON-RPC call, bounded in time. Throws `PaymasterError`; for a send,
     * `maybeSent` is set when the request may have reached the paymaster and
     * its answer was lost. On a device that says it is offline the request is
     * not made at all: `offline`, and never `maybeSent`.
     */
    private async call<T>(method: string, params: unknown, failure: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        const sending = method === 'signAndSendTransaction';
        if (isOffline()) {
            throw new PaymasterError(`${failure}: this device is offline, so nothing was sent`, { offline: true });
        }
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        let response: Response;
        try {
            response = await fetch(`${this.endpoint}`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: abort.signal,
            });
        } catch (error) {
            clearTimeout(timer);
            const timedOut = abort.signal.aborted;
            throw new PaymasterError(
                timedOut ? `${failure}: no answer within ${timeoutMs / 1000} s` : `${failure}: ${(error as Error)?.message ?? error}`,
                { maybeSent: sending, cause: error },
            );
        }
        // A gateway timeout or a server error can come after the paymaster
        // sent the transaction; a 4xx (bad request, auth, rate limit) is a
        // refusal before anything is sent, and so is an error the paymaster
        // wrote itself with a success status (a signature it reports is kept
        // apart, in `signature`).
        const lost = sending && !response.ok && (response.status >= 500 || response.status === 408);
        const retryAfterMs = response.ok ? undefined : parseRetryAfter(response.headers?.get?.('retry-after'));
        try {
            let body: { result?: T; error?: { code?: number; message?: string; data?: unknown } } | undefined;
            try {
                body = await response.json();
            } catch {
                body = undefined;
            }
            if (body?.error) {
                throw new PaymasterError(body.error.message || 'Unknown paymaster error', {
                    code: body.error.code,
                    data: body.error.data,
                    httpStatus: response.ok ? undefined : response.status,
                    maybeSent: lost,
                    retryAfterMs,
                });
            }
            if (!response.ok) {
                throw new PaymasterError(`${failure}: ${response.statusText || response.status}`, {
                    httpStatus: response.status,
                    maybeSent: lost,
                    retryAfterMs,
                });
            }
            if (!body || body.result === undefined) {
                throw new PaymasterError(`${failure}: the paymaster's answer has no result`, { maybeSent: sending });
            }
            return body.result;
        } catch (error) {
            if (error instanceof PaymasterError) throw error;
            // Reading the body failed or timed out after the paymaster started to answer.
            throw new PaymasterError(`${failure}: ${(error as Error)?.message ?? error}`, { maybeSent: sending, cause: error });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Get the public key of the fee payer from the paymaster service
     * @returns Public key of the fee payer
     */
    async getPayer(): Promise<PublicKey> {
        try {
            const result = await this.call<{ signer_address: string }>('getPayerSigner', [], 'Failed to get payer');
            return new PublicKey(result.signer_address);
        } catch (error) {
            this.logger.error('Failed to get payer', error);
            throw error;
        }
    }

    /**
     * Get a recent blockhash from the paymaster service
     * @returns Recent blockhash as a string
     */
    async getBlockhash(): Promise<string> {
        try {
            const result = await this.call<{ blockhash: string }>('getBlockhash', [], 'Failed to get blockhash');
            return result.blockhash;
        } catch (error) {
            this.logger.error('Failed to get blockhash', error);
            throw error;
        }
    }

    /**
     * Sign a transaction using the paymaster service
     * @param transaction Transaction to sign
     * @returns Signed transaction
     */
    private async attemptSign(transaction: Transaction, attempt: number = 1): Promise<Transaction> {
        try {
            const serialized = transaction.serialize({
                verifySignatures: false,
                requireAllSignatures: false
            });
            const result = await this.call<{ signed_transaction: string }>(
                'signTransaction',
                {
                    transaction: serialized.toString('base64'),
                    ...(transaction.feePayer ? { signer_key: transaction.feePayer.toBase58() } : {}),
                },
                'Failed to sign transaction',
            );
            return Transaction.from(Buffer.from(result.signed_transaction, 'base64'));
        } catch (error) {
            this.logger.error(`Sign attempt ${attempt} failed:`, error);
            throw error;
        }
    }

    /**
     * Sign a transaction using the paymaster service with retries. A 4018
     * (`RetiredDeployment`) is not retried: it throws `V1WalletRetiredError`
     * when it is the retired v1 program's, the `PaymasterError` otherwise.
     * @param transaction Transaction to sign
     * @param maxRetries Maximum number of retry attempts (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @returns Signed transaction
     */
    async sign(transaction: Transaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<Transaction> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.attemptSign(transaction, attempt);
            } catch (error) {
                // The same bytes get the same 4018 every time.
                if (hasRetiredDeploymentCode(error)) throw this.retiredDeploymentFailure(error);
                // And the same refusal: a program error, an allowlist, no funds (see ./sendPolicy).
                if (error instanceof PaymasterError && sendFailureKind(error) === 'final') throw error;
                if (attempt === maxRetries) {
                    this.logger.error('All sign retry attempts failed', error);
                    throw error;
                }

                // Calculate exponential backoff delay
                const delay = baseDelay * Math.pow(2, attempt - 1);
                this.logger.info(`Retrying sign in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error('Failed to sign transaction after all retries');
    }

    /**
     * `signAndSendTransaction` with retries (see ./sendPolicy). Resolves with
     * the signature when the paymaster answers, which may be before the
     * transaction has executed: callers that need its outcome confirm it
     * themselves.
     *
     * Each attempt, retries included, first runs this paymaster's
     * `beforeAttempt` (see the constructor). When that throws, nothing more is
     * sent: what it threw is thrown when no earlier attempt may have been sent
     * (nothing was); otherwise the last attempt's `PaymasterError` with
     * `maybeSent`, its message saying why the bytes were not sent again.
     *
     * A retry sends the same bytes, so a transaction can land at most once.
     * Only a transient failure (a network error, a timeout, a 5xx, a blockhash
     * the relayer's RPC has not seen yet) is retried, up to `maxRetries`
     * attempts, and a rate limit (429) is waited out (`Retry-After`, capped);
     * both only while the send's budget (`options.budgetMs`, 60 s) lasts and,
     * when `options.canResend` is given, while the blockhash is valid. One
     * attempt waits at most `SEND_ATTEMPT_TIMEOUT_MS` (30 s) for its answer.
     *
     * It stops, and throws, when:
     * - the paymaster reports the transaction's signature with its error:
     *   `PaymasterError.signature` (confirm that signature for the outcome);
     * - the same bytes turn out to be already processed: `maybeSent`;
     * - an attempt is refused for good (a program error, an allowlist, missing
     *   funds, a failed simulation, a 4xx), and no earlier attempt may have
     *   been sent:
     *   - LazorKit's SignatureReused (3006): `SignatureReusedError`. Those
     *     bytes are bound to a counter already used and can never succeed.
     *   - LazorKit's InvalidSignatureAge (3007): `SignatureTooOldError`. The
     *     approval was sent more than 150 slots after its challenge; ask the
     *     user to approve again.
     *   - a 4018 (`RetiredDeployment`): `V1WalletRetiredError` when it is the
     *     retired v1 program's (the logs name v1, or `protocolVersion` is 1),
     *     the `PaymasterError` otherwise, which the caller maps by the
     *     wallet's protocol.
     *   - anything else (3014, 3023, 3037, 3038, …): the `PaymasterError`.
     * - the retries, the budget or the blockhash run out: the last attempt's
     *   `PaymasterError`, its message saying why it was not sent again.
     *
     * Whenever an earlier attempt's answer was lost, the error thrown has
     * `maybeSent`: a later refusal does not undo it.
     */
    private async sendWithRetries(
        attemptSend: (timeoutMs: number) => Promise<string>,
        maxRetries: number,
        baseDelay: number,
        options: PaymasterSendOptions = {},
    ): Promise<string> {
        const budgetMs = options.budgetMs ?? SEND_BUDGET_MS;
        const deadline = Date.now() + budgetMs;
        let maybeSent = false;
        let last: PaymasterError | undefined;
        let attempts = 0;
        let rateLimited = 0;
        for (;;) {
            if (this.beforeAttempt) {
                try {
                    this.beforeAttempt();
                } catch (refusal) {
                    if (!maybeSent || !last) throw refusal;
                    // An earlier attempt may still land: its outcome is unknown, not refused.
                    throw notSentAgain(last, true, (refusal as Error)?.message ?? String(refusal));
                }
            }
            try {
                return await attemptSend(Math.max(1, Math.min(SEND_ATTEMPT_TIMEOUT_MS, deadline - Date.now())));
            } catch (caught) {
                const error =
                    caught instanceof PaymasterError
                        ? caught
                        : new PaymasterError((caught as Error)?.message ?? String(caught), { cause: caught });
                last = error;
                if (error.signature) throw error;
                if (isAlreadyProcessed(error)) {
                    error.maybeSent = true;
                    throw error;
                }
                maybeSent ||= error.maybeSent;
                const kind = sendFailureKind(error);
                this.logger.error(`Attempt ${attempts + rateLimited + 1} failed (${kind}):`, error);
                if (kind === 'final') throw this.finalFailure(error, maybeSent);

                let delay: number;
                if (kind === 'rate-limited') {
                    rateLimited++;
                    delay = retryDelayMs(rateLimited, baseDelay, error.retryAfterMs);
                } else {
                    attempts++;
                    if (attempts >= maxRetries) throw notSentAgain(error, maybeSent, `${attempts} attempts failed`);
                    delay = retryDelayMs(attempts, baseDelay);
                }
                if (Date.now() + delay + MIN_ATTEMPT_MS > deadline) {
                    throw notSentAgain(error, maybeSent, `the send's ${Math.round(budgetMs / 1000)} s limit was reached`);
                }
                this.logger.info(`Retrying in ${delay}ms`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                if (options.canResend && !(await stillValid(options.canResend))) {
                    throw notSentAgain(error, maybeSent, 'its blockhash has expired, so it could not land');
                }
            }
        }
    }

    /**
     * What to throw for a refusal that the same bytes would get again
     * (`sendFailureKind` 'final'): the named error for LazorKit's 3006, 3007
     * and a retired v1 program's 4018, when no earlier attempt may have been
     * sent; the `PaymasterError` with `maybeSent` when one may have.
     */
    private finalFailure(error: PaymasterError, maybeSent: boolean): unknown {
        if (maybeSent) {
            error.maybeSent = true;
            return error;
        }
        if (isSignatureReusedError(error)) return new SignatureReusedError(error);
        if (hasRetiredDeploymentCode(error)) return this.retiredDeploymentFailure(error);
        if (signatureTooOldVerdict(error) !== 'other') return new SignatureTooOldError(error);
        return error;
    }

    private async sendOnce(transactionBase64: string, signerKey: PublicKey | undefined, timeoutMs: number): Promise<string> {
        const result = await this.call<{ signature?: string }>(
            'signAndSendTransaction',
            {
                transaction: transactionBase64,
                ...(signerKey ? { signer_key: signerKey.toBase58() } : {}),
            },
            'Failed to sign and send transaction',
            timeoutMs,
        );
        if (!result.signature) {
            throw new PaymasterError("Failed to sign and send transaction: the paymaster's answer has no signature", { maybeSent: true });
        }
        return result.signature;
    }

    /**
     * Sign and send a legacy transaction, with retries (see `sendWithRetries`).
     * @param transaction Transaction to sign and send
     * @param maxRetries Maximum number of attempts that are not rate-limited (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @param options The send's budget, and the blockhash check before each retry
     * @returns Transaction signature
     */
    async signAndSend(
        transaction: Transaction,
        maxRetries: number = 3,
        baseDelay: number = 1000,
        options: PaymasterSendOptions = {},
    ): Promise<string> {
        const serialized = transaction.serialize({
            verifySignatures: false,
            requireAllSignatures: false
        });
        return this.sendWithRetries(
            (timeoutMs) => this.sendOnce(serialized.toString('base64'), transaction.feePayer ?? undefined, timeoutMs),
            maxRetries,
            baseDelay,
            options,
        );
    }

    /**
     * Sign and send a v0 transaction, with retries (see `sendWithRetries`).
     * @param transaction Transaction to sign and send
     * @param maxRetries Maximum number of attempts that are not rate-limited (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @param options The send's budget, and the blockhash check before each retry
     * @returns Transaction signature
     */
    async signAndSendVersionedTransaction(
        transaction: VersionedTransaction,
        maxRetries: number = 3,
        baseDelay: number = 1000,
        options: PaymasterSendOptions = {},
    ): Promise<string> {
        // V0 message: account_keys[0] is the fee payer.
        const feePayerKey = transaction.message.staticAccountKeys[0];
        const serialized = Buffer.from(transaction.serialize()).toString('base64');
        return this.sendWithRetries((timeoutMs) => this.sendOnce(serialized, feePayerKey, timeoutMs), maxRetries, baseDelay, options);
    }
}

/**
 * The last attempt's error, saying why the bytes were not sent again, with
 * `maybeSent` when any attempt may have been sent.
 */
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
