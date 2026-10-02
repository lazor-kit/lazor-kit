// A 'v1' session or authority send signed by the key the SDK keeps (3.3.0),
// through the built package (`pnpm build` first) in a browser page (jsdom,
// with fake-indexeddb), against a scripted chain and paymaster that accepts
// v1, with no network:
// - in the default tier the v1 signature is made by crypto.subtle with the
//   stored non-extractable Ed25519 key, over exactly the v1 message: no
//   secret bytes are read;
// - the sealed tier (no WebCrypto Ed25519) and the memory tier sign v1 too;
// - a v1 send goes through the wallet binding as a v0 send does: refused
//   before anything is read for another wallet, and refused at signing when
//   the wallet disconnects or switches while the send is being built.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

// ─── A browser page ─────────────────────────────────────────────────────────

const APP = 'http://app.test/';
const PORTAL = 'http://portal.test';
const RPC = 'http://rpc.test/';
const PAYMASTER = 'http://paymaster.test/';

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
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');

const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));
console.debug = () => {};

// ─── A scripted chain, a v1 paymaster and the portal ────────────────────────

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const OTHER_WALLET = fixed(12);
const RECIPIENT = fixed(13);
const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');

let PROGRAM;
const accounts = new Map();
/** Every transaction the paymaster was asked to send: its wire bytes. */
const sent = [];
/** Every RPC method called, in order. */
const rpcCalls = [];
/** Runs when the v1 limits are simulated: the send has been built, and is not signed yet. */
let onSimulate = null;

function passkeyAuthority(W, wallet = WALLET) {
    const credentialIdHash = W.getCredentialHash(CREDENTIAL_ID);
    const [authorityPda] = W.findAuthorityPda(wallet, credentialIdHash, PROGRAM);
    const data = Buffer.alloc(120);
    data[0] = 0x22;
    data[1] = 1;
    data.writeUInt32LE(5, 8);
    wallet.toBuffer().copy(data, 16);
    Buffer.from(credentialIdHash).copy(data, 48);
    data[80] = 2;
    data.fill(0x11, 81, 113);
    accounts.set(authorityPda.toBase58(), { owner: PROGRAM.toBase58(), data });
}

const account = ({ owner, data = Buffer.alloc(0) }) => ({
    data: [data.toString('base64'), 'base64'],
    executable: false,
    lamports: 2_000_000,
    owner,
    rentEpoch: 0,
    space: data.length,
});

async function rpc(init) {
    const { id, method, params } = JSON.parse(init.body);
    rpcCalls.push(method);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    switch (method) {
        case 'getLatestBlockhash':
            return reply({ context: { slot: 5000 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
        case 'getSlot':
            return reply(1000);
        case 'getAccountInfo': {
            const found = accounts.get(params[0]);
            return reply({ context: { slot: 5000 }, value: found ? account(found) : null });
        }
        case 'getMultipleAccounts':
            return reply({ context: { slot: 5000 }, value: params[0].map((a) => (accounts.has(a) ? account(accounts.get(a)) : null)) });
        case 'getProgramAccounts':
            return reply(
                [...accounts]
                    .filter(([, a]) => a.owner === PROGRAM.toBase58() && a.data?.length >= 113 && a.data[0] === 0x22 && a.data[1] === 1)
                    .map(([pubkey, a]) => ({ pubkey, account: account(a) })),
            );
        case 'simulateTransaction': {
            await onSimulate?.();
            return reply({ context: { slot: 5000 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 7_300, loadedAccountsDataSize: 161_000 } });
        }
        case 'getSignatureStatuses':
            return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 1001, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
        default:
            throw new Error(`unscripted RPC ${method}`);
    }
}

async function paymaster(init) {
    const { id, method, params } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: FEE_PAYER.toBase58() } });
    if (method === 'signAndSendTransaction') {
        sent.push(new Uint8Array(Buffer.from(params.transaction, 'base64')));
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
}

globalThis.fetch = async (url, init) => {
    if (String(url) === PAYMASTER) return paymaster(init);
    if (String(url) === RPC) return rpc(init);
    throw new Error(`unexpected fetch ${url}`);
};

const approvals = [];
const answered = new Set();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    const url = new URL(iframe.src);
    if (url.searchParams.get('action') !== 'sign') return;
    answered.add(iframe.src);
    const challenge = url.searchParams.get('message');
    approvals.push(challenge);
    const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge, origin: PORTAL });
    window.dispatchEvent(
        new window.MessageEvent('message', {
            origin: PORTAL,
            source: iframe.contentWindow,
            data: {
                type: 'sign-result',
                data: {
                    normalized: Buffer.alloc(64, 1).toString('base64'),
                    clientDataJSONReturn: Buffer.from(clientDataJSON).toString('base64'),
                    authenticatorDataReturn: Buffer.alloc(37, 2).toString('base64'),
                },
            },
        }),
    );
}, 5);
after(() => {
    clearInterval(portal);
    unmount();
    window.close();
});

