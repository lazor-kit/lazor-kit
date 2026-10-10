// The session and authority keys end to end, through the built package
// (`pnpm build` first) in a browser page (jsdom, with fake-indexeddb):
// LazorkitProvider mounts, the passkey approves in the portal (a scripted
// stand-in answering the dialog's iframe), the session or authority lands,
// the page reloads, and the key the SDK kept signs a send with no passkey.
// A scripted chain and paymaster, no network. Also: what LazorkitProvider
// moves when it mounts, a key that cannot be stored after its transaction
// landed (stored on a later use), a caller's own session key, deleting the
// key once its session is revoked or its authority removed, forgetStoredKeys
// at sign-out, and a kept key across disconnect and connect: the session key
// deleted (or kept with keepSessionKeys), the authority key kept, and either
// refused unless its own wallet is connected. A session or authority that
// lands after the sign-out keeps no key, a key stored later is not written
// back once deleted, a stored record that names another wallet is not
// trusted, and addAuthority's role is checked before anything is read. The
// wallet-adapter's and the Wallet Standard's disconnect delete the session key
// as the store's does, and disconnect the store. A disconnect, whichever way
// it came, while a kept-key send is in flight stops that send before its key
// signs, before what it signed is sent, and before a retry. Run with
// `pnpm test`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { freshPage } from './helpers/fresh-page.mjs';

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

/** RPC and paymaster requests made, of any kind. */
let requests = 0;
/** Runs inside the next `getLatestBlockhash`, before it is answered; then cleared. */
let onBlockhash = null;

/** The Clock sysvar: the cluster clock a session's expiry is measured against. */
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
/** 2026-10-10 12:00 UTC, in Unix seconds. */
const CLUSTER_TIME = 1_791_633_600n;
function clockAccount() {
    const data = Buffer.alloc(40);
    data.writeBigUInt64LE(5000n, 0);
    data.writeBigInt64LE(CLUSTER_TIME, 32);
    return { owner: 'Sysvar1111111111111111111111111111111111111', data };
}

async function rpc(init) {
    requests++;
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    switch (method) {
        case 'getLatestBlockhash': {
            // Once: a send that loaded its kept key builds its transaction now.
            const run = onBlockhash;
            onBlockhash = null;
            await run?.();
            return reply({ context: { slot: 5000 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
        }
        case 'getSlot':
            return reply(1000);
        case 'getAccountInfo': {
            const found = params[0] === CLOCK_SYSVAR ? clockAccount() : accounts.get(params[0]);
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
    requests++;
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
/** When set, the length the portal's clientDataJSON is padded to (with a key of its own). */
let clientDataBytes;
const answered = new Set();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    const url = new URL(iframe.src);
    if (url.searchParams.get('action') !== 'sign') return;
    answered.add(iframe.src);
    const challenge = url.searchParams.get('message');
    approvals.push(challenge);
    let clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge, origin: PORTAL });
    if (clientDataBytes) {
        // `,"pad":"` and the closing quote are 9 bytes.
        clientDataJSON = clientDataJSON.replace(/}$/, `,"pad":"${'x'.repeat(clientDataBytes - clientDataJSON.length - 9)}"}`);
    }
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

let mounted;

/**
 * Loads the app afresh, as a reload does (a new copy of the package; storage
 * as it was), and mounts LazorkitProvider. The wallet is the one the last
 * page connected, rehydrated from localStorage.
 */
async function load({ keyStorage } = {}) {
    unmount();
    document.body.innerHTML = '';
    const W = await freshPage();
    PROGRAM = W.PROGRAM_ID_DEVNET;
    const container = document.createElement('div');
    document.body.appendChild(container);
    mounted = createRoot(container);
    const props = {
        mode: 'portal',
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
    clientDataBytes = undefined;
    warnings.length = 0;
    onBlockhash = null;
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

test('createSession with token limits registers a SOL action and one for each mint, and the record keeps them', async () => {
    const W = await load();
    connect(W);
    const USDC = fixed(21);
    const BONK = fixed(22);
    const { sessionPda } = await W.useWalletStore.getState().createSession({
        spendingLimits: {
            solPerTxMax: 5_000n,
            tokens: [
                { mint: USDC, lifetimeCap: 50_000_000n, perTxMax: 1_000_000n },
                { mint: BONK.toBase58(), recurring: { limit: 10n, windowSeconds: 86_400n } },
            ],
        },
    });
    assert.equal(approvals.length, 1, 'one passkey approval');
    // The CreateSession instruction carries the actions as [len u16 LE][buffer].
    const actions = W.serializeActions([
        W.Actions.solMaxPerTx(5_000n),
        W.Actions.tokenLimit({ mint: USDC, remaining: 50_000_000n }),
        W.Actions.tokenMaxPerTx({ mint: USDC, max: 1_000_000n }),
        W.Actions.tokenRecurringLimit({ mint: BONK, limit: 10n, windowSeconds: 86_400n }),
    ]);
    const length = Buffer.alloc(2);
    length.writeUInt16LE(actions.length);
    const carried = Buffer.concat([length, Buffer.from(actions)]);
    const create = sent.at(-1).message.compiledInstructions.filter((ix) => Buffer.from(ix.data).indexOf(carried) >= 0);
    assert.equal(create.length, 1, 'the create carries exactly these actions');

    const record = await storedRecord('session');
    assert.equal(record.info.sessionPda, sessionPda);
    assert.equal(record.info.spendingLimits.solPerTxMax, '5000');
    assert.deepEqual(record.info.spendingLimits.tokens, [
        { mint: USDC.toBase58(), lifetimeCap: '50000000', perTxMax: '1000000', recurring: undefined },
        { mint: BONK.toBase58(), lifetimeCap: undefined, perTxMax: undefined, recurring: { limit: '10', windowSeconds: '86400' } },
    ]);
});

test("the largest limits createSession takes fit its transaction with a clientDataJSON of 320 bytes, and fill it at 321", async () => {
    const W = await load();
    connect(W);
    // @lazorkit/sdk-legacy sizes the clientDataJSON at 320 bytes (a cross-origin
    // frame's topOrigin and the key Chrome adds at random included); one more
    // byte fills the transaction exactly.
    clientDataBytes = 321;
    await W.useWalletStore.getState().createSession({
        // 223 bytes of actions, the most a preset makes within 224: solPerTxMax (19) and four perTxMax (51 each).
        spendingLimits: {
            solPerTxMax: 1n,
            tokens: [21, 22, 23, 24].map((b) => ({ mint: fixed(b), perTxMax: 1n })),
        },
    });
    assert.equal(approvals.length, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].serialize().length, 1232, 'the most a transaction holds');
});

// ─── addAuthority → reload → authority send ─────────────────────────────────

test('addAuthority → reload → signAndSendWithAuthority: the key kept in IndexedDB signs after the reload, with no passkey', async () => {
    let W = await load();
    connect(W);
    const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
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
    // The PDAs 3.2 wrote: the session's and the authority's for WALLET and their key.
    const P = await import('../dist/index.mjs?pdas');
    const sessionPda = P.findSessionPda(WALLET, session.publicKey.toBytes(), P.PROGRAM_ID_DEVNET)[0].toBase58();
    const authorityPda = P.findAuthorityPda(WALLET, authority.publicKey.toBytes(), P.PROGRAM_ID_DEVNET)[0].toBase58();
    localStorage.setItem(
        'lazorkit-session',
        JSON.stringify({ secretKey: Array.from(session.secretKey), publicKey: session.publicKey.toBase58(), sessionPda, walletPda: WALLET.toBase58(), expiresAt: '900000' }),
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

    // And the moved key signs, for its own wallet: bound to it on this first use.
    landed(sessionPda);
    connect(W);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), session.publicKey);
    assert.equal((await storedRecord('session')).info.bound, true);
});

// ─── A key that cannot be stored after its transaction landed ───────────────

test('a key that cannot be stored once its session landed: createSession still succeeds, the key serves this page, and is stored on a later use', async () => {
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
    assert.ok(warnings.some((w) => w.includes('could not be stored yet')), JSON.stringify(warnings));
    assert.equal(await storedRecord('session'), undefined);
    assertNoPlaintext();

    // IndexedDB works again: the next use signs, and stores the key.
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));
    const record = await storedRecord('session');
    assert.equal(record.publicKey, created.sessionPublicKey);
    assert.equal(record.privateKey.extractable, false);

    W = await load();
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));
    assertNoPlaintext();
});

