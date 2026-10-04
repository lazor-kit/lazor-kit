// The exported is*Error predicates, through the built package (`pnpm build`
// first): the SDK's own errors, the same errors from a second copy of the
// package, errors wrapped as an app receives them, and raw RPC / paymaster
// shapes. Then a retired v1 wallet's 4018 through the paymaster and the
// store, against a scripted RPC and paymaster, no network, and the
// paymaster's `beforeAttempt` before each attempt of every way it sends. Run
// with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    Connection,
    Keypair,
    SendTransactionError,
    SystemProgram,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { WalletSendTransactionError } from '@solana/wallet-adapter-base';
import * as W from '../dist/index.mjs';

// The CJS build is a second copy of every class (the dual-package hazard):
// what an app gets when one dependency imports @lazorkit/wallet and another
// requires it. `instanceof` fails between the two.
const require = createRequire(import.meta.url);
const W2 = require('../dist/index.js');
const v1Sdk = require('lazorkit-sdk-v1');

const V2 = W.PROGRAM_ID_DEVNET.toBase58();
const V1 = W.PROGRAM_ID_DEVNET_V1.toBase58();
const INNER = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SIG = '5'.repeat(88);
const PDA = W.PROGRAM_ID_DEVNET;

const hex = { 3006: '0xbbe', 3014: '0xbc6', 4018: '0xfb2' };
/** Logs of a failed instruction: `first` failed first (an inner program, or `top` itself). */
const logsFor = (code, first, top = V2) => [
    `Program ${top} invoke [1]`,
    ...(first === top ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex[code]}`]),
    `Program ${top} failed: custom program error: ${hex[code]}`,
];
const web3Error = (code, first, top) =>
    new SendTransactionError({
        action: 'simulate',
        signature: '',
        transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex[code]}`,
        logs: logsFor(code, first, top),
    });
const korasText = (code) => `Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`;
const paymasterError = (L, message, data) => new L.PaymasterError(message, { code: -32002, data });
const txFailed = (L, code, logs) => new L.TransactionFailedError(SIG, { InstructionError: [0, { Custom: code }] }, 1, logs);
/** How a dApp on the Wallet Standard receives an error (`StandardWalletAdapter.sendTransaction`). */
const walletAdapterWrap = (error) => new WalletSendTransactionError(error.message, error);

test('isSignatureReusedError is true for every SignatureReusedError, whatever its cause', () => {
    assert.equal(W.isSignatureReusedError(new W.SignatureReusedError()), true);
    assert.equal(W.isSignatureReusedError(new W.SignatureReusedError(paymasterError(W, korasText(3006)))), true);
    assert.equal(
        W.isSignatureReusedError(
            new W.SignatureReusedError(
                paymasterError(W, 'Transaction simulation failed', { err: { InstructionError: [0, { Custom: 3006 }] }, logs: logsFor(3006, V2) }),
            ),
        ),
        true,
    );
    assert.equal(W.isSignatureReusedError(new W.SignatureReusedError(txFailed(W, 3006))), true);
    assert.equal(W.isSignatureReusedError(new W.SignatureReusedError({ InstructionError: [0, { Custom: 3006 }] })), true);
});

test('isSignatureReusedError is true for one from another copy of the package, and for one wrapped by wallet-adapter', () => {
    assert.ok(!(new W2.SignatureReusedError() instanceof W.SignatureReusedError));
    assert.equal(W.isSignatureReusedError(new W2.SignatureReusedError()), true);
    assert.equal(W2.isSignatureReusedError(new W.SignatureReusedError()), true);
    assert.equal(W.isSignatureReusedError(walletAdapterWrap(new W.SignatureReusedError(txFailed(W, 3006)))), true);
    assert.equal(W.isSignatureReusedError(walletAdapterWrap(new W2.SignatureReusedError())), true);
    // An error that only shares the name is not one.
    assert.equal(W.isSignatureReusedError(Object.assign(new Error('x'), { name: 'SignatureReusedError' })), false);
});