// ─── Pages ──────────────────────────────────────────────────────────────────

let pages = 0;
let mounted;

/** Loads the app afresh, as a reload does, with a paymaster that declares v1. */
async function load({ keyStorage } = {}) {
    unmount();
    document.body.innerHTML = '';
    const W = await import(`../dist/index.mjs?txv1-page=${++pages}`);
    PROGRAM = W.PROGRAM_ID_DEVNET;
    const container = document.createElement('div');
    document.body.appendChild(container);
    mounted = createRoot(container);
    const props = {
        rpcUrl: RPC,
        portalUrl: PORTAL,
        paymasterConfig: { paymasterUrl: PAYMASTER, acceptsTxV1: true },
        cluster: 'devnet',
        ...(keyStorage ? { keyStorage } : {}),
    };
    mounted.render(React.createElement(W.LazorkitProvider, props));
    await until(() => W.useWalletStore.getState().connection.rpcEndpoint === RPC, 'the provider to mount');
    W.useWalletStore.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true }),
    });
    return W;
}

function unmount() {
    mounted?.unmount();
    mounted = undefined;
}

function walletInfo(W, wallet) {
    return {
        credentialId: CREDENTIAL_ID,
        passkeyPubkey: [2, ...new Array(32).fill(0x11)],
        smartWallet: wallet.toBase58(),
        vaultPda: W.findVaultPda(wallet, PROGRAM)[0].toBase58(),
        walletDevice: '',
        platform: 'web',
        expo: '',
        protocolVersion: 2,
    };
}

function connect(W, wallet = WALLET) {
    passkeyAuthority(W, wallet);
    W.useWalletStore.setState({ wallet: walletInfo(W, wallet) });
}

const landed = (address) => accounts.set(address, { owner: PROGRAM.toBase58() });

beforeEach(async () => {
    unmount();
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    accounts.clear();
    sent.length = 0;
    rpcCalls.length = 0;
    approvals.length = 0;
    warnings.length = 0;
    onSimulate = null;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const transfer = () => [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: RECIPIENT, lamports: 1000 })];
const V1 = { transactionOptions: { txVersion: 'v1' } };

/**
 * A v1 wire's parts: its signer addresses, its message (everything before
 * the signatures, which come last in v1) and each signer's signature.
 */
function v1Parts(wire) {
    assert.equal(wire[0], 0x81, 'a v1 transaction');
    const signers = wire[1];
    const messageLength = wire.length - 64 * signers;
    const keys = Array.from({ length: signers }, (_, i) => new PublicKey(wire.subarray(42 + 32 * i, 74 + 32 * i)));
    const signatures = Array.from({ length: signers }, (_, i) => wire.subarray(messageLength + 64 * i, messageLength + 64 * (i + 1)));
    return { keys, message: wire.subarray(0, messageLength), signatures };
}

