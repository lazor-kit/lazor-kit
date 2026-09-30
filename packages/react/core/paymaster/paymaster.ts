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
import { SignatureReusedError, isSignatureReusedError } from '../program/protocol';
import { hasDeferredExpiredCode } from '../wallet/deferred';
export interface PaymasterConfig {
    paymasterUrl: string;
    apiKey?: string;
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
     * the answer was lost (a network error, a timeout, a gateway error), or a
     * resend of the same bytes found them already processed.
     */
    maybeSent: boolean;

    constructor(
        message: string,
        details: { code?: number; data?: unknown; httpStatus?: number; maybeSent?: boolean; cause?: unknown } = {},
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

/** "This transaction has already been processed": the same bytes landed before (the RPC's AlreadyProcessed). */
function isAlreadyProcessed(error: PaymasterError): boolean {
    return /already been processed|AlreadyProcessed/i.test(`${error.message} ${JSON.stringify(error.data ?? '')}`);
}

export class Paymaster {
    private endpoint: string;
    private apiKey?: string;
    private logger = new Logger('Paymaster');

    /**
     * Create a new Paymaster instance
     * @param config Configuration for the paymaster service
     */
    constructor(config: PaymasterConfig) {
        this.endpoint = config.paymasterUrl;
        this.apiKey = config.apiKey;
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
     * its answer was lost.
     */
    private async call<T>(method: string, params: unknown, failure: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        const sending = method === 'signAndSendTransaction';
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
                });
            }
            if (!response.ok) {
                throw new PaymasterError(`${failure}: ${response.statusText || response.status}`, {
                    httpStatus: response.status,
                    maybeSent: lost,
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
     * Sign a transaction using the paymaster service with retries
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
     * `signAndSendTransaction` with retries. Resolves with the signature when
     * the paymaster answers, which may be before the transaction has executed:
     * callers that need its outcome confirm it themselves.
     *
     * A retry sends the same bytes, so a transaction can land at most once.
     * It stops, and throws, when:
     * - the paymaster reports the transaction's signature with its error:
     *   `PaymasterError.signature` (confirm that signature for the outcome);
     * - the same bytes turn out to be already processed, or every attempt
     *   failed after one whose answer was lost: `PaymasterError.maybeSent`;
     * - LazorKit rejected the passkey signature (3006) and no earlier attempt
     *   may have been sent: `SignatureReusedError`. Those bytes are bound to a
     *   counter already used and can never succeed.
     * - the simulation failed with 3014 (an ExecuteDeferred whose
     *   authorization expired, or an inner program's error with that code)
     *   and no earlier attempt may have been sent: the `PaymasterError`.
     *   Whose 3014 it was is told by the caller (`executeBeforeExpiry`).
     */
    private async sendWithRetries(
        attemptSend: () => Promise<string>,
        maxRetries: number,
        baseDelay: number,
    ): Promise<string> {
        let maybeSent = false;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await attemptSend();
            } catch (caught) {
                const error =
                    caught instanceof PaymasterError
                        ? caught
                        : new PaymasterError((caught as Error)?.message ?? String(caught), { cause: caught });
                this.logger.error(`Attempt ${attempt} failed:`, error);
                if (error.signature) throw error;
                if (isAlreadyProcessed(error)) {
                    error.maybeSent = true;
                    throw error;
                }
                maybeSent ||= error.maybeSent;
                if (!maybeSent && isSignatureReusedError(error)) throw new SignatureReusedError(error);
                // DeferredAuthorizationExpired (3014): the slot only moves on,
                // so the same bytes can never pass again.
                if (!maybeSent && hasDeferredExpiredCode(error)) throw error;
                if (attempt === maxRetries) {
                    this.logger.error('All retry attempts failed', error);
                    // A later refusal does not undo an earlier attempt whose
                    // answer was lost: that one may still have been sent.
                    error.maybeSent = maybeSent;
                    throw error;
                }

                // Calculate exponential backoff delay
                const delay = baseDelay * Math.pow(2, attempt - 1);
                this.logger.info(`Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error('Failed to sign and send transaction after all retries');
    }

    private async sendOnce(transactionBase64: string, signerKey: PublicKey | undefined): Promise<string> {
        const result = await this.call<{ signature?: string }>(
            'signAndSendTransaction',
            {
                transaction: transactionBase64,
                ...(signerKey ? { signer_key: signerKey.toBase58() } : {}),
            },
            'Failed to sign and send transaction',
            SEND_TIMEOUT_MS,
        );
        if (!result.signature) {
            throw new PaymasterError("Failed to sign and send transaction: the paymaster's answer has no signature", { maybeSent: true });
        }
        return result.signature;
    }

    /**
     * Sign and send a legacy transaction, with retries (see `sendWithRetries`).
     * @param transaction Transaction to sign and send
     * @param maxRetries Maximum number of retry attempts (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @returns Transaction signature
     */
    async signAndSend(transaction: Transaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<string> {
        const serialized = transaction.serialize({
            verifySignatures: false,
            requireAllSignatures: false
        });
        return this.sendWithRetries(
            () => this.sendOnce(serialized.toString('base64'), transaction.feePayer ?? undefined),
            maxRetries,
            baseDelay,
        );
    }

    /**
     * Sign and send a v0 transaction, with retries (see `sendWithRetries`).
     * @param transaction Transaction to sign and send
     * @param maxRetries Maximum number of retry attempts (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @returns Transaction signature
     */
    async signAndSendVersionedTransaction(transaction: VersionedTransaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<string> {
        // V0 message: account_keys[0] is the fee payer.
        const feePayerKey = transaction.message.staticAccountKeys[0];
        const serialized = Buffer.from(transaction.serialize()).toString('base64');
        return this.sendWithRetries(() => this.sendOnce(serialized, feePayerKey), maxRetries, baseDelay);
    }
}
