// The session and authority keys end to end, through the built package
// (`pnpm build` first) in a browser page (jsdom, with fake-indexeddb):
// LazorkitProvider mounts, the passkey approves in the portal (a scripted
// stand-in answering the dialog's iframe), the session or authority lands,
// the page reloads, and the key the SDK kept signs a send with no passkey.
// A scripted chain and paymaster, no network. Also: what LazorkitProvider
// moves when it mounts, a key that cannot be stored after its transaction
// landed, a caller's own session key, and deleting the key once its session
// is revoked or its authority removed. Run with `pnpm test`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

// ─── A browser page ─────────────────────────────────────────────────────────

const APP = 'http://app.test/';
const PORTAL = 'http://portal.test';
const RPC = 'http://rpc.test/';
const PAYMASTER = 'http://paymaster.test/';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: APP });
const { window } = dom;
// jsdom has <dialog> but not its modal methods.
window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
};
window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
};
// Nor an iframe's `sandbox` token list.
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
// The portal dialog's debug log.
console.debug = () => {};

// ─── A scripted chain, paymaster and portal ─────────────────────────────────

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const RECIPIENT = fixed(13);
const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');

let PROGRAM; // the v2 program on devnet
/** Accounts that exist: address → { owner, data }. */
const accounts = new Map();
/** Every transaction the paymaster was asked to send. */
const sent = [];

function passkeyAuthority(W) {
    const credentialIdHash = W.getCredentialHash(CREDENTIAL_ID);
    const [authorityPda] = W.findAuthorityPda(WALLET, credentialIdHash, PROGRAM);
    // Authority (discriminator 0x22), Secp256r1, owner; counter at 8; wallet
    // at 16; credential hash at 48; compressed P-256 key at 80.
    const data = Buffer.alloc(120);
    data[0] = 0x22;
    data[1] = 1;
    data.writeUInt32LE(5, 8);
    WALLET.toBuffer().copy(data, 16);
    Buffer.from(credentialIdHash).copy(data, 48);
    data[80] = 2;
    data.fill(0x11, 81, 113);
    accounts.set(authorityPda.toBase58(), { owner: PROGRAM.toBase58(), data });
    return authorityPda;
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
        sent.push(VersionedTransaction.deserialize(Buffer.from(params.transaction, 'base64')));
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
}

globalThis.fetch = async (url, init) => {
    if (String(url) === PAYMASTER) return paymaster(init);
    throw new Error(`unexpected fetch ${url}`);
};

/**
 * The portal: answers each sign request the SDK's dialog opens, as the
 * portal's iframe would once the user approved with the passkey.
 */
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

/**
 * Loads the app afresh, as a reload does (a new copy of the package; storage
 * as it was), and mounts LazorkitProvider. The wallet is the one the last
 * page connected, rehydrated from localStorage.
 */
async function load({ keyStorage } = {}) {
    unmount();
    document.body.innerHTML = '';
    const W = await import(`../dist/index.mjs?page=${++pages}`);
    PROGRAM = W.PROGRAM_ID_DEVNET;
    const container = document.createElement('div');
    document.body.appendChild(container);
    mounted = createRoot(container);
    const props = {
        rpcUrl: RPC,
        portalUrl: PORTAL,
        paymasterConfig,
        cluster: 'devnet',
        ...(keyStorage ? { keyStorage } : {}),
    };
    mounted.render(React.createElement(W.LazorkitProvider, props));
    // Mounted once its effects have configured the store.
    await until(() => W.useWalletStore.getState().connection.rpcEndpoint === RPC, 'the provider to mount');
    // web3.js took `fetch` when it loaded: give its connection the scripted RPC.
    W.useWalletStore.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true }),
    });
    return W;
}

function unmount() {
    mounted?.unmount();
    mounted = undefined;
}
const paymasterConfig = { paymasterUrl: PAYMASTER };

/** A connected v2 wallet whose passkey authority is on chain. */
function connect(W) {
    passkeyAuthority(W);
    W.useWalletStore.setState({
        wallet: {
            credentialId: CREDENTIAL_ID,
            passkeyPubkey: [2, ...new Array(32).fill(0x11)],
            smartWallet: WALLET.toBase58(),
            vaultPda: W.findVaultPda(WALLET, PROGRAM)[0].toBase58(),
            walletDevice: '',
            platform: 'web',
            expo: '',
            protocolVersion: 2,
        },
    });
}

