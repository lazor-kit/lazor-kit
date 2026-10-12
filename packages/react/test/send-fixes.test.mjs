// Sends, through the built package in a page on https://app.test with a
// virtual authenticator and a scripted devnet and paymaster (Embedded mode,
// so a passkey send runs end to end without a portal):
// - `transactionOptions.computeUnitLimit` puts SetComputeUnitLimit first,
//   before the secp256r1 precompile; a bad one is refused before the prompt;
// - a device offline before the send sends nothing, says so (`network`, never
//   "may have been sent"), and the next send does not wait on it;
// - LazorKit's 3007 (approval too old) is never resent: SignatureTooOldError,
//   "Approval took too long", retryable; calling the action again asks for a
//   new approval and lands (the one-tap retry);
// - a refusal that cannot change (3008, 3009, 3024, 3025, an allowlist, no
//   funds) is sent once; a 429 is waited out and sent again.
// Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SystemProgram } from '@solana/web3.js';
import { freshPage } from './helpers/fresh-page.mjs';
import { credential } from './helpers/fake-webauthn.mjs';
import { embeddedConfig, loadPackage, rejection, setUpPage, RP_ID } from './helpers/embedded-page.mjs';

console.debug = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const { window, authenticator } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const SECP256R1 = 'Secp256r1SigVerify1111111111111111111111111';

let cred;
let vault;
const signGets = () => authenticator.calls.filter((c) => c.kind === 'get');
const transfer = (lamports = 0) => [SystemProgram.transfer({ fromPubkey: vault, toPubkey: vault, lamports })];
const programsOf = (tx) => tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
const answer = (status, body, headers = {}) => () =>
    new Response(body === undefined ? '' : JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }), { status, headers });
const korasRefusal = (code) =>
    answer(200, { error: { code: -32000, message: `Invalid transaction: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x${code.toString(16)}` } });
function setOnline(online) {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    setOnline(true);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
    W.useWalletStore.setState({ wallet: null, isConnecting: false, isSigning: false, error: null, step: null });
    cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    ({ vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 1 }));
    W.createLazorkitClient(embeddedConfig({ confirm: false }), { replace: true });
    await W.getLazorkitClient().connect();
    authenticator.clear();
    chain.state.rpcCalls.length = 0;
    chain.state.sent.length = 0;
});

// ─── computeUnitLimit ───────────────────────────────────────────────────────

test('computeUnitLimit: SetComputeUnitLimit is the first instruction, before the precompile and the LazorKit instruction', async () => {
    await W.getLazorkitClient().signAndSend({ instructions: transfer(), transactionOptions: { computeUnitLimit: 60_000 } });
    assert.equal(chain.state.sent.length, 1);
    const tx = chain.state.sent[0];
    const programs = programsOf(tx);
    assert.deepEqual(programs.slice(0, 3), [COMPUTE_BUDGET, SECP256R1, chain.PROGRAM.toBase58()]);
    const data = Buffer.from(tx.message.compiledInstructions[0].data);
    assert.equal(data[0], 2, 'SetComputeUnitLimit');
    assert.equal(data.readUInt32LE(1), 60_000);
});

test('computeUnitLimit: none by default; 0 means none, as before', async () => {
    await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    await W.getLazorkitClient().signAndSend({ instructions: transfer(), transactionOptions: { computeUnitLimit: 0 } });
    for (const tx of chain.state.sent) assert.ok(!programsOf(tx).includes(COMPUTE_BUDGET));
});

test('computeUnitLimit: one that is not a whole number from 1 to 1,400,000 is refused before the passkey is asked', async () => {
    for (const bad of [1.5, -1, 1_400_001, Number.NaN]) {
        const error = await rejection(
            W.getLazorkitClient().signAndSend({ instructions: transfer(), transactionOptions: { computeUnitLimit: bad } }),
        );
        assert.match(error.message, /computeUnitLimit must be a whole number/);
    }
    assert.equal(signGets().length, 0, 'no prompt');
    assert.equal(chain.state.sent.length, 0, 'nothing sent');
});

// ─── Offline ────────────────────────────────────────────────────────────────