test('a stored-later key does not replace a newer one another tab stored meanwhile', async () => {
    const W = await load();
    connect(W);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'keys') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
    };
    let older;
    try {
        older = await W.useWalletStore.getState().createSession({ unrestricted: true });
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    landed(older.sessionPda);
    // Another tab creates a session now, and stores its key.
    const other = await load();
    connect(other);
    const newer = await other.useWalletStore.getState().createSession({ unrestricted: true });
    landed(newer.sessionPda);
    assert.equal((await storedRecord('session')).publicKey, newer.sessionPublicKey);

    // The first tab's next use: its own key signs, and the newer one stays stored.
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(older.sessionPublicKey));
    assert.equal((await storedRecord('session')).publicKey, newer.sessionPublicKey);
});

test('an IndexedDB that cannot hold the key (DataCloneError): createSession succeeds, the key serves this page only', async () => {
    let W = await load();
    connect(W);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'keys') throw new DOMException('CryptoKey object could not be cloned.', 'DataCloneError');
        return put.apply(this, args);
    };
    try {
        const created = await W.useWalletStore.getState().createSession({ unrestricted: true });
        landed(created.sessionPda);
        assert.ok(warnings.some((w) => w.includes('kept for this page only')), JSON.stringify(warnings));
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));
        assert.equal(warnings.filter((w) => w.includes('session key')).length, 1, 'not retried on every use');
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    W = await load();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});

// ─── Sign-out ───────────────────────────────────────────────────────────────

test('forgetStoredKeys at sign-out: no session or authority key is left, here or after a reload', async () => {
    let W = await load();
    connect(W);
    const session = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(session.sessionPda);
    const authority = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    landed(authority.authorityPda);
    assert.ok(await storedRecord('session'));
    assert.ok(await storedRecord('authority'));

    // What an app did with 3.2: remove the localStorage entries, and disconnect. The keys are in IndexedDB now.
    localStorage.removeItem('lazorkit-session');
    localStorage.removeItem('lazorkit-authority');
    await W.useWalletStore.getState().disconnect();
    assert.equal(await storedRecord('session'), undefined, 'disconnect deletes the session key');
    assert.ok(await storedRecord('authority'), 'and keeps the authority key');

    await W.forgetStoredKeys();
    assert.equal(await storedRecord('session'), undefined);
    assert.equal(await storedRecord('authority'), undefined);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);

    W = await load();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
    assertNoPlaintext();
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

test("revokeSession() refuses another wallet's kept session before the passkey is read or prompted", async () => {
    const W = await load();
    connect(W);
    const { sessionPda } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);
    const own = W.useWalletStore.getState().wallet;
    // Another wallet is connected now (its passkey is not even on chain).
    W.useWalletStore.setState({ wallet: { ...own, smartWallet: fixed(45).toBase58(), vaultPda: undefined } });
    const prompts = approvals.length;
    const sends = sent.length;
    const calls = [];
    const error = await rejection(W.useWalletStore.getState().revokeSession({ onFail: (e) => calls.push(e) }));
    assert.ok(W.isKeyWalletMismatchError(error), String(error));
    assert.equal(error.reason, 'other-wallet');
    assert.deepEqual(calls, [error]);
    assert.equal(approvals.length, prompts, 'no passkey prompt');
    assert.equal(sent.length, sends);
    assert.ok(await storedRecord('session'), 'the key stays');

    // Its own wallet again: revoked, and the key deleted.
    W.useWalletStore.setState({ wallet: own });
    await W.useWalletStore.getState().revokeSession();
    assert.equal(approvals.length, prompts + 1);
    assert.equal(await storedRecord('session'), undefined);
});