/** As if the transaction that created `address` had executed. */
const landed = (address) => accounts.set(address, { owner: PROGRAM.toBase58() });

beforeEach(async () => {
    unmount();
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    accounts.clear();
    sent.length = 0;
    approvals.length = 0;
    warnings.length = 0;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const transfer = () => [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: RECIPIENT, lamports: 1000 })];

/** Asserts `tx` carries a valid Ed25519 signature by `key` over its message. */
function assertSignedBy(tx, key) {
    const index = tx.message.staticAccountKeys.findIndex((k) => k.equals(key));
    assert.ok(index > 0 && index < tx.message.header.numRequiredSignatures, 'a signer, after the fee payer');
    const publicKey = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(key.toBytes()).toString('base64url') },
        format: 'jwk',
    });
    assert.ok(verify(null, tx.message.serialize(), publicKey, Buffer.from(tx.signatures[index])), 'a valid signature');
}

/** Whether the message of `tx` carries `key`'s 32 bytes (registered in an instruction's data or accounts). */
function mentions(tx, key) {
    const bytes = Buffer.from(key.toBytes());
    return (
        tx.message.staticAccountKeys.some((k) => k.equals(key)) ||
        tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data).indexOf(bytes) >= 0)
    );
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

/** No secret of the SDK's in localStorage, in any form. */
function assertNoPlaintext() {
    for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        assert.ok(!['lazorkit-session', 'lazorkit-authority'].includes(name), name);
        assert.ok(!localStorage.getItem(name).includes('secretKey'), name);
    }
}

async function until(condition, what) {
    for (let i = 0; i < 200; i++) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`timed out waiting for ${what}`);
}

// ─── createSession → reload → session send ──────────────────────────────────

test('createSession → reload → signAndSendWithSession: the key kept in IndexedDB signs after the reload, with no passkey', async () => {
    let W = await load();
    connect(W);
    const calls = [];
    const { sessionPda, sessionPublicKey } = await W.useWalletStore.getState().createSession({
        spendingLimits: { solPerTxMax: 1_000_000n },
        onSuccess: (pda, key) => calls.push(['onSuccess', pda, key]),
        onFail: (error) => calls.push(['onFail', error]),
    });
    landed(sessionPda);
    assert.deepEqual(calls, [['onSuccess', sessionPda, sessionPublicKey]]);
    assert.equal(approvals.length, 1, 'one passkey approval');
    assert.ok(mentions(sent.at(-1), new PublicKey(sessionPublicKey)), 'the create registered the generated key');

    const record = await storedRecord('session');
    assert.equal(record.publicKey, sessionPublicKey);
    assert.equal(record.info.sessionPda, sessionPda);
    assert.equal(record.info.walletPda, WALLET.toBase58());
    assert.equal(record.info.spendingLimits.solPerTxMax, '1000000');
    assert.equal(record.privateKey.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('pkcs8', record.privateKey));
    assertNoPlaintext();

    // Reload.
    W = await load();
    assert.equal(W.useWalletStore.getState().wallet.smartWallet, WALLET.toBase58(), 'the wallet rehydrated');
    const before = approvals.length;
    const signature = await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assert.equal(typeof signature, 'string');
    assert.equal(approvals.length, before, 'no passkey prompt');
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
    // And in the legacy wire format.
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer(), transactionOptions: { txVersion: 'legacy' } });
    assert.equal(sent.at(-1).version, 'legacy');
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
    assertNoPlaintext();
    assert.deepEqual(warnings, []);
});

// ─── addAuthority → reload → authority send ─────────────────────────────────

test('addAuthority → reload → signAndSendWithAuthority: the key kept in IndexedDB signs after the reload, with no passkey', async () => {
    let W = await load();
    connect(W);
    const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority();
    landed(authorityPda);
    assert.equal(approvals.length, 1);
    assert.ok(mentions(sent.at(-1), new PublicKey(authorityPublicKey)), 'the add registered the generated key');
    const record = await storedRecord('authority');
    assert.equal(record.publicKey, authorityPublicKey);
    assert.equal(record.info.authorityPda, authorityPda);
    assert.equal(record.info.role, W.ROLE_ADMIN);
    assert.equal(record.privateKey.extractable, false);
    assertNoPlaintext();

    W = await load();
    await W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
    assert.equal(approvals.length, 1, 'no passkey prompt');
    assertSignedBy(sent.at(-1), new PublicKey(authorityPublicKey));
    assertNoPlaintext();
});

