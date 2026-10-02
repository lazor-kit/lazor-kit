/**
 * What the exported `is*Error` predicates read an error through.
 *
 * An error reaches an app in more shapes than the one the SDK threw:
 * - wrapped: in `cause` (this SDK's own errors, ES2022 errors), or in `error`,
 *   where `@solana/wallet-adapter-base` keeps the original. A dApp that reaches
 *   LazorKit through the Wallet Standard gets every error as
 *   `WalletSendTransactionError(message, error)`.
 * - from another copy of this package: the ESM and the CJS build are two
 *   copies of every class, so `instanceof` fails between them. A class is then
 *   recognised by its `name` and `code`.
 * - raw: web3.js text, a TransactionError object, a paymaster's JSON-RPC error
 *   (with the logs in `data`), Kora's text.
 *
 * Not exported from the package.
 */

/** How many links of a chain are read; a cycle ends it sooner. */
const MAX_LINKS = 8;

function read(value: object, key: string): unknown {
    try {
        return (value as Record<string, unknown>)[key];
    } catch {
        return undefined;
    }
}

/**
 * The error, then everything it wraps (`cause`, `error`), outermost first.
 * Stops at a cycle and after `MAX_LINKS` links.
 */
export function errorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    const queue: unknown[] = [error];
    while (queue.length > 0 && chain.length < MAX_LINKS) {
        const link = queue.shift();
        if (link === undefined || link === null || chain.includes(link)) continue;
        chain.push(link);
        if (typeof link === 'object') queue.push(read(link, 'cause'), read(link, 'error'));
    }
    return chain;
}

/** JSON, with bigints written as decimal text; '' for nothing, or for what cannot be written (a cycle). */
function json(value: unknown): string {
    if (value === undefined || value === null) return '';
    try {
        return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? '';
    } catch {
        return '';
    }
}

/**
 * The text one link carries: its message, logs, JSON-RPC `data` and
 * TransactionError. A value that is not an `Error` (a TransactionError, a
 * JSON-RPC error object) is also read whole, as JSON.
 */
function linkText(link: unknown): string {
    if (typeof link === 'string') return link;
    if (typeof link !== 'object' || link === null) return String(link);
    const message = read(link, 'message');
    const parts = [
        typeof message === 'string' ? message : '',
        json(read(link, 'logs')),
        json(read(link, 'data')),
        json(read(link, 'transactionError')),
    ];
    if (!(link instanceof Error)) parts.push(json(link));
    return parts.join(' ');
}

/** The text of every link of the error's chain, outermost first. */
export function errorChainText(error: unknown): string {
    return errorChain(error).map(linkText).join(' ');
}

/**
 * Some link of the error's chain is an error of this class: an instance of
 * it, or, from another copy of the package, an error with its `name` (and
 * `code`, when the class has one).
 */
export function chainHasError(
    error: unknown,
    errorClass: abstract new (...args: never[]) => Error,
    name: string,
    code?: number,
): boolean {
    return errorChain(error).some((link) => link instanceof errorClass || isNamedError(link, name, code));
}

/** An error of this `name` (and `code`, when given), whichever copy of the package made it. */
export function isNamedError(value: unknown, name: string, code?: number): boolean {
    if (typeof value !== 'object' || value === null) return false;
    return read(value, 'name') === name && (code === undefined || read(value, 'code') === code);
}
