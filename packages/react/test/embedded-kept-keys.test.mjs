// Session keys in Embedded mode, through the built package in a page on
// https://app.test with a virtual authenticator and a scripted devnet and
// paymaster: what portal mode does with a kept key holds here too. A preset
// the program would refuse, or that does not fit, is refused before the
// passkey is asked; a send its limits do not cover is `UnlistedSolOutflowError`
// (or the token one), not resent, with `errorKind` 'policy'; a send that
// loaded its key before a disconnect neither signs nor sends after it, also
// when the same wallet is connected again by then ('disconnected'); and the
// wallet-adapter's disconnect disconnects the Embedded store too, its record
// included. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { freshPage } from './helpers/fresh-page.mjs';
import { credential } from './helpers/fake-webauthn.mjs';
import { RP_ID, embeddedConfig, loadPackage, rejection, scriptedUi, setUpPage } from './helpers/embedded-page.mjs';
import { PAYMASTER, RPC } from './helpers/chain.mjs';

console.debug = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const { window, authenticator } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

const STORE = `lazorkit:embedded:${RP_ID}:store`;
const RECORD = `lazorkit:embedded:${RP_ID}:wallet`;
const korasText = (code) => `Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`;

let vault;
let wallet;
const store = () => W.useWalletStore.getState();
const client = () => W.getLazorkitClient();
const transfer = () => [SystemProgram.transfer({ fromPubkey: vault, toPubkey: Keypair.generate().publicKey, lamports: 1000 })];
const sendWithSession = (callbacks = {}) => store().signAndSendWithSession({ instructions: transfer(), ...callbacks });

/** The scripted chain as `fetch`, with `hook(method, body)` run first for the RPC and paymaster calls it names. */
function installFetch(hooks = {}) {
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const method = Array.isArray(body) ? null : body.method;
        const hook = hooks[method];
        if (hook) {
            const answer = await hook(String(url), body);
            if (answer) return answer;
        }
        return chain.fetch(url, init);
    };
}

/** Run `run` once, before the next RPC call of `method` is answered. */
function beforeNext(method, run) {
    let pending = run;
    installFetch({
        [method]: async (url) => {
            if (url !== RPC || !pending) return null;
            const once = pending;
            pending = null;
            await once();
            return null;
        },
    });
    return { get ran() { return pending === null; } };
}

/** The paymaster refuses every send with `message` (a JSON-RPC error), and counts them. */
function refuseSends(message) {
    const refused = { count: 0 };
    installFetch({
        signAndSendTransaction: async (url, body) => {
            if (url !== PAYMASTER) return null;
            refused.count++;
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message } }), { status: 200 });
        },
    });
    return refused;
}

/** Counts the transactions a kept (WebCrypto Ed25519) key signs until `restore()`; a key's 32-byte probe is not one. */
function spyKeySignatures() {
    const subtle = crypto.subtle;
    const original = subtle.sign;
    const spy = { count: 0, restore: () => delete subtle.sign };
    subtle.sign = async function (algorithm, key, data) {
        const signature = await original.call(this, algorithm, key, data);
        if ((algorithm?.name ?? algorithm) === 'Ed25519' && data.byteLength > 32) spy.count++;
        return signature;
    };
    return spy;
}

beforeEach(async () => {
    installFetch();
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
    W.useWalletStore.setState({ wallet: null, isConnecting: false, isSigning: false, error: null, step: null });
    // A connected Embedded wallet, with a session key kept for it.
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    ({ wallet, vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 1 }));
    W.createLazorkitClient(embeddedConfig({ ui: scriptedUi(), confirm: false, keyStorage: 'memory' }), { replace: true });
    await client().connect();
    await store().createSession({ spendingLimits: { solPerTxMax: 1_000_000n } });
    authenticator.clear();
    chain.state.sent.length = 0;
});

test('Embedded: the kept session key signs a send with no passkey prompt', async () => {
    const signature = await sendWithSession();
    assert.equal(typeof signature, 'string');
    assert.equal(chain.state.sent.length, 1);
    assert.equal(authenticator.calls.length, 0, 'no passkey prompt');
});

test('Embedded: createSession refuses a preset that names a mint with no limit, or does not fit, before the passkey is asked or anything is read', async () => {
    for (const spendingLimits of [
        { solPerTxMax: 1n, tokens: [{ mint: Keypair.generate().publicKey }] },
        { tokens: [] },
        { solPerTxMax: 1n, tokens: Array.from({ length: 5 }, () => ({ mint: Keypair.generate().publicKey, perTxMax: 1n, lifetimeCap: 1n })) },
    ]) {
        chain.state.rpcCalls.length = 0;
        const failures = [];
        const error = await rejection(store().createSession({ spendingLimits, onFail: (e) => failures.push(e) }));
        assert.match(error.message, /has no limit|createSession needs spendingLimits|at most 224 fit/);
        assert.deepEqual(failures, [error]);
        assert.equal(authenticator.calls.length, 0, 'no passkey prompt');
        assert.equal(chain.state.rpcCalls.length, 0, 'nothing read');
        assert.equal(chain.state.sent.length, 0, 'nothing sent');
        assert.equal(store().isSigning, false);
    }
});