// ─── LazorkitProvider moves a plaintext key when it mounts ──────────────────

test('LazorkitProvider moves the plaintext keys an earlier release left when it mounts, before any send', async () => {
    const session = Keypair.generate();
    const authority = Keypair.generate();
    const sessionPda = fixed(31).toBase58();
    const authorityPda = fixed(33).toBase58();
    localStorage.setItem(
        'lazorkit-session',
        JSON.stringify({ secretKey: Array.from(session.secretKey), publicKey: session.publicKey.toBase58(), sessionPda, walletPda: WALLET.toBase58(), expiresAt: '9' }),
    );
    localStorage.setItem(
        'lazorkit-authority',
        JSON.stringify({ secretKey: Array.from(authority.secretKey), publicKey: authority.publicKey.toBase58(), authorityPda, walletPda: WALLET.toBase58(), role: 1 }),
    );
    const W = await load();
    await until(() => !localStorage.getItem('lazorkit-session') && !localStorage.getItem('lazorkit-authority'), 'the migration');
    assertNoPlaintext();
    assert.equal((await storedRecord('session')).publicKey, session.publicKey.toBase58());
    assert.equal((await storedRecord('authority')).publicKey, authority.publicKey.toBase58());
    assert.equal(sent.length, 0);

    // And the moved key signs.
    landed(sessionPda);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), session.publicKey);
});

// ─── A key that cannot be stored after its transaction landed ───────────────

test('a key that cannot be stored once its session landed: createSession still succeeds, and the key serves this page', async () => {
    let W = await load();
    connect(W);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'keys') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
    };
    const calls = [];
    let created;
    try {
        created = await W.useWalletStore.getState().createSession({
            unrestricted: true,
            onSuccess: () => calls.push('onSuccess'),
            onFail: (error) => calls.push(error),
        });
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    landed(created.sessionPda);
    assert.deepEqual(calls, ['onSuccess'], 'a landed session is never reported as failed');
    assert.equal(W.useWalletStore.getState().error, null);
    assert.ok(warnings.some((w) => w.includes('kept for this page only')));
    assert.equal(await storedRecord('session'), undefined);
    assertNoPlaintext();

    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));

    W = await load();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});

// ─── A caller's own session key ─────────────────────────────────────────────

test("a caller's own session key is registered and never stored", async () => {
    const W = await load();
    connect(W);
    const own = Keypair.generate();
    const { sessionPublicKey } = await W.useWalletStore.getState().createSession({ sessionKey: own.publicKey, unrestricted: true });
    assert.equal(sessionPublicKey, own.publicKey.toBase58());
    assert.ok(mentions(sent.at(-1), own.publicKey));
    assert.equal(await storedRecord('session'), undefined);
    assertNoPlaintext();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});

// ─── Deleting a key once it is of no use ────────────────────────────────────

test("revokeSession deletes the kept key once its session is revoked, and leaves it when another session is", async () => {
    let W = await load();
    connect(W);
    const { sessionPda } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);

    await W.useWalletStore.getState().revokeSession({ sessionPda: fixed(41) });
    assert.ok(await storedRecord('session'), "another session's revoke leaves the key");

    W = await load();
    await W.useWalletStore.getState().revokeSession();
    assert.equal(await storedRecord('session'), undefined, 'deleted once its session is revoked');
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});

test('removeAuthority deletes the kept key once its authority is removed, and leaves it when another is', async () => {
    let W = await load();
    connect(W);
    const { authorityPda } = await W.useWalletStore.getState().addAuthority();
    landed(authorityPda);

    await W.useWalletStore.getState().removeAuthority(fixed(43).toBase58());
    assert.ok(await storedRecord('authority'));

    W = await load();
    await W.useWalletStore.getState().removeAuthority(authorityPda);
    assert.equal(await storedRecord('authority'), undefined);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
});

// ─── keyStorage: 'memory' ───────────────────────────────────────────────────

test("keyStorage='memory': the key signs on this page, nothing is stored, and it is gone after a reload", async () => {
    let W = await load({ keyStorage: 'memory' });
    connect(W);
    const { sessionPda, sessionPublicKey } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
    assert.deepEqual(await indexedDB.databases(), []);
    assertNoPlaintext();

    W = await load({ keyStorage: 'memory' });
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});