test('isSignatureReusedError on raw shapes: the logs decide, and a 3006 without logs counts as LazorKit\'s', () => {
    assert.equal(W.isSignatureReusedError(web3Error(3006, V2)), true);
    assert.equal(W.isSignatureReusedError(web3Error(3006, INNER)), false);
    assert.equal(W.isSignatureReusedError(new Error('custom program error: 0xbbe')), true);
    assert.equal(W.isSignatureReusedError({ InstructionError: [0, { Custom: 3006 }] }), true);
    assert.equal(W.isSignatureReusedError(paymasterError(W, korasText(3006))), true);
    assert.equal(
        W.isSignatureReusedError(paymasterError(W, 'Transaction simulation failed: custom program error: 0xbbe', { logs: logsFor(3006, V2) })),
        true,
    );
    assert.equal(W.isSignatureReusedError(txFailed(W, 3006, logsFor(3006, INNER))), false);
    // The logs of a wrapped error count too: an inner program's 3006 is not claimed.
    assert.equal(W.isSignatureReusedError(walletAdapterWrap(web3Error(3006, INNER))), false);
    assert.equal(W.isSignatureReusedError(new Error('something else')), false);
    assert.equal(W.isSignatureReusedError(undefined), false);
    assert.equal(W.isSignatureReusedError(null), false);
});

test('isDeferredExpiredError reads through wrappers, and still claims no bare 3014', () => {
    assert.equal(W.isDeferredExpiredError(new W.DeferredExpiredError(PDA, SIG, 1000n)), true);
    assert.equal(W.isDeferredExpiredError(new W2.DeferredExpiredError(PDA, SIG, 1000n)), true);
    assert.equal(W.isDeferredExpiredError(walletAdapterWrap(new W.DeferredExpiredError(PDA, SIG, 1000n))), true);
    assert.equal(W.isDeferredExpiredError(new Error('wrapped', { cause: new W2.DeferredExpiredError(PDA, SIG, 1000n) })), true);
    assert.equal(W.isDeferredExpiredError(web3Error(3014, V2)), true);
    assert.equal(W.isDeferredExpiredError(web3Error(3014, INNER)), false);
    assert.equal(W.isDeferredExpiredError(paymasterError(W, korasText(3014))), false);
    assert.equal(W.isDeferredExpiredError({ InstructionError: [0, { Custom: 3014 }] }), false);
});

test('isKeyWalletMismatchError is true for every KeyWalletMismatchError, from either copy, wrapped or not', () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const other = Keypair.generate().publicKey.toBase58();
    const own = new W.KeyWalletMismatchError('session', 'other-wallet', wallet, other);
    assert.equal(own.name, 'KeyWalletMismatchError');
    assert.equal(own.reason, 'other-wallet');
    assert.ok(own.message.includes(wallet) && own.message.includes(other));
    assert.equal(W.isKeyWalletMismatchError(own), true);
    assert.equal(W.isKeyWalletMismatchError(new W.KeyWalletMismatchError('authority', 'no-wallet', wallet, undefined)), true);
    assert.equal(W.isKeyWalletMismatchError(new W.KeyWalletMismatchError('session', 'unbound', undefined, undefined)), true);
    const copy = new W2.KeyWalletMismatchError('authority', 'no-wallet', wallet, undefined);
    assert.ok(!(copy instanceof W.KeyWalletMismatchError));
    assert.equal(W.isKeyWalletMismatchError(copy), true);
    assert.equal(W2.isKeyWalletMismatchError(own), true);
    assert.equal(W.isKeyWalletMismatchError(walletAdapterWrap(own)), true);
    assert.equal(W.isKeyWalletMismatchError(new Error('wrapped', { cause: copy })), true);
    // An error that only shares the name is not one, nor is any other error.
    assert.equal(W.isKeyWalletMismatchError(Object.assign(new Error('x'), { name: 'KeyWalletMismatchError' })), false);
    assert.equal(W.isKeyWalletMismatchError(new Error('No session key found. Create a session first.')), false);
    assert.equal(W.isKeyWalletMismatchError(new W.SignatureReusedError()), false);
    assert.equal(W.isKeyWalletMismatchError(undefined), false);
});

