// describeError and sendStatusOf, through the built package (`pnpm build`
// first): every error class and code the SDK surfaces, in the shapes an app
// receives them (the SDK's classes, a second copy of the package, wrapped by
// the wallet adapter, raw web3.js / Kora / paymaster / TransactionError
// shapes), maps to plain-language text; a transaction that may have been
// sent is always "Still checking…" and never retryable. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Keypair, SendTransactionError } from '@solana/web3.js';
import { WalletSendTransactionError } from '@solana/wallet-adapter-base';
import * as W from '../dist/index.mjs';

const require = createRequire(import.meta.url);
const W2 = require('../dist/index.js');
const approval = require('@lazorkit/sdk-legacy/approval');
const { RefundDestinationMismatchError } = require('@lazorkit/sdk-legacy');

const V2 = W.PROGRAM_ID_DEVNET.toBase58();
const V1 = W.PROGRAM_ID_DEVNET_V1.toBase58();
const INNER = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';
const SIG = '5'.repeat(88);
const hex = (code) => `0x${code.toString(16)}`;

/** Simulation logs of a failed instruction: `first` failed first (an inner program, or `top` itself). */
const logsFor = (code, first = V2, top = V2) => [
    `Program ${top} invoke [1]`,
    ...(first === top ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex(code)}`]),
    `Program ${top} failed: custom program error: ${hex(code)}`,
];
/** A preflight failure, as web3.js throws it. */
const web3Error = (code, first, top) =>
    new SendTransactionError({
        action: 'simulate',
        signature: '',
        transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex(code)}`,
        logs: logsFor(code, first, top),
    });
/** The paymaster's refusal, with the simulation's logs in `data`. */
const paymasterSim = (code, first, top) =>
    new W.PaymasterError('Transaction simulation failed', {
        code: -32002,
        data: { err: { InstructionError: [0, { Custom: code }] }, logs: logsFor(code, first, top) },
    });
/** Kora's text: no logs. */
const kora = (code) => new W.PaymasterError(`Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`, { code: -32000 });
/** Landed and failed, as the wallet reports it. */
const landed = (code, logs) => new W.TransactionFailedError(SIG, { InstructionError: [0, { Custom: code }] }, 1, logs);
const adapterWrap = (error) => new WalletSendTransactionError(error.message, error);

/** code → [title, retryable] for the program errors with their own words. */
const PROGRAM = {
    3002: ['Not allowed', false],
    3006: ['Please approve again', true],
    3007: ['Approval took too long', true],
    3008: ["Session length isn't allowed", false],
    3009: ['Session ended', false],
    3014: ['Approval expired', true],
    3016: ["Time limit isn't allowed", false],
    3021: ['Needs your passkey', false],
    3022: ['Needs your passkey', false],
    3023: ['Over the per-payment limit', false],
    3024: ['Spending limit reached', false],
    3025: ['Spending limit reached for now', false],
    3026: ['Spending limit reached', false],
    3027: ['Spending limit reached for now', false],
    3029: ['Over the per-payment limit', false],
    3030: ['Blocked to protect your wallet', false],
    3031: ['Blocked to protect your wallet', false],
    3032: ['Blocked to protect your wallet', false],
    3037: ['Needs your passkey', false],
    3038: ['Needs your passkey', false],
    3039: ["Refund can't go there", false],
    4005: ["Couldn't cover the fee", false],
    4018: ['Wallet needs an upgrade', false],
};
const GENERIC = "Your wallet couldn't approve this";

function check(error, expected, label) {
    const d = W.describeError(error);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(d[key], value, `${label}: ${key} (${JSON.stringify(d)})`);
    assert.equal(typeof d.title, 'string', label);
    assert.ok(d.title.length > 0 && d.message.length > 0, `${label}: text`);
    assert.ok(!/[A-Z][a-z]+[A-Z]\w*Error|0x[0-9a-f]+|undefined|null/.test(`${d.title} ${d.message} ${d.action ?? ''}`), `${label}: no jargon (${d.message})`);
    if (d.maybeSent) assert.equal(d.retryable, false, `${label}: never retryable when it may have been sent`);
    return d;
}

test('the 0xbc0 of a session refused for its length is 3008 InvalidSessionDuration, from the simulation logs', () => {
    for (const error of [web3Error(3008), paymasterSim(3008), adapterWrap(paymasterSim(3008)), kora(3008), landed(3008)]) {
        assert.deepEqual(W.describeError(error), {
            title: "Session length isn't allowed",
            message: "This app asked for a session length your wallet doesn't allow, so nothing was set up.",
            action: "If it keeps happening, contact the app's support.",
            retryable: false,
            maybeSent: false,
            code: 'program-3008',
            programError: 'InvalidSessionDuration',
        });
    }
});

