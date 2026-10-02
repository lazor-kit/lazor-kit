// The exported is*Error predicates, through the built package (`pnpm build`
// first): the SDK's own errors, the same errors from a second copy of the
// package, errors wrapped as an app receives them, and raw RPC / paymaster
// shapes. Then a retired v1 wallet's 4018 through the store, against a
// scripted RPC and paymaster, no network. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Connection, Keypair, SendTransactionError } from '@solana/web3.js';
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
let paymasterAnswer;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) !== PAYMASTER) return realFetch(url, init);
    const { id, method } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
    if (method === 'signAndSendTransaction') return answer({ error: paymasterAnswer });
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

/** The paymaster logs each attempt (it tries a 4018 three times, a second apart); keep the output to the assertions. */
function quietPaymaster(t) {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'info', () => {});
}

/** executeDeferred of a v1 payload (written by the v1 SDK), with the paymaster answering `error`. */
async function executeV1Deferred(error) {
    paymasterAnswer = error;
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
    const error = await executeV1Deferred({ code: -32602, message: korasText(4018) });
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
    assert.equal(error.cause.name, 'PaymasterError');
    assert.equal(W.useWalletStore.getState().error, error);
    assert.equal(W.isRetiredDeploymentError(error), true);
});

test("a retired v1 program's 4018 whose logs are only in the paymaster's data reaches the app as V1WalletRetiredError", async (t) => {
    quietPaymaster(t);
    const error = await executeV1Deferred({ code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(4018, V1, V1) } });
    assert.ok(error instanceof W.V1WalletRetiredError, `${error.name}: ${error.message}`);
    // Mapped once: the cause is the paymaster's error, not another V1WalletRetiredError.
    assert.equal(error.cause.name, 'PaymasterError');
});