test('isRetiredDeploymentError is true for every V1WalletRetiredError, from either copy, wrapped or not', () => {
    assert.equal(W.isRetiredDeploymentError(new W.V1WalletRetiredError()), true);
    assert.equal(W.isRetiredDeploymentError(new W.V1WalletRetiredError(web3Error(4018, V1, V1))), true);
    assert.equal(W.isRetiredDeploymentError(new W2.V1WalletRetiredError()), true);
    assert.equal(W.isRetiredDeploymentError(walletAdapterWrap(new W.V1WalletRetiredError())), true);
});

test('isRetiredDeploymentError on raw 4018 shapes: Kora text, data-only logs, a TransactionError', () => {
    assert.equal(W.isRetiredDeploymentError(web3Error(4018, V1, V1)), true);
    assert.equal(W.isRetiredDeploymentError(new Error('custom program error: 0xfb2'), 1), true);
    assert.equal(W.isRetiredDeploymentError({ InstructionError: [0, { Custom: 4018 }] }, 1), true);
    assert.equal(W.isRetiredDeploymentError(paymasterError(W, korasText(4018)), 1), true);
    assert.equal(W.isRetiredDeploymentError(paymasterError(W, 'Transaction simulation failed', { logs: logsFor(4018, V1, V1) })), true);
    assert.equal(W.isRetiredDeploymentError(txFailed(W, 4018), 1), true);
    // 4018 belongs to v1 only when the logs name v1 or the wallet is a v1 one.
    assert.equal(W.isRetiredDeploymentError(paymasterError(W, korasText(4018)), 2), false);
    assert.equal(W.isRetiredDeploymentError(paymasterError(W, korasText(4018))), false);
    assert.equal(W.isRetiredDeploymentError(new Error('custom program error: 0x1'), 1), false);
});

// ─── A retired v1 wallet's 4018 through the store ───────────────────

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
/**
 * The paymaster's JSON-RPC error for `signTransaction` and
 * `signAndSendTransaction`, or a function of the request's number (from 1)
 * that returns the `Response`.
 */
let paymasterAnswer;
/** How many `signTransaction` / `signAndSendTransaction` requests the paymaster got. */
let paymasterRequests = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) !== PAYMASTER) return realFetch(url, init);
    const { id, method } = JSON.parse(init.body);
    const answer = (body, status = 200) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
    if (method === 'signTransaction' || method === 'signAndSendTransaction') {
        paymasterRequests += 1;
        if (typeof paymasterAnswer === 'function') return paymasterAnswer(paymasterRequests, answer);
        return answer({ error: paymasterAnswer });
    }
    throw new Error(`unscripted paymaster ${method}`);
};

function scriptedConnection(deferredExecPda) {
    const fetch = async (_url, init) => {
        const { id, method, params } = JSON.parse(init.body);
        const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
        if (method === 'getLatestBlockhash') {
            return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
        }
        if (method === 'getAccountInfo' && params[0] === deferredExecPda.toBase58()) {
            const data = Buffer.alloc(176);
            data.writeBigUInt64LE(1000n, 168);
            return reply({
                context: { slot: 500 },
                value: { data: [data.toString('base64'), 'base64'], executable: false, lamports: 2_000_000, owner: V1, rentEpoch: 0, space: 176 },
            });
        }
        if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
        if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
        throw new Error(`unscripted RPC ${method}`);
    };
    return new Connection(RPC, { commitment: 'confirmed', fetch, disableRetryOnRateLimit: true });
}

/** The paymaster logs each failed attempt; keep the output to the assertions. */
function quietPaymaster(t) {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'info', () => {});
}