/** The v1 `wire` carries a valid Ed25519 signature by `key` over its message, and leaves the fee payer's slot empty. */
function assertV1SignedBy(wire, key) {
    const { keys, message, signatures } = v1Parts(wire);
    assert.ok(keys[0].equals(FEE_PAYER), 'the fee payer is signer 0');
    assert.ok(signatures[0].every((b) => b === 0), "the fee payer's slot is the paymaster's");
    const index = keys.findIndex((k) => k.equals(key));
    assert.ok(index > 0, 'the kept key is a signer');
    const publicKey = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(key.toBytes()).toString('base64url') },
        format: 'jwk',
    });
    assert.ok(verify(null, message, publicKey, Buffer.from(signatures[index])), 'a valid Ed25519 signature over the v1 message');
    return { message, signature: signatures[index] };
}

/** Records every crypto.subtle.sign call: the key's algorithm and extractability, the bytes signed and the signature. */
function spySubtleSign() {
    const subtle = crypto.subtle;
    const original = subtle.sign;
    const calls = [];
    subtle.sign = async function (algorithm, key, data) {
        const signature = new Uint8Array(await original.call(this, algorithm, key, data));
        calls.push({
            algorithm: typeof algorithm === 'string' ? algorithm : algorithm?.name,
            extractable: key.extractable,
            data: new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data),
            signature,
        });
        return signature.buffer;
    };
    return { calls, restore: () => delete subtle.sign };
}

/** This "browser" has no WebCrypto Ed25519 (iOS 16, Chrome 136), until the returned undo. */
function withoutEd25519() {
    const subtle = crypto.subtle;
    const isEd25519 = (algorithm) => (typeof algorithm === 'string' ? algorithm : algorithm?.name) === 'Ed25519';
    const notSupported = () => Promise.reject(new DOMException('Unrecognized algorithm name', 'NotSupportedError'));
    for (const method of ['generateKey', 'importKey']) {
        const original = subtle[method];
        subtle[method] = function (...args) {
            return isEd25519(method === 'importKey' ? args[2] : args[0]) ? notSupported() : original.apply(this, args);
        };
    }
    return () => {
        delete subtle.generateKey;
        delete subtle.importKey;
    };
}

async function storedRecord(slot) {
    if (!(await indexedDB.databases()).some((d) => d.name === 'lazorkit-keys')) return undefined;
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('lazorkit-keys');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction(['keys']).objectStore('keys').get(slot);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('resolved');
}

async function until(condition, what) {
    for (let i = 0; i < 200; i++) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`timed out waiting for ${what}`);
}

/** A session (or authority) created on this page, landed, and the page reloaded: the kept key is what signs. */
async function keptKey(kind, options) {
    let W = await load(options);
    connect(W);
    let publicKey;
    if (kind === 'session') {
        const { sessionPda, sessionPublicKey } = await W.useWalletStore.getState().createSession({ unrestricted: true });
        landed(sessionPda);
        publicKey = new PublicKey(sessionPublicKey);
    } else {
        const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
        landed(authorityPda);
        publicKey = new PublicKey(authorityPublicKey);
    }
    W = await load(options);
    return { W, publicKey };
}

const send = (W, kind, extra = V1) =>
    kind === 'session'
        ? W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer(), ...extra })
        : W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer(), ...extra });

// ─── The default tier: a non-extractable WebCrypto key signs the v1 message ──