test('removeAuthority deletes the kept key once its authority is removed, and leaves it when another is', async () => {
    let W = await load();
    connect(W);
    const { authorityPda } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    landed(authorityPda);

    await W.useWalletStore.getState().removeAuthority(fixed(43).toBase58());
    assert.ok(await storedRecord('authority'));

    W = await load();
    await W.useWalletStore.getState().removeAuthority(authorityPda);
    assert.equal(await storedRecord('authority'), undefined);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
});

// ─── Disconnect, and connecting again ────────────────────────────────────────

const OTHER_WALLET = fixed(47);

/** The stored record of `walletPda`, as connect saves it. */
function walletRecord(W, walletPda) {
    return {
        credentialId: CREDENTIAL_ID,
        passkeyPubkey: [2, ...new Array(32).fill(0x11)],
        smartWallet: walletPda.toBase58(),
        vaultPda: W.findVaultPda(walletPda, PROGRAM)[0].toBase58(),
        walletDevice: '',
        platform: 'web',
        expo: '',
        protocolVersion: 2,
    };
}

/** Connects `walletPda` through `connect()`, as when the portal has found it and saved it. */
async function reconnect(W, walletPda) {
    await W.StorageManager.saveWallet(walletRecord(W, walletPda));
    const connected = await W.useWalletStore.getState().connect();
    assert.equal(connected.smartWallet, walletPda.toBase58());
}

/** A send with the kept key that must be refused for `reason`, with nothing prompted, signed or sent. */
async function assertRefused(W, send, reason) {
    const prompts = approvals.length;
    const sends = sent.length;
    const calls = [];
    const error = await rejection(
        W.useWalletStore.getState()[send]({ instructions: transfer(), onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) }),
    );
    assert.ok(W.isKeyWalletMismatchError(error), String(error));
    assert.equal(error.reason, reason);
    assert.deepEqual(calls, [error]);
    assert.equal(W.useWalletStore.getState().isSigning, false);
    assert.equal(approvals.length, prompts, 'no passkey prompt');
    assert.equal(sent.length, sends, 'nothing sent');
}

test('createSession → disconnect → connect again: disconnect deleted the session key, so there is none to sign with', async () => {
    let W = await load();
    connect(W);
    const { sessionPda } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);
    assert.ok(await storedRecord('session'));

    const calls = [];
    await W.useWalletStore.getState().disconnect({ onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) });
    assert.deepEqual(calls, ['onSuccess']);
    assert.equal(W.useWalletStore.getState().wallet, null);
    assert.equal(await storedRecord('session'), undefined, 'deleted from IndexedDB');
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /^Error: No session key found\. Create a session first\.$/);

    W = await load();
    await reconnect(W, WALLET);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /^Error: No session key found\. Create a session first\.$/);
    assert.equal(sent.length, 1, 'only the createSession');
    assertNoPlaintext();
});

test('createSession → disconnect({ keepSessionKeys: true }) → connect again: refused while disconnected and for another wallet, signs for its own', async () => {
    let W = await load();
    connect(W);
    const { sessionPda, sessionPublicKey } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);

    await W.useWalletStore.getState().disconnect({ keepSessionKeys: true });
    assert.equal((await storedRecord('session')).publicKey, sessionPublicKey, 'kept');
    await assertRefused(W, 'signAndSendWithSession', 'no-wallet');

    W = await load();
    await assertRefused(W, 'signAndSendWithSession', 'no-wallet');
    await reconnect(W, OTHER_WALLET);
    await assertRefused(W, 'signAndSendWithSession', 'other-wallet');
    await W.useWalletStore.getState().disconnect({ keepSessionKeys: true });

    await reconnect(W, WALLET);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
    assertNoPlaintext();
});

test('disconnect deletes the kept session key whichever wallet it belongs to: one kept for another wallet goes too', async () => {
    const W = await load();
    connect(W);
    const { sessionPda } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);
    await W.useWalletStore.getState().disconnect({ keepSessionKeys: true });
    assert.equal((await storedRecord('session')).info.walletPda, WALLET.toBase58(), 'kept');

    await reconnect(W, OTHER_WALLET);
    await W.useWalletStore.getState().disconnect();
    assert.equal(await storedRecord('session'), undefined, "WALLET's key, deleted by OTHER_WALLET's disconnect");
    await reconnect(W, WALLET);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
});

test('addAuthority → disconnect → connect again: the authority key is kept, refused while disconnected and for another wallet, and signs for its own', async () => {
    let W = await load();
    connect(W);
    const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    landed(authorityPda);

    await W.useWalletStore.getState().disconnect();
    assert.equal((await storedRecord('authority')).publicKey, authorityPublicKey, 'disconnect keeps the authority key');
    await assertRefused(W, 'signAndSendWithAuthority', 'no-wallet');

    W = await load();
    await assertRefused(W, 'signAndSendWithAuthority', 'no-wallet');
    await reconnect(W, OTHER_WALLET);
    await assertRefused(W, 'signAndSendWithAuthority', 'other-wallet');
    await W.useWalletStore.getState().disconnect();
    assert.ok(await storedRecord('authority'));

    await reconnect(W, WALLET);
    const before = approvals.length;
    await W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
    assert.equal(approvals.length, before, 'no passkey prompt');
    assertSignedBy(sent.at(-1), new PublicKey(authorityPublicKey));
    assertNoPlaintext();
});