// ─── The paymaster sends a 4018 once ────────────────────────────────
//
// A retired v1 program answers every attempt with the same 4018, so the
// paymaster fails on the first answer: no second request, and none of the
// 1 s / 2 s waits between attempts. Each call below runs with the default
// retries and backoff, so a retried 4018 would take three requests and 3 s.

const NO_WAIT_MS = 900;
const legacyTx = () =>
    new Transaction({ feePayer, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(
        SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
const v0Tx = () =>
    new VersionedTransaction(
        new TransactionMessage({
            payerKey: feePayer,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
            instructions: [SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
        }).compileToV0Message(),
    );
const v1LogsAnswer = { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(4018, V1, V1) } };
const korasAnswer = { code: -32602, message: korasText(4018) };

/** Runs `call` against the scripted paymaster: the error it threw, how many requests it made, how long it took. */
async function paymasterFailure(answer, call) {
    paymasterAnswer = answer;
    paymasterRequests = 0;
    const started = Date.now();
    try {
        await call();
    } catch (error) {
        return { error, requests: paymasterRequests, ms: Date.now() - started };
    }
    assert.fail('the paymaster call resolved');
}

test("the paymaster does not retry a retired v1 program's 4018: one request, V1WalletRetiredError", async (t) => {
    quietPaymaster(t);
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER });
    for (const send of [() => paymaster.signAndSend(legacyTx()), () => paymaster.signAndSendVersionedTransaction(v0Tx())]) {
        const { error, requests, ms } = await paymasterFailure(v1LogsAnswer, send);
        assert.equal(requests, 1);
        assert.ok(ms < NO_WAIT_MS, `took ${ms} ms`);
        assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
        assert.equal(error.cause.name, 'PaymasterError');
        assert.equal(error.cause.maybeSent, false);
    }
});

test("the paymaster of a v1 wallet reads Kora's Custom(4018), which names no program, as the retired v1 program's", async (t) => {
    quietPaymaster(t);
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 1 });
    const { error, requests, ms } = await paymasterFailure(korasAnswer, () => paymaster.signAndSend(legacyTx()));
    assert.equal(requests, 1);
    assert.ok(ms < NO_WAIT_MS, `took ${ms} ms`);
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
    assert.equal(error.cause.name, 'PaymasterError');
});

test('a 4018 that is not known to be v1\'s is not retried either, and is thrown as the PaymasterError it is', async (t) => {
    quietPaymaster(t);
    for (const paymaster of [
        new W.Paymaster({ paymasterUrl: PAYMASTER }),
        new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 2 }),
    ]) {
        const { error, requests, ms } = await paymasterFailure(korasAnswer, () => paymaster.signAndSend(legacyTx()));
        assert.equal(requests, 1);
        assert.ok(ms < NO_WAIT_MS, `took ${ms} ms`);
        assert.equal(error.name, 'PaymasterError');
        assert.equal(error.maybeSent, false);
    }
    // An inner program's 4018 under a v2 wallet: the logs name it, not v1.
    const inner = { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(4018, INNER) } };
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 2 });
    const { error, requests } = await paymasterFailure(inner, () => paymaster.signAndSend(legacyTx()));
    assert.equal(requests, 1);
    assert.equal(error.name, 'PaymasterError');
});

test('a 4018 after an attempt whose answer was lost is not retried, and still says that attempt may have been sent', async (t) => {
    quietPaymaster(t);
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 1 });
    const lostThen4018 = (n, answer) => (n === 1 ? answer({ error: { code: -32000, message: 'Bad gateway' } }, 502) : answer({ error: v1LogsAnswer }));
    const { error, requests } = await paymasterFailure(lostThen4018, () => paymaster.signAndSend(legacyTx(), 3, 1));
    assert.equal(requests, 2);
    // Not V1WalletRetiredError: that would say nothing was sent.
    assert.equal(error.name, 'PaymasterError');
    assert.equal(error.maybeSent, true);
});