for (const kind of ['session', 'authority']) {
    test(`${kind}: a 'v1' send is signed by the kept non-extractable WebCrypto key itself, over the v1 message`, async () => {
        const { W, publicKey } = await keptKey(kind);
        const record = await storedRecord(kind);
        assert.equal(record.publicKey, publicKey.toBase58());
        assert.equal(record.privateKey.algorithm.name, 'Ed25519');
        assert.equal(record.privateKey.extractable, false, 'no secret bytes to read');
        assert.equal(record.seed, undefined);

        const spy = spySubtleSign();
        let wire;
        try {
            const before = approvals.length;
            await send(W, kind);
            assert.equal(approvals.length, before, 'no passkey prompt');
            wire = sent.at(-1);
        } finally {
            spy.restore();
        }
        const { message, signature } = assertV1SignedBy(wire, publicKey);
        // The signature in the transaction is the one crypto.subtle made with
        // the stored non-extractable key, over exactly the v1 message.
        const ed25519 = spy.calls.filter((call) => call.algorithm === 'Ed25519');
        assert.equal(ed25519.length, 1, 'one Ed25519 signature');
        assert.equal(ed25519[0].extractable, false);
        assert.deepEqual(ed25519[0].data, new Uint8Array(message));
        assert.deepEqual(ed25519[0].signature, new Uint8Array(signature));
        // v1 limits from the one simulation; the RPC calls of a v1 send.
        assert.ok(rpcCalls.includes('simulateTransaction'));
        assert.deepEqual(warnings, []);

        // The same key still signs v0 as before.
        await send(W, kind, {});
        assert.notEqual(sent.at(-1)[0], 0x81);
    });
}

// ─── The other tiers ────────────────────────────────────────────────────────

test("no WebCrypto Ed25519 (the sealed tier): a 'v1' session send is signed with the sealed seed", async () => {
    const restore = withoutEd25519();
    try {
        const { W, publicKey } = await keptKey('session');
        const record = await storedRecord('session');
        assert.equal(record.privateKey, undefined, 'no Ed25519 CryptoKey in this browser');
        assert.ok(record.sealed, 'the seed is sealed');
        await send(W, 'session');
        assertV1SignedBy(sent.at(-1), publicKey);
    } finally {
        restore();
    }
});

test("keyStorage='memory', without WebCrypto Ed25519 (a Keypair in this page's memory): a 'v1' authority send signs", async () => {
    const restore = withoutEd25519();
    try {
        const W = await load({ keyStorage: 'memory' });
        connect(W);
        const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
        landed(authorityPda);
        await send(W, 'authority');
        assertV1SignedBy(sent.at(-1), new PublicKey(authorityPublicKey));
        assert.deepEqual(await indexedDB.databases(), []);
    } finally {
        restore();
    }
});

// ─── The wallet binding holds for v1 ────────────────────────────────────────

for (const kind of ['session', 'authority']) {
    test(`${kind}: a 'v1' send for another wallet is refused before anything is built, simulated or sent`, async () => {
        const { W } = await keptKey(kind);
        connect(W, OTHER_WALLET);
        const sends = sent.length;
        rpcCalls.length = 0;
        const error = await rejection(send(W, kind));
        assert.equal(error.name, 'KeyWalletMismatchError');
        assert.equal(error.reason, 'other-wallet');
        assert.equal(sent.length, sends, 'nothing sent');
        assert.ok(!rpcCalls.includes('simulateTransaction'), 'nothing simulated');
        assert.ok(!rpcCalls.includes('getLatestBlockhash'), 'nothing built');
    });

    test(`${kind}: a wallet that disconnects or switches while a 'v1' send is being built stops it at signing`, async () => {
        const { W } = await keptKey(kind);
        for (const [change, reason] of [
            [() => W.useWalletStore.setState({ wallet: null }), 'no-wallet'],
            [() => W.useWalletStore.setState({ wallet: walletInfo(W, OTHER_WALLET) }), 'other-wallet'],
        ]) {
            connect(W);
            const sends = sent.length;
            const spy = spySubtleSign();
            let error;
            try {
                // The send is built and simulated for its limits; the wallet changes before the key signs.
                onSimulate = change;
                error = await rejection(send(W, kind));
            } finally {
                onSimulate = null;
                spy.restore();
            }
            assert.equal(error.name, 'KeyWalletMismatchError', error.message);
            assert.equal(error.reason, reason);
            assert.equal(error.keyWallet, WALLET.toBase58());
            assert.equal(spy.calls.filter((call) => call.algorithm === 'Ed25519').length, 0, 'the key signed nothing');
            assert.equal(sent.length, sends, 'nothing sent');
        }
    });
}
