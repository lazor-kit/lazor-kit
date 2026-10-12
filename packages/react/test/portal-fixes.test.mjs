// Portal mode and the paymaster, through the built package (`pnpm build`
// first) in a browser page (jsdom), with a scripted portal (a P-256 passkey
// that signs whatever it is handed) and the scripted devnet and paymaster:
// - the default devnet paymaster is the v2 relayer, and stays overridable;
// - a send is bounded in time (a hung relayer), is not resent once its
//   blockhash has expired, and is not made at all while offline;
// - connect after a creation whose answer was lost does not create a second
//   wallet: the same seed is used again, and the wallet it made is found;
// - an untyped Execute reads its challenge's slot after everything else,
//   right before the portal opens;
// - a dialog leaves no window listener behind, and denied storage throws
//   nowhere in portal mode.
// No network. Run with `pnpm test`.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, SystemProgram } from '@solana/web3.js';
import { PAYMASTER, RPC, scriptedChain } from './helpers/chain.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

const APP = 'http://app.test/';
const PORTAL = 'http://portal.test';
const RP_ID = 'portal.test';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: APP });
const { window } = dom;
window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
};
window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
};
Object.defineProperty(window.HTMLIFrameElement.prototype, 'sandbox', {
    get() {
        const tokens = () => (this.getAttribute('sandbox') ?? '').split(' ').filter(Boolean);
        return {
            add: (...names) => this.setAttribute('sandbox', [...new Set([...tokens(), ...names])].join(' ')),
            contains: (name) => tokens().includes(name),
        };
    },
});
for (const name of ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'MessageEvent', 'HTMLElement']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true });
}
console.debug = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const W = await import('../dist/index.mjs');
const chain = scriptedChain(W);
globalThis.fetch = (url, init) => chain.fetch(url, init);

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function passkey(label) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]), rawId: Buffer.from(label) };
}

function assertion(key, challenge) {
    const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: PORTAL, crossOrigin: false }),
    );
    const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
    const signedPayload = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
    const signature = sign('sha256', signedPayload, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    let s = BigInt('0x' + signature.subarray(32).toString('hex'));
    if (s > P256_N / 2n) s = P256_N - s;
    const lowS = Buffer.concat([signature.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]);
    return {
        normalized: lowS.toString('base64'),
        msg: signedPayload.toString('base64'),
        clientDataJSONReturn: clientDataJSON.toString('base64'),
        authenticatorDataReturn: authenticatorData.toString('base64'),
    };
}

// ─── The portal ─────────────────────────────────────────────────────────────

let key;
/** The RPC methods called so far, each time the portal was opened to sign. */
const atSign = [];
const answered = new Set();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    answered.add(iframe.src);
    const params = new URL(iframe.src).searchParams;
    const action = params.get('action');
    if (action === 'sign') atSign.push(chain.state.rpcCalls.map((c) => c.method));
    const data =
        action === 'connect'
            ? // A passkey registered just now: its own key, as the portal reports it.
              { credentialId: key.rawId.toString('base64'), publickey: key.compressed.toString('base64'), kind: 'created', connectionType: 'create' }
            : { ...assertion(key, Buffer.from(params.get('message'), 'base64')), credentialId: key.rawId.toString('base64') };
    window.dispatchEvent(
        new window.MessageEvent('message', {
            origin: PORTAL,
            source: iframe.contentWindow,
            data: { type: action === 'connect' ? 'connect-result' : 'sign-result', data },
        }),
    );
}, 5);
after(() => {
    clearInterval(portal);
    window.close();
});

let counter = 0;
beforeEach(async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    chain.reset();
    atSign.length = 0;
    await W.useWalletStore.getState().disconnect();
    localStorage.clear();
    key = passkey(`passkey ${++counter}`);
    W.createLazorkitClient(
        { mode: 'portal', portalUrl: PORTAL, rpcUrl: RPC, cluster: 'devnet', paymasterConfig: { paymasterUrl: PAYMASTER }, onConfirmWallet: 'throw' },
        { replace: true },
    );
    // web3.js's own fetch, through the scripted chain.
    W.useWalletStore.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => chain.fetch(RPC, init), disableRetryOnRateLimit: true }),
    });
});

/** The CreateWallet instructions the paymaster was asked to send: the wallet PDA each creates. */
function createdWallets() {
    return chain.state.sent.flatMap((tx) => {
        const keys = tx.message.staticAccountKeys;
        return tx.message.compiledInstructions
            .filter((ix) => keys[ix.programIdIndex].equals(chain.PROGRAM) && ix.data[0] === 0)
            .map((ix) => keys[ix.accountKeyIndexes[1]].toBase58());
    });
}
/** Wallet accounts of the program on chain. */
const walletAccounts = () => [...chain.state.accounts].filter(([, a]) => a.owner === chain.PROGRAM.toBase58() && a.data[0] === 0x21).map(([k]) => k);