test('every LazorKit program error maps, read from the logs, from Kora, and landed; its name is the program\'s own (ERROR_NAMES)', () => {
    const codes = Object.keys(W.ERROR_NAMES).map(Number);
    for (const n of [3006, 3008, 3014, 3023, 3030, 3031, 3032, 3037, 3038, 3039, 4018]) assert.ok(codes.includes(n), `${n} in ERROR_NAMES`);
    for (const code of codes) {
        const [title, retryable] = PROGRAM[code] ?? [GENERIC, false];
        const expected = { title, retryable, maybeSent: false, code: code === 4018 ? 'v1-retired' : `program-${code}`, programError: W.ERROR_NAMES[code] };
        check(web3Error(code), expected, `${code} web3.js`);
        check(paymasterSim(code), expected, `${code} paymaster logs`);
        check(landed(code, logsFor(code)), expected, `${code} landed with logs`);
        check(paymasterSim(code, V1, V1), expected, `${code} v1 program`);
        // With no logs, 3014 may be an inner program's (Anchor's AccountNotAssociatedTokenAccount).
        if (code !== 3014) {
            check(kora(code), expected, `${code} Kora`);
            check(landed(code), expected, `${code} landed`);
        }
    }
});

test("an inner program's code is not read as LazorKit's: the logs name who failed", () => {
    for (const code of [3006, 3008, 3014, 3037]) {
        const d = check(paymasterSim(code, INNER), { code: 'tx-failed', title: "It didn't go through", retryable: true, maybeSent: false }, `${code} inner`);
        assert.equal(d.programError, undefined);
    }
    check(kora(3014), { code: 'tx-failed', maybeSent: false }, '3014 with no logs');
    check(landed(3014), { code: 'tx-failed', maybeSent: false }, 'landed 3014 with no logs');
    check(kora(3999), { code: 'tx-failed' }, 'a code LazorKit does not have');
    check(landed(1, logsFor(1, SYSTEM)), { code: 'tx-failed' }, 'landed, an inner program');
    check(new W.TransactionFailedError(SIG, 'InvalidAccountForFee', 1), { code: 'tx-failed', retryable: true }, 'landed, no code');
});