test('Embedded: a session send refused for SOL its limits do not name is UnlistedSolOutflowError, not resent; errorKind is policy', async () => {
    const refused = refuseSends(korasText(3037));
    const failures = [];
    const error = await rejection(sendWithSession({ onFail: (e) => failures.push(e) }));
    assert.ok(error instanceof W.UnlistedSolOutflowError, `${error.name}: ${error.message}`);
    assert.equal(error.signer, 'session');
    assert.equal(error.cause.name, 'PaymasterError');
    assert.equal(refused.count, 1, 'the same bytes move the same assets: not sent again');
    assert.deepEqual(failures, [error]);
    assert.equal(store().error, error);
    assert.equal(client().getState().error, error);
    assert.equal(W.errorKind(error), 'policy', 'not network: the paymaster refused it for a program error');
    assert.equal(W.userMessage(error, 'send'), "This session isn't allowed to spend SOL. Nothing was spent.");
});

test('Embedded: a session send refused for a token its limits do not name is UnlistedTokenOutflowError', async () => {
    refuseSends(korasText(3038));
    const error = await rejection(sendWithSession());
    assert.ok(error instanceof W.UnlistedTokenOutflowError, `${error.name}: ${error.message}`);
    assert.equal(W.errorKind(error), 'policy');
    assert.equal(W.userMessage(error, 'send'), "This session isn't allowed to spend this token. Nothing was spent.");
});

for (const path of ['store', 'adapter']) {
    test(`Embedded: ${path === 'adapter' ? 'an adapter' : 'a store'} disconnect while a session send is being built: the key signs nothing, nothing is sent`, async () => {
        const adapter = new W.LazorkitWalletAdapter({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER }, cluster: 'devnet' });
        const disconnect = () => (path === 'adapter' ? adapter.disconnect({ keepSessionKeys: true }) : client().disconnect({ keepSessionKeys: true }));
        const spy = spyKeySignatures();
        let error;
        try {
            const hook = beforeNext('getLatestBlockhash', disconnect);
            error = await rejection(sendWithSession());
            assert.ok(hook.ran, 'the disconnect ran during the send');
        } finally {
            spy.restore();
        }
        assert.ok(W.isKeyWalletMismatchError(error), String(error));
        assert.equal(error.reason, 'no-wallet');
        assert.equal(spy.count, 0, 'the key signed nothing');
        assert.equal(chain.state.sent.length, 0, 'nothing sent');
        assert.equal(store().wallet, null, 'the store is disconnected');
        assert.equal(store().isSigning, false);
        assert.equal(W.errorKind(error), 'key-mismatch');
        assert.equal(W.userMessage(error, 'send'), 'No wallet is connected. Nothing was sent; connect and send again.');
    });
}

for (const path of ['store', 'adapter']) {
    test(`Embedded: ${path === 'adapter' ? 'an adapter' : 'a store'} disconnect and a connect of the same wallet again while a session send is being built: refused ('disconnected'), and the next send signs`, async () => {
        const adapter = new W.LazorkitWalletAdapter({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER }, cluster: 'devnet' });
        const disconnect = () => (path === 'adapter' ? adapter.disconnect({ keepSessionKeys: true }) : client().disconnect({ keepSessionKeys: true }));
        const spy = spyKeySignatures();
        let error;
        try {
            beforeNext('getLatestBlockhash', async () => {
                await disconnect();
                await client().connect();
            });
            error = await rejection(sendWithSession());
        } finally {
            spy.restore();
        }
        assert.ok(W.isKeyWalletMismatchError(error), String(error));
        assert.equal(error.reason, 'disconnected');
        assert.equal(error.keyWallet, wallet.toBase58());
        assert.equal(error.connectedWallet, wallet.toBase58());
        assert.equal(spy.count, 0, 'the key signed nothing');
        assert.equal(chain.state.sent.length, 0, 'nothing sent');
        assert.equal(W.userMessage(error, 'send'), 'The wallet was disconnected during this send. Nothing was sent; send it again.');

        installFetch();
        await sendWithSession();
        assert.equal(chain.state.sent.length, 1, 'a send started after the reconnect signs and is sent');
    });
}

test("Embedded: the adapter's disconnect disconnects the store, and its record: a connect asks for the passkey again", async () => {
    assert.ok(localStorage.getItem(RECORD), 'connected: the record is there');
    const adapter = new W.LazorkitWalletAdapter({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER }, cluster: 'devnet' });
    await adapter.disconnect({ keepSessionKeys: true });
    assert.equal(client().getState().status, 'disconnected');
    assert.equal(store().wallet, null);
    assert.equal(localStorage.getItem(RECORD), null, 'the Embedded record is cleared');
    assert.equal(JSON.parse(localStorage.getItem(STORE)).state.wallet, null);
    // Kept, and refused while disconnected.
    const refused = await rejection(sendWithSession());
    assert.ok(W.isKeyWalletMismatchError(refused), String(refused));
    assert.equal(refused.reason, 'no-wallet');
    assert.equal(W.userMessage(refused, 'send'), 'No wallet is connected. Nothing was sent; connect and send again.', 'not "another wallet": the user signed out');
    assert.equal(chain.state.sent.length, 0);

    // Not restored without the passkey: connect asks for it.
    const connected = await client().connect();
    assert.equal(connected.smartWallet, wallet.toBase58());
    assert.ok(authenticator.calls.some((c) => c.kind === 'get'), 'the passkey was asked');
    await sendWithSession();
    assert.equal(chain.state.sent.length, 1, 'the kept key signs for its wallet again');
});