// ─── The wallet-adapter and Wallet Standard disconnect ──────────────────────

const adapterConfig = { rpcUrl: RPC, portalUrl: PORTAL, paymasterConfig, cluster: 'devnet' };

/** A `LazorkitWalletAdapter` connected to `walletPda`, saved as connect saves it. */
async function connectedAdapter(W, walletPda = WALLET) {
    await W.StorageManager.saveWallet(walletRecord(W, walletPda));
    const adapter = new W.LazorkitWalletAdapter(adapterConfig);
    await adapter.connect();
    assert.equal(adapter.connected, true);
    return adapter;
}

/** A session created through the store, its key kept in IndexedDB. */
async function keptSession(W) {
    connect(W);
    const created = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(created.sessionPda);
    assert.equal((await storedRecord('session')).publicKey, created.sessionPublicKey);
    return created;
}

test("LazorkitWalletAdapter.disconnect() deletes the session key, as the store's disconnect does, before 'disconnect' is emitted", async () => {
    const W = await load();
    await keptSession(W);
    const adapter = await connectedAdapter(W);
    let atEvent;
    adapter.once('disconnect', () => (atEvent = storedRecord('session')));

    await adapter.disconnect();
    assert.equal(adapter.connected, false);
    assert.equal(await atEvent, undefined, "gone when 'disconnect' is emitted");
    assert.equal(await storedRecord('session'), undefined, 'deleted from IndexedDB');
    // The store on the same page has nothing left to sign with.
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
    assert.equal(sent.length, 1, 'only the createSession');
    assertNoPlaintext();
});

test('LazorkitWalletAdapter.disconnect({ keepSessionKeys: true }) keeps the session key, which signs for its wallet again', async () => {
    const W = await load();
    const { sessionPublicKey } = await keptSession(W);
    const adapter = await connectedAdapter(W);

    await adapter.disconnect({ keepSessionKeys: true });
    assert.equal(adapter.connected, false);
    assert.equal((await storedRecord('session')).publicKey, sessionPublicKey, 'kept');

    await reconnect(W, WALLET);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
    assertNoPlaintext();
});

test('LazorkitWalletAdapter.disconnect() keeps the authority key, as the store does', async () => {
    const W = await load();
    connect(W);
    const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    landed(authorityPda);
    const adapter = await connectedAdapter(W);
    await adapter.disconnect();
    assert.equal((await storedRecord('authority')).publicKey, authorityPublicKey);
});

test("keyStorage='memory': LazorkitWalletAdapter.disconnect() deletes the session key this page holds in memory", async () => {
    const W = await load({ keyStorage: 'memory' });
    connect(W);
    const { sessionPda } = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(sessionPda);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    const adapter = await connectedAdapter(W);

    await adapter.disconnect();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
    assertNoPlaintext();
});

/** The Wallet Standard wallet `registerLazorkitWallet` registers, as an app that loads after it receives it. */
function registeredStandardWallet(W) {
    // registerWallet's own announcement is a Node `Event`, which jsdom's
    // window refuses (and logs); an app that loads later asks again with
    // 'wallet-standard:app-ready', which is how this page receives it.
    const error = console.error;
    console.error = () => {};
    try {
        W.registerLazorkitWallet(adapterConfig);
    } finally {
        console.error = error;
    }
    const registered = [];
    window.dispatchEvent(new window.CustomEvent('wallet-standard:app-ready', { detail: { register: (wallet) => registered.push(wallet) } }));
    return registered.at(-1);
}

test('the Wallet Standard standard:disconnect deletes the session key', async () => {
    const W = await load();
    await keptSession(W);
    await W.StorageManager.saveWallet(walletRecord(W, WALLET));
    const wallet = registeredStandardWallet(W);
    const { accounts } = await wallet.features['standard:connect'].connect();
    assert.equal(accounts.length, 1);

    await wallet.features['standard:disconnect'].disconnect();
    assert.deepEqual(wallet.accounts, []);
    assert.equal(await storedRecord('session'), undefined, 'deleted from IndexedDB');
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
    assertNoPlaintext();
});

// ─── A disconnect while a kept-key send is in flight ────────────────────────

/** A kept key of `kind` (`'session'` or `'authority'`) for WALLET, the store connected to WALLET; its public key. */
async function keptKey(W, kind) {
    if (kind === 'session') return (await keptSession(W)).sessionPublicKey;
    connect(W);
    const { authorityPda, authorityPublicKey } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    landed(authorityPda);
    return authorityPublicKey;
}

const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');

const sendWithKept = (W, kind, callbacks = {}) =>
    W.useWalletStore.getState()[kind === 'session' ? 'signAndSendWithSession' : 'signAndSendWithAuthority']({ instructions: transfer(), ...callbacks });

/**
 * Counts the transactions a kept (WebCrypto Ed25519) key signs, until
 * `restore()`; a key's 32-byte probe is not one. `whileSigning` runs inside
 * the first one, before its signature is returned.
 */
function spyKeySignatures(whileSigning) {
    const subtle = crypto.subtle;
    const original = subtle.sign;
    const spy = { count: 0, restore: () => delete subtle.sign };
    subtle.sign = async function (algorithm, key, data) {
        const signature = await original.call(this, algorithm, key, data);
        if ((algorithm?.name ?? algorithm) === 'Ed25519' && data.byteLength > 32) {
            spy.count++;
            if (spy.count === 1) await whileSigning?.();
        }
        return signature;
    };
    return spy;
}