test("the paymaster's signTransaction does not retry a 4018 either", async (t) => {
    quietPaymaster(t);
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 1 });
    const { error, requests, ms } = await paymasterFailure(korasAnswer, () => paymaster.sign(legacyTx()));
    assert.equal(requests, 1);
    assert.ok(ms < NO_WAIT_MS, `took ${ms} ms`);
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
});

test('any other refusal is still retried', async (t) => {
    quietPaymaster(t);
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER }, { protocolVersion: 1 });
    const busy = { code: -32603, message: 'Internal error' };
    const sent = await paymasterFailure(busy, () => paymaster.signAndSend(legacyTx(), 3, 1));
    assert.equal(sent.requests, 3);
    assert.equal(sent.error.name, 'PaymasterError');
    const signed = await paymasterFailure(busy, () => paymaster.sign(legacyTx(), 3, 1));
    assert.equal(signed.requests, 3);
});

/** executeDeferred of a v1 payload (written by the v1 SDK), with the paymaster answering `error`. */
async function executeV1Deferred(error) {
    paymasterAnswer = error;
    paymasterRequests = 0;
    const deferredExecPda = Keypair.generate().publicKey;
    W.useWalletStore.setState({
        connection: scriptedConnection(deferredExecPda),
        config: { portalUrl: 'http://portal.test', paymasterConfig: { paymasterUrl: PAYMASTER }, rpcUrl: RPC, cluster: 'devnet' },
        isSigning: false,
        error: null,
    });
    W.registerCluster(RPC, 'devnet');
    const deferredPayload = v1Sdk.serializeDeferredPayload({
        walletPda: Keypair.generate().publicKey,
        deferredExecPda,
        compactInstructions: [],
        remainingAccounts: [],
    });
    try {
        await W.useWalletStore.getState().executeDeferred({ deferredPayload });
    } catch (caught) {
        return caught;
    }
    assert.fail('executeDeferred resolved');
}

test("a retired v1 program's 4018 in Kora's text reaches the app as V1WalletRetiredError", async (t) => {
    quietPaymaster(t);
    const started = Date.now();
    const error = await executeV1Deferred(korasAnswer);
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
    assert.equal(error.cause.name, 'PaymasterError');
    // Sent once, on the v1 wallet's paymaster: not retried.
    assert.equal(paymasterRequests, 1);
    assert.ok(Date.now() - started < NO_WAIT_MS, `took ${Date.now() - started} ms`);
    assert.equal(W.useWalletStore.getState().error, error);
    assert.equal(W.isRetiredDeploymentError(error), true);
});

test("a retired v1 program's 4018 whose logs are only in the paymaster's data reaches the app as V1WalletRetiredError", async (t) => {
    quietPaymaster(t);
    const error = await executeV1Deferred(v1LogsAnswer);
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
    // Mapped once: the cause is the paymaster's error, not another V1WalletRetiredError.
    assert.equal(error.cause.name, 'PaymasterError');
    assert.equal(paymasterRequests, 1);
});

// ─── beforeAttempt: every send of the paymaster checks first ────────
//
// A session or authority send makes its paymaster with the kept key's check
// as `beforeAttempt` (core/wallet/actions `paymasterFor`), so that nothing it
// signed goes out once the wallet has been disconnected. The paymaster runs
// it right before each attempt, retries included, whichever of its send
// methods the transaction goes out by.

/** Each way the paymaster sends a transaction, with `retries` attempts and a `delay` ms backoff. */
const SENDS = {
    signAndSend: (paymaster, retries, delay) => paymaster.signAndSend(legacyTx(), retries, delay),
    signAndSendVersionedTransaction: (paymaster, retries, delay) => paymaster.signAndSendVersionedTransaction(v0Tx(), retries, delay),
    // Already-encoded bytes: how a txVersion 'v1' transaction goes out (any version is accepted).
    signAndSendRaw: (paymaster, retries, delay) => paymaster.signAndSendRaw(v0Tx().serialize(), feePayer, retries, delay),
};