// ─── The default paymaster ──────────────────────────────────────────────────

test('the default devnet paymaster is the v2 relayer; an app can still pass its own', () => {
    assert.equal(W.DEFAULTS.PAYMASTER_URL, 'https://kora-devnet-production.up.railway.app');
    assert.equal(W.resolveConfig({ mode: 'portal', cluster: 'devnet' }).paymasterConfig.paymasterUrl, W.DEFAULTS.PAYMASTER_URL);
    assert.equal(
        W.resolveConfig({ mode: 'portal', cluster: 'devnet', paymasterConfig: { paymasterUrl: 'https://my.relayer' } }).paymasterConfig.paymasterUrl,
        'https://my.relayer',
    );
    assert.equal(W.DEFAULT_CONFIG.paymasterConfig.paymasterUrl, W.DEFAULTS.PAYMASTER_URL, "the wallet adapter's default");
});

// ─── A send is bounded ──────────────────────────────────────────────────────

const SIG = '5'.repeat(88);
const tx = () => {
    const t = new W.Transaction();
    t.add(SystemProgram.transfer({ fromPubkey: chain.PROGRAM, toPubkey: chain.PROGRAM, lamports: 1 }));
    t.recentBlockhash = '11111111111111111111111111111111';
    t.feePayer = chain.PROGRAM;
    return t;
};
async function withFetch(fake, fn) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push(JSON.parse(init.body).method);
        return fake(calls.length, init);
    };
    try {
        return { result: await fn().then((v) => ({ value: v }), (e) => ({ error: e })), calls };
    } finally {
        globalThis.fetch = (url, init) => chain.fetch(url, init);
    }
}
const ok = () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { signature: SIG } }), { status: 200 });
const badGateway = () => new Response('', { status: 502 });
const hang = (_n, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

test('a relayer that never answers: the whole send ends within its budget, as "may have been sent"', async () => {
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER });
    const started = Date.now();
    const { result, calls } = await withFetch(hang, () => paymaster.signAndSend(tx(), 3, 10, { budgetMs: 1_500 }));
    const took = Date.now() - started;
    assert.ok(result.error instanceof W.PaymasterError);
    assert.equal(result.error.maybeSent, true);
    assert.match(result.error.message, /no answer within|limit was reached/);
    assert.ok(took < 3_000, `bounded (${took} ms)`);
    assert.equal(calls.length, 1, 'no second attempt that could not finish in the budget');
});

test('a lost answer is resent, the same bytes, only while the blockhash is valid', async () => {
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER });
    // Valid: the second attempt lands it.
    let { result, calls } = await withFetch((n) => (n === 1 ? badGateway() : ok()), () =>
        paymaster.signAndSend(tx(), 3, 1, { canResend: async () => true }),
    );
    assert.equal(result.value, SIG);
    assert.equal(calls.length, 2);
    // Expired after the first attempt: not sent again; it may still have been sent.
    ({ result, calls } = await withFetch(badGateway, () => paymaster.signAndSend(tx(), 3, 1, { canResend: async () => false })));
    assert.equal(calls.length, 1);
    assert.equal(result.error.maybeSent, true);
    assert.match(result.error.message, /blockhash has expired/);
    // A check that cannot be made does not stop the resend.
    ({ result, calls } = await withFetch((n) => (n === 1 ? badGateway() : ok()), () =>
        paymaster.signAndSend(tx(), 3, 1, { canResend: async () => { throw new Error('rpc down'); } }),
    ));
    assert.equal(result.value, SIG);
});

test('rate limited for longer than the budget: stops, as a rate limit (nothing sent)', async () => {
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER });
    const limited = () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
    const { result, calls } = await withFetch(limited, () => paymaster.signAndSend(tx(), 3, 50, { budgetMs: 6_000 }));
    assert.ok(calls.length > 3, `waited out beyond the 3 attempts (${calls.length})`);
    assert.equal(result.error.httpStatus, 429);
    assert.equal(result.error.maybeSent, false);
    assert.equal(W.describeError(result.error).code, 'rate-limited');
});

test('offline: no request is made, and the error says nothing was sent', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const paymaster = new W.Paymaster({ paymasterUrl: PAYMASTER });
    const { result, calls } = await withFetch(ok, () => paymaster.signAndSend(tx()));
    assert.equal(calls.length, 0);
    assert.equal(result.error.offline, true);
    assert.equal(result.error.maybeSent, false);
    assert.equal(W.describeError(result.error).code, 'network');
});

// ─── Connect does not create a second wallet ────────────────────────────────

test('connect: a creation whose answer is lost, then connect again: the same seed, one wallet', async () => {
    chain.state.mode = 'drop';
    const first = await W.useWalletStore.getState().connect().then(() => null, (e) => e);
    assert.ok(first instanceof W.TransactionOutcomeUnknownError, first?.name);
    const tried = new Set(createdWallets());
    assert.equal(tried.size, 1, 'every attempt of the first connect is the same wallet');
    chain.state.mode = null;
    const wallet = await W.useWalletStore.getState().connect();
    assert.equal(wallet.smartWallet, [...tried][0], 'the retry creates that wallet, not another');
    assert.deepEqual(walletAccounts(), [wallet.smartWallet]);
});