/** Each way to disconnect: the store's, the wallet-adapter's, the Wallet Standard's. Set up before the send. */
async function disconnectPath(W, path) {
    if (path === 'store') return (options) => W.useWalletStore.getState().disconnect(options);
    if (path === 'adapter') {
        const adapter = await connectedAdapter(W);
        return (options) => adapter.disconnect(options);
    }
    await W.StorageManager.saveWallet(walletRecord(W, WALLET));
    const wallet = registeredStandardWallet(W);
    await wallet.features['standard:connect'].connect();
    return () => wallet.features['standard:disconnect'].disconnect();
}

for (const kind of ['session', 'authority']) {
    for (const path of ['adapter', 'standard', 'store']) {
        test(`${kind}: ${article(path)} ${path} disconnect while ${article(kind)} ${kind} send is being built: the key signs nothing, nothing is sent, and the send rejects`, async () => {
            const W = await load();
            const publicKey = await keptKey(W, kind);
            const disconnect = await disconnectPath(W, path);
            const sends = sent.length;
            const prompts = approvals.length;
            const spy = spyKeySignatures();
            const calls = [];
            let error;
            try {
                // The send has loaded its key: the disconnect runs to its end before the key signs.
                onBlockhash = () => disconnect();
                error = await rejection(sendWithKept(W, kind, { onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) }));
            } finally {
                spy.restore();
            }
            assert.equal(onBlockhash, null, 'the disconnect ran during the send');
            assert.ok(W.isKeyWalletMismatchError(error), String(error));
            assert.equal(error.reason, 'no-wallet');
            assert.equal(error.slot, kind);
            assert.equal(error.keyWallet, WALLET.toBase58());
            assert.match(error.message, /Nothing was signed or sent\.$/);
            assert.deepEqual(calls, [error]);
            assert.equal(spy.count, 0, 'the key signed nothing');
            assert.equal(sent.length, sends, 'nothing sent');
            assert.equal(approvals.length, prompts, 'no passkey prompt');
            assert.equal(W.useWalletStore.getState().wallet, null, 'the store is disconnected');
            assert.equal(W.useWalletStore.getState().isSigning, false);
            if (kind === 'session') assert.equal(await storedRecord('session'), undefined, 'the session key is deleted');
            else assert.equal((await storedRecord('authority')).publicKey, publicKey, 'the authority key is kept');
            assertNoPlaintext();
        });
    }
}

test('adapter.disconnect({ keepSessionKeys: true }) while a session send is being built: the send is refused, the key is kept, and signs once its wallet is connected again', async () => {
    const W = await load();
    const sessionPublicKey = await keptKey(W, 'session');
    const adapter = await connectedAdapter(W);
    const sends = sent.length;
    onBlockhash = () => adapter.disconnect({ keepSessionKeys: true });
    const error = await rejection(sendWithKept(W, 'session'));
    assert.ok(W.isKeyWalletMismatchError(error), String(error));
    assert.equal(error.reason, 'no-wallet');
    assert.equal(sent.length, sends, 'nothing sent');
    assert.equal((await storedRecord('session')).publicKey, sessionPublicKey, 'kept');

    await reconnect(W, WALLET);
    await sendWithKept(W, 'session');
    assertSignedBy(sent.at(-1), new PublicKey(sessionPublicKey));
});

for (const kind of ['session', 'authority']) {
    for (const path of ['store', 'adapter']) {
        test(`${kind}: ${article(path)} ${path} disconnect and a connect of the same wallet again while ${article(kind)} ${kind} send is being built: the send is refused ('disconnected'), and the next one signs`, async () => {
            const W = await load();
            const publicKey = await keptKey(W, kind);
            const disconnect = await disconnectPath(W, path);
            const sends = sent.length;
            const spy = spyKeySignatures();
            let error;
            try {
                onBlockhash = async () => {
                    await disconnect({ keepSessionKeys: true });
                    await reconnect(W, WALLET);
                };
                error = await rejection(sendWithKept(W, kind));
            } finally {
                spy.restore();
            }
            assert.ok(W.isKeyWalletMismatchError(error), String(error));
            assert.equal(error.reason, 'disconnected');
            assert.equal(error.keyWallet, WALLET.toBase58());
            assert.equal(error.connectedWallet, WALLET.toBase58());
            assert.match(error.message, /^The wallet was disconnected while this send was in progress, .* Send it again\. Nothing was signed or sent\.$/);
            assert.equal(spy.count, 0, 'the key signed nothing');
            assert.equal(sent.length, sends, 'nothing sent');

            // A send started after the reconnect signs.
            await sendWithKept(W, kind);
            assertSignedBy(sent.at(-1), new PublicKey(publicKey));
        });
    }
}

for (const kind of ['session', 'authority']) {
    test(`${kind}: an adapter disconnect while the key is signing: what it signed is not sent`, async () => {
        const W = await load();
        await keptKey(W, kind);
        const adapter = await connectedAdapter(W);
        const sends = sent.length;
        const spy = spyKeySignatures(() => adapter.disconnect());
        let error;
        try {
            error = await rejection(sendWithKept(W, kind));
        } finally {
            spy.restore();
        }
        assert.equal(spy.count, 1, 'the key signed, and the disconnect ran while it did');
        assert.ok(W.isKeyWalletMismatchError(error), String(error));
        assert.equal(error.reason, 'no-wallet');
        assert.match(error.message, /The transaction it had signed was not sent\.$/);
        assert.equal(sent.length, sends, 'nothing sent');
    });
}