test('every send method of the paymaster is in SENDS, so the beforeAttempt tests below cover it', () => {
    const methods = Object.getOwnPropertyNames(W.Paymaster.prototype).filter((name) => /^signAndSend/.test(name));
    assert.deepEqual(
        methods.sort(),
        Object.keys(SENDS).sort(),
        'A send method is missing from SENDS: add it, with arguments for one transaction. A kept key\'s send must not ' +
            'go out after a disconnect by any of them (it goes through sendWithRetries, which runs beforeAttempt).',
    );
});

/** A paymaster whose `beforeAttempt` logs 'check' and throws `refuse(n)` when that returns an error; the paymaster logs 'send'. */
function checkedPaymaster(log, refuse = () => undefined) {
    let checks = 0;
    return new W.Paymaster(
        { paymasterUrl: PAYMASTER },
        {
            beforeAttempt: () => {
                log.push('check');
                const refusal = refuse(++checks);
                if (refusal) throw refusal;
            },
        },
    );
}

/** The paymaster answers the first attempt with HTTP `status`, then with a signature. */
const failFirst = (log, status) => (n, answer) => {
    log.push('send');
    return n === 1 ? answer({ error: { code: -32000, message: `refused (${status})` } }, status) : answer({ result: { signature: SIG } });
};

for (const [name, send] of Object.entries(SENDS)) {
    test(`${name}: beforeAttempt runs right before each attempt, the retry included`, async (t) => {
        quietPaymaster(t);
        const log = [];
        paymasterAnswer = failFirst(log, 429);
        paymasterRequests = 0;
        assert.equal(await send(checkedPaymaster(log), 3, 1), SIG);
        assert.deepEqual(log, ['check', 'send', 'check', 'send']);
    });

    test(`${name}: what beforeAttempt throws before the first attempt is thrown, and nothing is sent`, async (t) => {
        quietPaymaster(t);
        const log = [];
        const refusal = new Error('refused before sending');
        paymasterAnswer = failFirst(log, 429);
        paymasterRequests = 0;
        await assert.rejects(send(checkedPaymaster(log, () => refusal), 3, 1), (error) => error === refusal);
        assert.deepEqual(log, ['check']);
        assert.equal(paymasterRequests, 0);
    });

    test(`${name}: what beforeAttempt throws before a retry, after a refusal (nothing sent), is thrown, and the retry is not sent`, async (t) => {
        quietPaymaster(t);
        const log = [];
        const refusal = new Error('refused before the retry');
        paymasterAnswer = failFirst(log, 429);
        paymasterRequests = 0;
        await assert.rejects(send(checkedPaymaster(log, (n) => n === 2 && refusal), 3, 1), (error) => error === refusal);
        assert.deepEqual(log, ['check', 'send', 'check']);
        assert.equal(paymasterRequests, 1);
    });

    test(`${name}: beforeAttempt throwing before a retry, after an attempt whose answer was lost: not sent again, and that attempt may have been sent`, async (t) => {
        quietPaymaster(t);
        const log = [];
        paymasterAnswer = failFirst(log, 503);
        paymasterRequests = 0;
        const refusal = new Error('refused before the retry');
        const error = await send(checkedPaymaster(log, (n) => n === 2 && refusal), 3, 1).then(
            () => assert.fail('the send resolved'),
            (caught) => caught,
        );
        assert.deepEqual(log, ['check', 'send', 'check']);
        assert.equal(paymasterRequests, 1);
        // Not the refusal: that would say nothing was sent.
        assert.equal(error.name, 'PaymasterError');
        assert.equal(error.maybeSent, true);
        assert.equal(error.httpStatus, 503);
        assert.match(error.message, /\(not sent again: refused before the retry\)$/);
        assert.equal(error.cause.name, 'PaymasterError');
    });
}