test("the SDK's classes: the same words as the program's code, from either copy, wrapped", () => {
    const pda = Keypair.generate().publicKey;
    for (const L of [W, W2]) {
        check(new L.SignatureReusedError(kora(3006)), { code: 'program-3006', programError: 'SignatureReused', retryable: true }, 'SignatureReusedError');
        check(new L.DeferredExpiredError(pda, SIG, 10n), { code: 'program-3014', title: 'Approval expired', retryable: true }, 'DeferredExpiredError');
        check(new L.UnlistedSolOutflowError('session'), { code: 'program-3037', title: 'Needs your passkey' }, 'UnlistedSolOutflowError');
        check(new L.UnlistedTokenOutflowError('authority'), { code: 'program-3038', programError: 'ActionUnlistedTokenOutflow' }, 'UnlistedTokenOutflowError');
        check(adapterWrap(new L.UnlistedSolOutflowError('authority', paymasterSim(3037))), { code: 'program-3037' }, 'wrapped');
        check(new L.V1WalletRetiredError(), { code: 'v1-retired', title: 'Wallet needs an upgrade', retryable: false }, 'V1WalletRetiredError');
        check(new L.V1WalletMigratedError(), { code: 'v1-migrated', title: 'Your wallet was upgraded', action: 'Sign in again to keep going.' }, 'V1WalletMigratedError');
    }
    assert.match(W.describeError(new W.UnlistedSolOutflowError()).message, /isn't allowed to spend SOL without your passkey/);
    assert.match(W.describeError(new W.UnlistedTokenOutflowError()).message, /spend this token/);
});

test("sdk-legacy's RefundDestinationMismatchError (a refund other than the recorded rent payer, refused before the passkey) reads as 3039", () => {
    const [account, rentPayer, requested] = [0, 1, 2].map(() => Keypair.generate().publicKey);
    const refused = new RefundDestinationMismatchError({ account, rentPayer, requested });
    const expected = { code: 'program-3039', programError: 'RefundDestinationMismatch', title: "Refund can't go there", retryable: false, maybeSent: false };
    check(refused, expected, 'RefundDestinationMismatchError');
    check(adapterWrap(refused), expected, 'wrapped');
    check(Object.assign(new Error('refund'), { name: 'RefundDestinationMismatchError' }), expected, 'by name');
    assert.equal(W.sendStatusOf(refused), 'failed');
});

test('may have been sent: "Still checking…", maybeSent, never retryable, whatever else it carries', () => {
    const expected = {
        title: 'Still checking…',
        message: "Your transaction may have gone through, but it isn't confirmed yet.",
        action: "Don't pay again. Check your balance or activity in a minute.",
        retryable: false,
        maybeSent: true,
        code: 'outcome-unknown',
    };
    const lost = new W.PaymasterError('Failed to sign and send transaction: no answer within 90 s', { maybeSent: true });
    for (const [label, error] of [
        ['TransactionOutcomeUnknownError', new W.TransactionOutcomeUnknownError('lost', undefined, lost)],
        ['its CJS copy', new W2.TransactionOutcomeUnknownError('lost', undefined)],
        ['ConfirmationTimeoutError', new W.ConfirmationTimeoutError(SIG, 120_000)],
        ['wrapped by the wallet adapter', adapterWrap(new W.ConfirmationTimeoutError(SIG, 120_000))],
        ['a paymaster answer lost (timeout)', lost],
        ['a gateway error on a send', new W.PaymasterError('Failed to sign and send transaction: Bad Gateway', { httpStatus: 502, maybeSent: true })],
        ['a paymaster that sent it and reported an error', new W.PaymasterError('Transaction failed', { code: -32003, data: { signature: SIG } })],
        // A later attempt refused for 3037 does not undo an earlier one whose answer was lost.
        ['a refusal after a lost attempt', new W.PaymasterError('Transaction simulation failed', { maybeSent: true, data: { logs: logsFor(3037) } })],
        ['a rate limit after a lost attempt', new W.PaymasterError('Too Many Requests', { httpStatus: 429, maybeSent: true })],
        ['a disconnect after a lost attempt', new W.PaymasterError('x (not sent again: disconnected)', { maybeSent: true, cause: new W.KeyWalletMismatchError('session', 'disconnected', 'A', 'A') })],
    ]) {
        assert.deepEqual(W.describeError(error), expected, label);
        assert.equal(W.sendStatusOf(error), 'checking', label);
    }
});

test("errorKind and userMessage: a paymaster error that may have been sent is 'tx-unknown', not 'network'", () => {
    const lost = new W.PaymasterError('Failed to sign and send transaction: fetch failed', { maybeSent: true });
    assert.equal(W.errorKind(lost), 'tx-unknown');
    assert.equal(W.userMessage(lost, 'send'), "Checking whether it went through. Don't send it again yet.");
    const reported = new W.PaymasterError('Transaction failed', { data: { signature: SIG } });
    assert.equal(W.errorKind(reported), 'tx-unknown');
    assert.equal(W.errorKind(new W.PaymasterError('Failed to get payer: fetch failed')), 'network', 'nothing sent: still network');
    assert.equal(W.errorKind(new W.PaymasterError('later', { maybeSent: true, data: { logs: logsFor(3037) } })), 'tx-unknown');
});

test('the person said no: Cancelled, nothing signed or sent', () => {
    const errors = [
        ...['passkey-closed', 'review-cancelled', 'portal-closed', 'not-now', 'wallet-declined', 'abandoned'].map((r) => new W.UserRejectedError(r)),
        new W.PortalCancelledError(),
        new W.WalletConfirmationDeclinedError(),
        new W2.UserRejectedError('passkey-closed'),
        adapterWrap(new W.UserRejectedError('review-cancelled')),
        // The mobile adapter's, by name and code.
        Object.assign(new Error('The LazorKit portal was closed'), { name: 'PortalCancelledError', code: 'PORTAL_CANCELLED' }),
        Object.assign(new Error('No wallet was chosen'), { name: 'WalletConfirmationDeclinedError' }),
    ];
    for (const error of errors) {
        assert.deepEqual(W.describeError(error), {
            title: 'Cancelled',
            message: 'Nothing was signed or sent.',
            retryable: true,
            maybeSent: false,
            code: 'user-rejected',
        });
        assert.equal(W.sendStatusOf(error), 'cancelled');
    }
});

test('typed approval requests and the portal\'s refusals', () => {
    check(new approval.TypedRequestTooLargeError(20_000, 16_384, 'URL'), { code: 'request-too-large', title: 'Request too large', retryable: false }, 'too large');
    check(new W.TypedRequestTooLargeError(20_000, 16_384, 'URL'), { code: 'request-too-large' }, 'too large (root)');
    check(new approval.TransactionTooLargeError(1300, 1232, 'CreateSession'), { code: 'transaction-too-large', retryable: false }, 'tx too large');
    check(new W.RequestOutOfDateError(), { code: 'request-out-of-date', title: 'Please try again', retryable: true }, 'stale-counter');
    check(new W2.RequestOutOfDateError(), { code: 'request-out-of-date' }, 'stale-counter (CJS)');
    check(new W.PortalReplyMismatchError('slot'), { code: 'portal-reply-mismatch', retryable: true }, 'mismatch');
    const refusals = {
        'wrong-network': ['wrong-network', 'Wrong network', false],
        'request-invalid': ['portal-request-invalid', "This can't be approved", false],
        'challenge-mismatch': ['portal-challenge-mismatch', 'Please try again', true],
        'chain-unavailable': ['portal-chain-unavailable', "Can't reach the network", true],
        'typed-malformed': ['portal-unsupported', 'Update needed', false],
        'typed-unsupported': ['portal-unsupported', 'Update needed', false],
        'something-new': ['portal-refused', "This wasn't approved", false],
    };
    for (const [portalCode, [code, title, retryable]] of Object.entries(refusals)) {
        for (const L of [W, W2]) check(new L.PortalRefusedError(portalCode, 'refused'), { code, title, retryable, maybeSent: false }, portalCode);
    }
});

test('passkeys, configuration, wallets and keys', () => {
    check(new W.PasskeyUnavailableError(), { code: 'passkey-unavailable', title: "Passkeys don't work here", action: 'Open this page in Safari or Chrome.', retryable: false }, 'unavailable');
    check(new W.PasskeyMismatchError(), { code: 'passkey-mismatch', retryable: true }, 'mismatch');
    check(new W.KeyRecoveryError('x'), { code: 'key-recovery', retryable: true }, 'recovery');
    const config = check(new W.LazorkitConfigError('no-mode', 'Pass mode="embedded" or mode="portal" to LazorkitProvider.'), { code: 'config', retryable: false }, 'config');
    assert.doesNotMatch(config.message, /mode=/, "the developer's message is not shown to the person");
    check(new W.WalletVerificationError('x', 'W'), { code: 'wallet-mismatch', retryable: true }, 'verification');
    check(new W.WalletNeedsConfirmationError('cred', []), { code: 'wallet-needs-confirmation', title: 'Choose your wallet' }, 'needs confirmation');
    check(Object.assign(new Error('chooser'), { name: 'WalletChooserNotShownError', code: 'WALLET_CHOOSER_NOT_SHOWN' }), { code: 'wallet-chooser-not-shown' }, 'chooser (mobile)');
    for (const [reason, title, retryable] of [
        ['disconnected', 'Wallet disconnected', false],
        ['no-wallet', 'Not connected', false],
        ['other-wallet', "This key doesn't match your wallet", false],
        ['unbound', "This key doesn't match your wallet", false],
    ]) {
        check(new W.KeyWalletMismatchError('session', reason, 'A', 'B'), { code: 'key-mismatch', title, retryable }, reason);
    }
});

test('sends that never left: expired, previous pending, busy, not connected', () => {
    check(new W.TransactionExpiredError(SIG), { code: 'tx-expired', title: "It didn't go through", action: "It's safe to try again.", retryable: true, maybeSent: false }, 'expired');
    const pending = check(new W.PreviousTransactionPendingError(SIG), { code: 'previous-pending', retryable: true, maybeSent: false }, 'pending');
    assert.match(pending.message, /wasn't sent/);
    for (const message of ['Already signing', 'Already connecting', 'Another passkey request is still in progress']) {
        check(new Error(message), { code: 'busy', title: 'Already in progress', retryable: true }, message);
    }
    check(new Error('No wallet connected'), { code: 'not-connected', retryable: false }, 'no wallet');
    assert.equal(W.sendStatusOf(new W.TransactionExpiredError(SIG)), 'failed');
    assert.equal(W.sendStatusOf(landed(3023, logsFor(3023))), 'failed');
});

test('funds and networks: insufficient funds, wrong network', () => {
    const systemShort = new W.PaymasterError('Transaction simulation failed', {
        data: { logs: [`Program ${V2} invoke [1]`, `Program ${SYSTEM} invoke [2]`, 'Transfer: insufficient lamports 100, need 2000', `Program ${SYSTEM} failed: custom program error: 0x1`, `Program ${V2} failed: custom program error: 0x1`] },
    });
    const tokenShort = landed(1, ['Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]', 'Program log: Error: insufficient funds', 'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1']);
    const rent = new W.TransactionFailedError(SIG, { InsufficientFundsForRent: { account_index: 1 } }, 1);
    for (const [label, error] of [['system transfer', systemShort], ['token transfer', tokenShort], ['rent', rent]]) {
        check(error, { code: 'insufficient-funds', title: 'Not enough funds', action: 'Add funds or try a smaller amount.', retryable: false, maybeSent: false }, label);
    }
    check(new Error('Transaction simulation failed: Attempt to load a program that does not exist'), { code: 'wrong-network', title: 'Wrong network' }, 'no program here');
    check(new W.PortalRefusedError('wrong-network', 'x'), { code: 'wrong-network' }, 'portal');
});

test('the page and the network: pop-up blocked, rate limits, timeouts, network, paymaster', () => {
    check(new Error('Popup was blocked by browser'), { code: 'popup-blocked', title: 'Pop-up blocked', action: 'Allow pop-ups for this site, then try again.', retryable: true }, 'popup');
    check(new Error('Failed to open browser: locked'), { code: 'browser-failed', retryable: true }, 'mobile browser');
    for (const [label, error] of [
        ['paymaster 429', new W.PaymasterError('Failed to get blockhash: Too Many Requests', { httpStatus: 429 })],
        ['RPC 429', new Error('429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":429,"message":"Too many requests for a specific RPC call"}}')],
        ['wrapped', new W.NetworkError("Couldn't read the chain: 429 Too Many Requests", new Error('429'))],
    ]) {
        check(error, { code: 'rate-limited', title: 'The network is busy', retryable: true, maybeSent: false }, label);
    }
    for (const [label, error] of [
        ['paymaster, not a send', new W.PaymasterError('Failed to get payer: no answer within 30 s')],
        ['RPC read', new Error('RPC request timed out after 10000 ms')],
        ['node behind', Object.assign(new Error('The RPC node never reached slot 5'), { name: 'MinContextSlotNotReachedError' })],
    ]) {
        check(error, { code: 'timeout', title: 'Taking too long', retryable: true, maybeSent: false }, label);
    }
    for (const [label, error] of [
        ['NetworkError', new W.NetworkError("Couldn't read the chain: fetch failed")],
        ['CJS NetworkError', new W2.NetworkError('down')],
        ['fetch', new TypeError('Failed to fetch')],
        ['paymaster 503, not a send', new W.PaymasterError('Failed to get payer: Service Unavailable', { httpStatus: 503 })],
    ]) {
        check(error, { code: 'network', title: "Can't reach the network", retryable: true, maybeSent: false }, label);
    }
    check(new W.PaymasterError('Invalid API key', { code: -32001, httpStatus: 401 }), { code: 'paymaster', title: "Couldn't send right now", retryable: true, maybeSent: false }, 'paymaster refusal');
    // A number in a log line is not a rate limit.
    check(new W.PaymasterError('Transaction simulation failed', { data: { logs: ['Program X consumed 429 of 200000 compute units'] } }), { code: 'paymaster' }, 'log number');
});

test('anything else: Something went wrong, not retryable, no promise that nothing was sent', () => {
    for (const [i, error] of [new Error('weird'), 'a string', null, undefined, 42, { message: 7 }, Object.create(null)].entries()) {
        const d = check(error, { code: 'unknown', title: 'Something went wrong', retryable: false, maybeSent: false }, `value ${i}`);
        assert.match(d.action, /check your balance first/);
        assert.equal(W.sendStatusOf(error), 'failed');
    }
    // A getter that throws, and a cycle, are read safely.
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'cause', { get() { throw new Error('no'); } });
    check(hostile, { code: 'unknown' }, 'throwing getter');
    const cycle = new Error('loop');
    cycle.cause = cycle;
    check(cycle, { code: 'unknown' }, 'cycle');
});

test('/core exports describeError and sendStatusOf, and the root and CJS copies agree', async () => {
    const core = await import('../dist/core.mjs');
    assert.equal(core.describeError, W.describeError);
    assert.equal(core.sendStatusOf, W.sendStatusOf);
    assert.deepEqual(W2.describeError(new W.ConfirmationTimeoutError(SIG, 1)), W.describeError(new W2.ConfirmationTimeoutError(SIG, 1)));
});