/**
 * The paymaster answers the next `signAndSendTransaction` with `status` (and
 * nothing sent), then `whileRetrying` runs, during the wait before the retry.
 * Counts the attempts.
 */
function failFirstSend(status, whileRetrying) {
    const realFetch = globalThis.fetch;
    const hook = { attempts: 0, restore: () => (globalThis.fetch = realFetch) };
    globalThis.fetch = async (url, init) => {
        if (String(url) === PAYMASTER && JSON.parse(init.body).method === 'signAndSendTransaction') {
            if (++hook.attempts === 1) {
                setTimeout(() => void whileRetrying(), 0);
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: `refused (${status})` } }), { status });
            }
        }
        return realFetch(url, init);
    };
    return hook;
}

test('an adapter disconnect while the paymaster send waits to be retried: it is not sent again, and the send rejects', async () => {
    const W = await load();
    await keptKey(W, 'session');
    const adapter = await connectedAdapter(W);
    const sends = sent.length;
    // A 429 is a refusal: nothing was sent.
    let disconnected;
    const hook = failFirstSend(429, () => (disconnected = adapter.disconnect()));
    let error;
    try {
        error = await rejection(sendWithKept(W, 'session'));
        await disconnected;
    } finally {
        hook.restore();
    }
    assert.equal(hook.attempts, 1, 'not sent again');
    assert.ok(W.isKeyWalletMismatchError(error), String(error));
    assert.equal(error.reason, 'no-wallet');
    assert.match(error.message, /The transaction it had signed was not sent\.$/);
    assert.equal(sent.length, sends);
});

test('an adapter disconnect while the paymaster send waits to be retried, after an attempt whose answer was lost: not sent again, and its outcome is unknown', async () => {
    const W = await load();
    await keptKey(W, 'authority');
    const adapter = await connectedAdapter(W);
    // A 503 may come after the paymaster sent it.
    let disconnected;
    const hook = failFirstSend(503, () => (disconnected = adapter.disconnect()));
    let error;
    try {
        error = await rejection(sendWithKept(W, 'authority'));
        await disconnected;
    } finally {
        hook.restore();
    }
    assert.equal(hook.attempts, 1, 'not sent again');
    assert.equal(error.name, 'TransactionOutcomeUnknownError', String(error));
    assert.match(error.message, /may have sent this transaction/);
    assert.match(error.message, /not sent again: The stored authority key signs only for wallet/);
    assert.equal(W.isKeyWalletMismatchError(error), false, 'it may have been sent: not a refusal');
});

// ─── The wallet-adapter's disconnect disconnects the store ──────────────────

for (const path of ['adapter', 'standard']) {
    test(`the ${path} disconnect disconnects the store too: the authority key is refused until its wallet is connected again, also after a reload`, async () => {
        let W = await load();
        const authorityPublicKey = await keptKey(W, 'authority');
        const disconnect = await disconnectPath(W, path);
        await disconnect();
        assert.equal(W.useWalletStore.getState().wallet, null);
        await assertRefused(W, 'signAndSendWithAuthority', 'no-wallet');

        W = await load();
        assert.equal(W.useWalletStore.getState().wallet, null, 'not connected after a reload either');
        await assertRefused(W, 'signAndSendWithAuthority', 'no-wallet');
        await reconnect(W, WALLET);
        await sendWithKept(W, 'authority');
        assertSignedBy(sent.at(-1), new PublicKey(authorityPublicKey));
    });
}

test("the adapter's disconnect abandons a connect the store is running: it rejects with PortalCancelledError and connects nothing", async () => {
    const W = await load();
    const adapter = new W.LazorkitWalletAdapter(adapterConfig);
    // No stored wallet: the store's connect opens the portal, which does not answer here.
    const connecting = W.useWalletStore.getState().connect().then(
        () => 'connected',
        (error) => error,
    );
    await until(() => document.getElementById('lazorkit-iframe')?.src, 'the portal to open');
    assert.equal(W.useWalletStore.getState().isConnecting, true);
    await adapter.disconnect();
    const outcome = await Promise.race([connecting, new Promise((resolve) => setTimeout(() => resolve('still connecting'), 1000))]);
    assert.ok(outcome instanceof W.PortalCancelledError, String(outcome));
    assert.equal(W.useWalletStore.getState().isConnecting, false);
    assert.equal(W.useWalletStore.getState().wallet, null);
});

// ─── A session or authority still landing at sign-out ───────────────────────

/** Holds the paymaster's answer to the next transaction sent, until `release()`. */
function holdNextSend() {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const realFetch = globalThis.fetch;
    const hold = { held: false, release: () => release(), restore: () => (globalThis.fetch = realFetch) };
    globalThis.fetch = async (url, init) => {
        if (!hold.held && String(url) === PAYMASTER && JSON.parse(init.body).method === 'signAndSendTransaction') {
            hold.held = true;
            await gate;
        }
        return realFetch(url, init);
    };
    return hold;
}