test('offline before the send: nothing is sent, it is a network error (never "may have been sent"), and the next send does not wait', async () => {
    // The connection drops while the user approves: the device is offline
    // once the passkey has answered, before the paymaster is called. (The
    // chain's RPC is scripted and still answers.)
    const credentials = window.navigator.credentials;
    const realGet = credentials.get;
    Object.defineProperty(credentials, 'get', {
        configurable: true,
        writable: true,
        value: async function (...args) {
            const result = await realGet.apply(this, args);
            setOnline(false);
            return result;
        },
    });
    let error;
    try {
        error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer() }));
    } finally {
        Object.defineProperty(credentials, 'get', { configurable: true, writable: true, value: realGet });
    }
    assert.equal(signGets().length, 1, 'the user approved');
    assert.equal(error.offline, true, error.message);
    assert.equal(chain.state.sent.length, 0, 'the paymaster was not asked');
    assert.ok(!(error instanceof W.TransactionOutcomeUnknownError), error.name);
    const description = W.describeError(error);
    assert.equal(description.code, 'network');
    assert.equal(description.maybeSent, false);
    assert.equal(W.sendStatusOf(error), 'failed');

    setOnline(true);
    const started = Date.now();
    const signature = await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    assert.equal(typeof signature, 'string');
    assert.ok(Date.now() - started < 3_000, `the next send did not wait on the first (${Date.now() - started} ms)`);
    assert.equal(chain.state.sent.length, 1);
});

// ─── 3007: approval too old ─────────────────────────────────────────────────

test('3007: SignatureTooOldError, sent once, "Approval took too long"; calling it again asks for a new approval and lands', async () => {
    chain.state.paymasterScript.push(korasRefusal(3007));
    const error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer() }));
    assert.ok(error instanceof W.SignatureTooOldError, error.name);
    assert.ok(W.isSignatureTooOldError(error));
    assert.equal(error.code, 3007);
    assert.equal(chain.state.sent.length, 1, 'not resent');
    const description = W.describeError(error);
    assert.equal(description.code, 'program-3007');
    assert.equal(description.title, 'Approval took too long');
    assert.equal(description.retryable, true);
    assert.equal(description.maybeSent, false);
    assert.equal(signGets().length, 1);

    // The one-tap retry: the same call again, the slots having moved on. A
    // new approval, over a new challenge (a new slot).
    chain.state.slot += 200;
    const signature = await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    assert.equal(typeof signature, 'string');
    assert.equal(signGets().length, 2, 'one new approval, never an automatic re-sign');
    assert.notDeepEqual(
        Buffer.from(new Uint8Array(signGets()[0].options.publicKey.challenge)),
        Buffer.from(new Uint8Array(signGets()[1].options.publicKey.challenge)),
    );
});

test('a raw 3007 whose logs name another program first is not SignatureTooOldError', () => {
    const inner = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    const error = new W.PaymasterError('Transaction simulation failed', {
        code: -32002,
        data: {
            logs: [
                `Program ${chain.PROGRAM.toBase58()} invoke [1]`,
                `Program ${inner} invoke [2]`,
                `Program ${inner} failed: custom program error: 0xbbf`,
                `Program ${chain.PROGRAM.toBase58()} failed: custom program error: 0xbbf`,
            ],
        },
    });
    assert.equal(W.isSignatureTooOldError(error), false);
    assert.equal(W.isSignatureTooOldError(new W.PaymasterError('InstructionError(1, Custom(3007))')), true, 'no logs: LazorKit\'s');
});

// ─── Deterministic refusals and rate limits ─────────────────────────────────

test('a refusal that cannot change is sent once: 3008, 3009, 3024, 3025, an allowlist refusal, insufficient funds', async () => {
    const refusals = {
        3008: korasRefusal(3008),
        3009: korasRefusal(3009),
        3024: korasRefusal(3024),
        3025: korasRefusal(3025),
        allowlist: answer(200, { error: { code: -32000, message: 'Invalid transaction: Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr is not in the allowed list' } }),
        funds: answer(200, { error: { code: -32000, message: 'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit. insufficient funds' } }),
    };
    for (const [name, refusal] of Object.entries(refusals)) {
        chain.state.sent.length = 0;
        chain.state.paymasterScript.push(refusal);
        const error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer() }));
        assert.equal(chain.state.sent.length, 1, `${name}: sent once`);
        assert.equal(W.describeError(error).maybeSent, false, name);
        assert.equal(W.describeError(error).retryable, false, `${name}: not retryable`);
    }
});

test('a 429 is waited out (Retry-After) and sent again, beyond the attempts a failure gets', async () => {
    for (let i = 0; i < 3; i++) {
        chain.state.paymasterScript.push(answer(429, { error: { code: -32005, message: 'Too Many Requests' } }, { 'retry-after': '0' }));
    }
    const signature = await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    assert.equal(typeof signature, 'string');
    assert.equal(chain.state.sent.length, 4, 'three 429s (more than the three attempts a failure gets), then it went through');
    assert.equal(signGets().length, 1, 'one approval');
});