test('connect: the creation landed but its answer was lost: found, and connected, with one wallet', async () => {
    chain.state.mode = 'lose-answer';
    const wallet = await W.useWalletStore.getState().connect();
    assert.deepEqual(walletAccounts(), [wallet.smartWallet]);
    assert.equal(new Set(createdWallets()).size, 1);
});

test('connect: the wallet the lost creation made is found by the next connect and adopted, not offered or made again', async () => {
    chain.state.mode = 'drop';
    await W.useWalletStore.getState().connect().then(() => null, (e) => e);
    const [pending] = createdWallets();
    // It lands after all (from the first connect's bytes).
    const ix = chain.state.sent[0].message.compiledInstructions.find((i) => chain.state.sent[0].message.staticAccountKeys[i.programIdIndex].equals(chain.PROGRAM));
    const seed = Buffer.from(ix.data).subarray(1, 33);
    chain.walletFor({ rawId: key.rawId, key: { compressed: key.compressed } }, { rpId: RP_ID, seed, created: 'alone' });
    chain.state.mode = null;
    chain.state.sent.length = 0;
    // onConfirmWallet 'throw': a wallet offered to the user would throw here.
    const wallet = await W.useWalletStore.getState().connect();
    assert.equal(wallet.smartWallet, pending);
    assert.equal(chain.state.sent.length, 0, 'nothing created');
    // Adopted once: a later connect for this passkey, the wallet now known, starts over.
    assert.equal(Object.keys(localStorage).filter((k) => k.startsWith('lazorkit:pending-creation:')).length, 0);
});

// ─── The slot is read last ──────────────────────────────────────────────────

test('an untyped Execute reads the slot for its challenge last: after the preview blockhash, right before the portal opens', async () => {
    const wallet = await W.useWalletStore.getState().connect();
    chain.state.rpcCalls.length = 0;
    await W.useWalletStore.getState().signAndSendTransaction({
        instructions: [SystemProgram.transfer({ fromPubkey: new W.PublicKey(wallet.vaultPda), toPubkey: chain.PROGRAM, lamports: 1 })],
    });
    assert.equal(atSign.length, 1);
    const before = atSign[0];
    const slot = before.lastIndexOf('getSlot');
    assert.ok(slot >= 0, before.join(' '));
    assert.ok(before.lastIndexOf('getLatestBlockhash') < slot, `the preview's blockhash before the slot: ${before.join(' ')}`);
    assert.ok(!before.slice(slot + 1).includes('getProgramAccounts'), 'no wallet scan after the slot');
});

// ─── Dialogs and storage ────────────────────────────────────────────────────

test("a dialog's window 'message' listener is removed by destroy()", () => {
    const added = [];
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = function (type, listener, ...rest) {
        if (type === 'message') added.push(listener);
        return add.call(this, type, listener, ...rest);
    };
    window.removeEventListener = function (type, listener, ...rest) {
        if (type === 'message') {
            const i = added.indexOf(listener);
            if (i >= 0) added.splice(i, 1);
        }
        return remove.call(this, type, listener, ...rest);
    };
    try {
        for (let i = 0; i < 50; i++) new W.DialogManager({ portalUrl: PORTAL }).destroy();
        assert.equal(added.length, 0, 'none left after 50 dialogs');
        const open = new W.DialogManager({ portalUrl: PORTAL });
        assert.equal(added.length, 1, 'one while it lives');
        open.destroy();
        assert.equal(added.length, 0);
    } finally {
        window.addEventListener = add;
        window.removeEventListener = remove;
    }
});

test('storage denied: portal mode reads it as empty, and saving, connecting and disconnecting throw nothing', async () => {
    const denied = () => {
        throw new window.DOMException('The operation is insecure.', 'SecurityError');
    };
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => ({ getItem: denied, setItem: denied, removeItem: denied, key: denied, clear: denied, get length() { return denied(); } }),
    });
    try {
        await W.StorageManager.saveWallet({ credentialId: 'x', passkeyPubkey: [2, 1], smartWallet: chain.PROGRAM.toBase58(), walletDevice: '', platform: 'web', expo: '' });
        assert.equal(await W.StorageManager.getWallet(), null);
        await W.StorageManager.clearWallet();
        const wallet = await W.useWalletStore.getState().connect();
        assert.equal(typeof wallet.smartWallet, 'string', 'connected for this page');
        await W.useWalletStore.getState().disconnect();
        assert.equal(W.useWalletStore.getState().wallet, null, 'disconnected');
    } finally {
        Object.defineProperty(globalThis, 'localStorage', real);
    }
});