for (const keep of [false, true]) {
    test(`a createSession still landing when disconnect(${keep ? '{ keepSessionKeys: true }' : ''}) runs: its key is ${keep ? 'kept, bound to its wallet' : 'not kept, here or at rest'}`, async () => {
        let W = await load();
        connect(W);
        const hold = holdNextSend();
        const calls = [];
        let created;
        try {
            const creating = W.useWalletStore.getState().createSession({
                unrestricted: true,
                onSuccess: () => calls.push('onSuccess'),
                onFail: (error) => calls.push(error),
            });
            await until(() => hold.held, 'the session transaction to be sent');
            await W.useWalletStore.getState().disconnect(keep ? { keepSessionKeys: true } : undefined);
            assert.equal(W.useWalletStore.getState().wallet, null);
            hold.release();
            created = await creating;
        } finally {
            hold.restore();
        }
        landed(created.sessionPda);
        assert.deepEqual(calls, ['onSuccess'], 'the session landed: a success');
        assert.equal(W.useWalletStore.getState().isSigning, false);
        const record = await storedRecord('session');
        if (keep) {
            assert.equal(record.publicKey, created.sessionPublicKey);
            assert.equal(record.info.walletPda, WALLET.toBase58());
            await assertRefused(W, 'signAndSendWithSession', 'no-wallet');
            await reconnect(W, WALLET);
            await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
            assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));
        } else {
            assert.equal(record, undefined, 'nothing at rest once disconnect() resolved');
            assert.ok(warnings.some((w) => w.includes(`Session ${created.sessionPda} landed after disconnect()`)), JSON.stringify(warnings));
            await reconnect(W, WALLET);
            await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /^Error: No session key found\. Create a session first\.$/);
            W = await load();
            await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
            assert.equal(sent.length, 1, 'only the createSession');
        }
        assertNoPlaintext();
    });
}

test('an addAuthority still landing when forgetStoredKeys() runs: its key is not kept', async () => {
    let W = await load();
    connect(W);
    const hold = holdNextSend();
    let added;
    try {
        const adding = W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
        await until(() => hold.held, 'the authority transaction to be sent');
        await W.forgetStoredKeys();
        hold.release();
        added = await adding;
    } finally {
        hold.restore();
    }
    landed(added.authorityPda);
    assert.equal(await storedRecord('authority'), undefined);
    assert.ok(warnings.some((w) => w.includes(`Authority ${added.authorityPda} landed after forgetStoredKeys()`)), JSON.stringify(warnings));
    await assert.rejects(W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
    W = await load();
    connect(W);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
});

/** Makes WebCrypto Ed25519 unavailable (iOS 16, Chrome 136) until the returned undo. */
function withoutEd25519() {
    const subtle = crypto.subtle;
    const isEd25519 = (algorithm) => (typeof algorithm === 'string' ? algorithm : algorithm?.name) === 'Ed25519';
    for (const method of ['generateKey', 'importKey']) {
        const original = subtle[method];
        subtle[method] = function (...args) {
            return isEd25519(method === 'importKey' ? args[2] : args[0])
                ? Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'))
                : original.apply(this, args);
        };
    }
    return () => {
        delete subtle.generateKey;
        delete subtle.importKey;
    };
}

/** createSession while IndexedDB refuses the write: the key signs from memory, to be stored on a later use. */
async function createSessionStoredLater(W) {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'keys') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
    };
    try {
        const created = await W.useWalletStore.getState().createSession({ unrestricted: true });
        landed(created.sessionPda);
        assert.equal(await storedRecord('session'), undefined, 'not stored yet');
        return created;
    } finally {
        IDBObjectStore.prototype.put = put;
    }
}

for (const wipe of ['disconnect', 'forgetStoredKeys']) {
    test(`a stored-later session key that ${wipe}() deletes while a send is storing it is not written back, nor used`, async () => {
        const undo = withoutEd25519();
        try {
            let W = await load();
            connect(W);
            await createSessionStoredLater(W);
            // The send stores the key first, sealing its seed: held here ...
            const encrypt = crypto.subtle.encrypt;
            let release;
            const gate = new Promise((resolve) => (release = resolve));
            let sealing = false;
            crypto.subtle.encrypt = async function (...args) {
                sealing = true;
                await gate;
                return encrypt.apply(this, args);
            };
            let sending;
            try {
                sending = W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
                await until(() => sealing, 'the stored-later key to be sealed');
                // ... while the wipe runs to the end.
                if (wipe === 'disconnect') await W.useWalletStore.getState().disconnect();
                else await W.forgetStoredKeys();
                assert.equal(await storedRecord('session'), undefined);
                release();
                await assert.rejects(sending, /No session key found/);
            } finally {
                delete crypto.subtle.encrypt;
            }
            assert.equal(await storedRecord('session'), undefined, 'not written back');
            assert.equal(sent.length, 1, 'only the createSession');
            assert.ok(!warnings.some((w) => w.includes('could not be deleted')), JSON.stringify(warnings));
            W = await load();
            connect(W);
            await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
        } finally {
            undo();
        }
    });
}

test('a send and disconnect() started together, the session key stored later: nothing is at rest once both settle', async () => {
    const W = await load();
    connect(W);
    // One IndexedDB open fails: createSession's save, so the key waits in memory.
    const real = globalThis.indexedDB;
    let failures = 1;
    globalThis.indexedDB = {
        open(...args) {
            if (failures-- <= 0) return real.open(...args);
            const request = { result: undefined, error: new DOMException('Connection to Indexed Database server lost', 'UnknownError') };
            setTimeout(() => request.onerror?.({ type: 'error', target: request, preventDefault() {} }));
            return request;
        },
        databases: () => real.databases(),
        deleteDatabase: (name) => real.deleteDatabase(name),
        cmp: (a, b) => real.cmp(a, b),
    };
    let created;
    try {
        created = await W.useWalletStore.getState().createSession({ unrestricted: true });
    } finally {
        globalThis.indexedDB = real;
    }
    landed(created.sessionPda);
    assert.ok(warnings.some((w) => w.includes('could not be stored yet')), JSON.stringify(warnings));

    const [send, disconnect] = await Promise.allSettled([
        W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
        W.useWalletStore.getState().disconnect(),
    ]);
    assert.equal(send.status, 'rejected');
    assert.equal(disconnect.status, 'fulfilled');
    assert.equal(sent.length, 1, 'only the createSession');
    assert.equal(await storedRecord('session'), undefined);
    assert.ok(!warnings.some((w) => w.includes('could not be deleted')), JSON.stringify(warnings));
});

// ─── A stored record is checked, not trusted ────────────────────────────────

/** Rewrites the stored record in `slot`, as a script on the page (or a corrupted profile) could. */
async function rewriteRecord(slot, change) {
    const record = await storedRecord(slot);
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('lazorkit-keys');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['keys'], 'readwrite');
            tx.objectStore('keys').put(change(record));
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

test("a record altered to name another wallet is not trusted: refused as unbound, or bound back to the wallet its account names", async () => {
    const W = await load();
    connect(W);
    const created = await W.useWalletStore.getState().createSession({ unrestricted: true });
    landed(created.sessionPda);
    await rewriteRecord('session', (record) => ({ ...record, info: { ...record.info, walletPda: OTHER_WALLET.toBase58(), bound: true } }));
    await reconnect(W, OTHER_WALLET);
    // Its PDA does not derive from OTHER_WALLET, and nothing on chain names the key.
    await assertRefused(W, 'signAndSendWithSession', 'unbound');

    // The session's account names its wallet (at 8) and its key (at 40): bound back to that wallet.
    const data = Buffer.alloc(80);
    WALLET.toBuffer().copy(data, 8);
    new PublicKey(created.sessionPublicKey).toBuffer().copy(data, 40);
    accounts.set(created.sessionPda, { owner: PROGRAM.toBase58(), data });
    await assertRefused(W, 'signAndSendWithSession', 'other-wallet');
    assert.equal((await storedRecord('session')).info.walletPda, WALLET.toBase58(), 'the binding is stored');

    await W.useWalletStore.getState().disconnect({ keepSessionKeys: true });
    await reconnect(W, WALLET);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedBy(sent.at(-1), new PublicKey(created.sessionPublicKey));
});

// ─── addAuthority's role ─────────────────────────────────────────────────────

test('addAuthority without a role, with one that is not a rank, or ROLE_OWNER on a v2 wallet, is refused before anything is read or prompted', async () => {
    const W = await load();
    connect(W);
    const before = requests;
    for (const payload of [undefined, {}, { unrestricted: true, policy: new Uint8Array(8) }, { role: 3 }, { role: -1 }, { role: 1.5 }, { role: '2' }, { role: null }, { role: 0 }]) {
        const calls = [];
        const error = await rejection(
            W.useWalletStore.getState().addAuthority(
                payload && { ...payload, onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push([e, W.useWalletStore.getState().isSigning]) },
            ),
        );
        const what = JSON.stringify(payload);
        assert.match(
            error.message,
            payload?.role === undefined
                ? /^addAuthority needs a role: the rank the new key gets on the wallet\. There is no default\./
                : payload.role === 0
                  ? /^addAuthority does not add an Owner to a LazorKit v2 wallet: an Owner could remove every other authority, this passkey included\./
                  : /^addAuthority: .* is not a role\./,
            what,
        );
        // On v2: the two ranks it adds, then what an Owner is and that it is not added.
        assert.match(
            error.message,
            /Pass one of: ROLE_ADMIN \(1\), which adds and removes delegates only, and spends without limit; ROLE_SPENDER \(2\), the delegate rank, which manages no authority and spends only within its policy .*\. On a v2 wallet addAuthority never adds ROLE_OWNER \(0\), which adds and removes any authority, other owners included \(never the last owner\), and spends without limit\./,
            what,
        );
        assert.match(error.message, /For a key your app holds, use ROLE_SPENDER with a policy\.$/, what);
        if (payload) assert.deepEqual(calls, [[error, false]], what);
        assert.equal(W.useWalletStore.getState().error, error, what);
        assert.equal(W.useWalletStore.getState().isSigning, false, what);
    }
    assert.equal(approvals.length, 0, 'no passkey prompt');
    assert.equal(requests, before, 'nothing read or sent');
    assert.equal(await storedRecord('authority'), undefined);

    // With a role it goes ahead.
    const { authorityPda } = await W.useWalletStore.getState().addAuthority({ role: W.ROLE_ADMIN });
    assert.equal(approvals.length, 1);
    assert.equal((await storedRecord('authority')).info.authorityPda, authorityPda);
});

test('on a v1 wallet, addAuthority lists ROLE_OWNER among the ranks, and does not refuse it', async () => {
    const W = await load();
    connect(W);
    // The wallet account exists: LazorkitProvider checks a v1 wallet has not been migrated.
    accounts.set(WALLET.toBase58(), { owner: PROGRAM.toBase58() });
    const checked = requests;
    W.useWalletStore.setState({ wallet: { ...W.useWalletStore.getState().wallet, protocolVersion: 1 } });
    await until(() => requests > checked, 'the provider to check the v1 wallet');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(W.useWalletStore.getState().wallet?.protocolVersion, 1, 'still connected');
    const before = requests;
    const error = await rejection(W.useWalletStore.getState().addAuthority({ role: 7, unrestricted: true }));
    assert.match(
        error.message,
        /^addAuthority: 7 is not a role\. Pass one of: ROLE_OWNER \(0\), which adds and removes any authority, other owners included \(never the last owner\), and spends without limit; ROLE_ADMIN \(1\), .*; ROLE_SPENDER \(2\), the delegate rank, .*\. For a key your app holds, use ROLE_SPENDER with a policy\.$/,
    );
    assert.equal(requests, before, 'refused before anything is read');

    // ROLE_OWNER passes the role check: the call goes on to read the wallet.
    const owner = await rejection(W.useWalletStore.getState().addAuthority({ role: W.ROLE_OWNER }));
    assert.doesNotMatch(owner.message, /is not a role|does not add an Owner|needs a role/);
    assert.ok(requests > before, 'went on to the chain');
    assert.equal(approvals.length, 0);
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
