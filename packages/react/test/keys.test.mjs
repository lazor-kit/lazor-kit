// Where the SDK keeps the session and authority keys it generates, through the
// built package (`pnpm build` first). A plaintext key an earlier release left
// in localStorage moves on its first read: into IndexedDB (fake-indexeddb) as
// a non-extractable WebCrypto Ed25519 key, sealed with AES-GCM where there is
// no WebCrypto Ed25519, or into memory where there is no IndexedDB. Whatever
// holds it, the key signs exactly as web3.js's Keypair does with the same seed
// (on fixed seeds, in both wire formats). Sends go to a scripted RPC and
// paymaster, no network; every "page" is a fresh copy of the package, as a
// reload is. Run with `pnpm test`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, webcrypto } from 'node:crypto';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    VersionedMessage,
    VersionedTransaction,
} from '@solana/web3.js';

// Node 18 has WebCrypto, but not as a global.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => void storage.set(key, String(value)),
    removeItem: (key) => void storage.delete(key),
};

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const FEE_PAYER = fixed(7).publicKey;
const BLOCKHASH = fixed(9).publicKey.toBase58();
const WALLET = fixed(11).publicKey;
const RECIPIENT = fixed(13).publicKey;

/** Fixed seeds: RFC 8032 §7.1 TESTs 1-3, a seed with leading zero bytes, and 0xff…. */
const SEEDS = [
    '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    '0000000000000000000000000000000000000000000000000000000000000001',
    'ff'.repeat(32),
].map((hex) => Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, 'hex'))));

// ─── A scripted chain and paymaster ─────────────────────────────────────────

/** Accounts that exist: address → owner. */
const accounts = new Map();
/** Every transaction the paymaster was asked to send. */
const sent = [];

const rpcFetch = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    if (method === 'getLatestBlockhash') {
        return reply({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1e9 } });
    }
    if (method === 'getAccountInfo') {
        const owner = accounts.get(params[0]);
        return reply({
            context: { slot: 1 },
            value: owner ? { data: ['', 'base64'], executable: false, lamports: 1_000_000, owner, rentEpoch: 0, space: 0 } : null,
        });
    }
    if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
    if (method === 'getSignatureStatuses') {
        return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 600, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
    }
    throw new Error(`unscripted RPC ${method}`);
};
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), PAYMASTER);
    const { id, method, params } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: FEE_PAYER.toBase58() } });
    if (method === 'signAndSendTransaction') {
        sent.push(VersionedTransaction.deserialize(Buffer.from(params.transaction, 'base64')));
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
};

const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

let pages = 0;
let PROGRAM;

/** A fresh copy of the package, as after a reload: nothing in memory, storage as it was. */
async function page({ keyStorage } = {}) {
    const W = await import(`../dist/index.mjs?page=${++pages}`);
    PROGRAM = W.PROGRAM_ID_DEVNET;
    W.registerCluster(RPC, 'devnet');
    W.useWalletStore.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true }),
        config: {
            portalUrl: 'http://portal.test',
            paymasterConfig: { paymasterUrl: PAYMASTER },
            rpcUrl: RPC,
            cluster: 'devnet',
            ...(keyStorage ? { keyStorage } : {}),
        },
        wallet: null,
        isSigning: false,
        error: null,
    });
    return W;
}

beforeEach(() => {
    // A new browser profile: no IndexedDB databases, no localStorage.
    globalThis.indexedDB = new IDBFactory();
    storage.clear();
    accounts.clear();
    sent.length = 0;
    warnings.length = 0;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A localStorage entry as releases up to 3.2 wrote it for `createSession`. */
function plantSession(W, keypair) {
    const [sessionPda] = W.findSessionPda(WALLET, keypair.publicKey.toBytes(), PROGRAM);
    accounts.set(sessionPda.toBase58(), PROGRAM.toBase58());
    const entry = JSON.stringify({
        secretKey: Array.from(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
        sessionPda: sessionPda.toBase58(),
        walletPda: WALLET.toBase58(),
        expiresAt: '123456',
        spendingLimits: { solPerTxMax: '1000000' },
    });
    storage.set('lazorkit-session', entry);
    return { sessionPda, entry };
}

/** A localStorage entry as releases up to 3.2 wrote it for `addAuthority`. */
function plantAuthority(W, keypair) {
    const [authorityPda] = W.findAuthorityPda(WALLET, keypair.publicKey.toBytes(), PROGRAM);
    accounts.set(authorityPda.toBase58(), PROGRAM.toBase58());
    const entry = JSON.stringify({
        secretKey: Array.from(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
        authorityPda: authorityPda.toBase58(),
        walletPda: WALLET.toBase58(),
        role: 1,
    });
    storage.set('lazorkit-authority', entry);
    return { authorityPda, entry };
}

const transfer = () => [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: RECIPIENT, lamports: 1000 })];

/** The signature in `tx` by `key`. */
function signatureBy(tx, key) {
    const index = tx.message.staticAccountKeys.findIndex((k) => k.equals(key));
    assert.ok(index >= 0 && index < tx.message.header.numRequiredSignatures, 'the key is a signer');
    return Buffer.from(tx.signatures[index]);
}

/** What web3.js's Keypair signs `tx`'s message with. */
function web3Signature(tx, keypair) {
    const copy = new VersionedTransaction(VersionedMessage.deserialize(tx.message.serialize()));
    copy.sign([keypair]);
    return signatureBy(copy, keypair.publicKey);
}

/** Asserts the key's signature in the last sent transaction is web3.js's, and verifies on its own. */
function assertSignedAsWeb3(keypair, version) {
    const tx = sent.at(-1);
    assert.equal(tx.version, version === 'legacy' ? 'legacy' : 0);
    const signature = signatureBy(tx, keypair.publicKey);
    assert.deepEqual(signature, web3Signature(tx, keypair), 'byte for byte the signature web3.js makes');
    const publicKey = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(keypair.publicKey.toBytes()).toString('base64url') },
        format: 'jwk',
    });
    assert.ok(verify(null, tx.message.serialize(), publicKey, signature), 'verifies as Ed25519');
    // The fee payer's slot is left to the paymaster.
    assert.deepEqual(Buffer.from(tx.signatures[0]), Buffer.alloc(64));
}

/** The record in the SDK's IndexedDB slot, without creating the database. */
async function storedRecord(slot) {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('lazorkit-keys')) return undefined;
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

async function wrapKey() {
    const db = await new Promise((resolve) => {
        const request = indexedDB.open('lazorkit-keys');
        request.onsuccess = () => resolve(request.result);
    });
    try {
        return await new Promise((resolve) => {
            const request = db.transaction(['meta']).objectStore('meta').get('wrap-key');
            request.onsuccess = () => resolve(request.result);
        });
    } finally {
        db.close();
    }
}

/** Asserts the slot holds `keypair` as a non-extractable WebCrypto key, and nothing else. */
async function assertNonExtractable(slot, keypair) {
    const record = await storedRecord(slot);
    assert.ok(record, 'stored in IndexedDB');
    assert.equal(record.publicKey, keypair.publicKey.toBase58());
    assert.equal(record.sealed, undefined);
    assert.equal(record.privateKey.type, 'private');
    assert.equal(record.privateKey.extractable, false);
    assert.equal(record.privateKey.algorithm.name, 'Ed25519');
    await assert.rejects(crypto.subtle.exportKey('pkcs8', record.privateKey));
    await assert.rejects(crypto.subtle.exportKey('jwk', record.privateKey));
    assert.ok(!JSON.stringify(record, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)).includes('secretKey'));
    return record;
}

/** Makes this "browser" one without WebCrypto Ed25519 (iOS 16, Chrome 136), until the returned undo. */
function withoutEd25519() {
    const subtle = crypto.subtle;
    const isEd25519 = (algorithm) => (typeof algorithm === 'string' ? algorithm : algorithm?.name) === 'Ed25519';
    const notSupported = () => Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'));
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

// ─── Moving a plaintext key, and signing with it ────────────────────────────

for (const version of ['legacy', 'v0']) {
    test(`${version}: a plaintext session key moves to a non-extractable key on its first read, and signs as web3.js's Keypair does`, async () => {
        for (const keypair of SEEDS) {
            storage.clear();
            const W = await page();
            const { sessionPda } = plantSession(W, keypair);
            const signature = await W.useWalletStore
                .getState()
                .signAndSendWithSession({ instructions: transfer(), transactionOptions: { txVersion: version } });
            assert.equal(typeof signature, 'string');
            assertSignedAsWeb3(keypair, version);
            assert.equal(storage.get('lazorkit-session'), undefined, 'the plaintext is gone');
            const record = await assertNonExtractable('session', keypair);
            assert.equal(record.info.sessionPda, sessionPda.toBase58());
            assert.equal(record.info.walletPda, WALLET.toBase58());
            assert.equal(record.info.expiresAt, '123456');
        }
    });

    test(`${version}: a plaintext authority key moves the same way, and signs as web3.js's Keypair does`, async () => {
        for (const keypair of SEEDS.slice(0, 2)) {
            storage.clear();
            const W = await page();
            const { authorityPda } = plantAuthority(W, keypair);
            await W.useWalletStore
                .getState()
                .signAndSendWithAuthority({ instructions: transfer(), transactionOptions: { txVersion: version } });
            assertSignedAsWeb3(keypair, version);
            assert.equal(storage.get('lazorkit-authority'), undefined);
            const record = await assertNonExtractable('authority', keypair);
            assert.equal(record.info.authorityPda, authorityPda.toBase58());
            assert.equal(record.info.role, 1);
        }
    });
}

test('the stored key survives a reload, and a second read has nothing left to move', async () => {
    const keypair = SEEDS[0];
    const first = await page();
    plantSession(first, keypair);
    await first.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    const before = await storedRecord('session');

    const reloaded = await page();
    await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    const after = await storedRecord('session');
    assert.equal(after.createdAt, before.createdAt, 'not written again');
    assert.equal(storage.size, 0);
    assert.deepEqual(warnings, []);
});

// ─── What is not moved, and when ────────────────────────────────────────────

test('the plaintext stays until the IndexedDB write commits; the key serves the page meanwhile', async () => {
    const keypair = SEEDS[1];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'keys') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
    };
    let entry;
    try {
        const W = await page();
        ({ entry } = plantSession(W, keypair));
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(storage.get('lazorkit-session'), entry, 'the plaintext stays');
        assert.equal(await storedRecord('session'), undefined);
        assert.ok(warnings.some((w) => w.includes('could not be moved yet') && w.includes('QuotaExceededError')), JSON.stringify(warnings));
    } finally {
        IDBObjectStore.prototype.put = put;
    }

    const reloaded = await page();
    await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    assert.equal(storage.get('lazorkit-session'), undefined, 'moved on the next read');
    await assertNonExtractable('session', keypair);
});

test('a migration does not write over a key saved meanwhile (another tab removes the plaintext first)', async () => {
    const W = await page();
    plantSession(W, SEEDS[0]);
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
        // The write's own transaction: another tab's saveKey has just removed the entry.
        if (this.name === 'keys' && this.transaction.mode === 'readwrite') storage.delete('lazorkit-session');
        return get.apply(this, args);
    };
    try {
        await assert.rejects(
            W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
            /No session key found/,
        );
    } finally {
        IDBObjectStore.prototype.get = get;
    }
    assert.equal(await storedRecord('session'), undefined, 'the old key was not written');
    assert.equal(sent.length, 0);
});

test('an entry this SDK did not write is left as it is, and no key is read from it', async () => {
    const keypair = SEEDS[2];
    const other = SEEDS[3];
    const valid = {
        secretKey: Array.from(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
        sessionPda: fixed(21).publicKey.toBase58(),
        walletPda: WALLET.toBase58(),
    };
    const entries = {
        'not JSON': '{"secretKey": [1, 2',
        'a short secret key': JSON.stringify({ ...valid, secretKey: valid.secretKey.slice(0, 32) }),
        'bytes out of range': JSON.stringify({ ...valid, secretKey: valid.secretKey.map((b, i) => (i === 0 ? 256 : b)) }),
        "another key's public key": JSON.stringify({ ...valid, publicKey: other.publicKey.toBase58() }),
        "a secret key whose second half is another key's": JSON.stringify({
            ...valid,
            secretKey: [...keypair.secretKey.slice(0, 32), ...other.publicKey.toBytes()],
        }),
        'no session PDA': JSON.stringify({ ...valid, sessionPda: undefined }),
        'a wallet PDA that is not base58': JSON.stringify({ ...valid, walletPda: 'not-an-address' }),
    };
    for (const [what, entry] of Object.entries(entries)) {
        const W = await page();
        storage.set('lazorkit-session', entry);
        await assert.rejects(
            W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
            /No session key found\. Create a session first\./,
            what,
        );
        assert.equal(storage.get('lazorkit-session'), entry, `${what}: left as it is`);
        assert.equal(await storedRecord('session'), undefined, what);
    }
    assert.equal(sent.length, 0);
});

// ─── Without WebCrypto Ed25519, without IndexedDB, without either ───────────

test('no WebCrypto Ed25519: the seed is sealed with AES-GCM, and still signs as web3.js does', async () => {
    const keypair = SEEDS[0];
    const restore = withoutEd25519();
    try {
        for (const version of ['legacy', 'v0']) {
            storage.clear();
            const W = await page();
            plantSession(W, keypair);
            await W.useWalletStore
                .getState()
                .signAndSendWithSession({ instructions: transfer(), transactionOptions: { txVersion: version } });
            assertSignedAsWeb3(keypair, version);
            assert.equal(storage.get('lazorkit-session'), undefined);
            const record = await storedRecord('session');
            assert.equal(record.privateKey, undefined);
            assert.equal(record.sealed.iv.length, 12);
            assert.equal(record.sealed.ct.length, 32 + 16, 'the seed and the GCM tag');
            const seed = Buffer.from(keypair.secretKey.slice(0, 32));
            assert.equal(Buffer.from(record.sealed.ct).indexOf(seed), -1, 'not in the clear');
            const sealingKey = await wrapKey();
            assert.equal(sealingKey.algorithm.name, 'AES-GCM');
            assert.equal(sealingKey.extractable, false);
            await assert.rejects(crypto.subtle.exportKey('raw', sealingKey));
        }
        // Read again after a reload: opened for the signature only.
        const reloaded = await page();
        await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
    } finally {
        restore();
    }

    // The browser has Ed25519 now: the seed becomes a non-extractable key.
    const upgraded = await page();
    await upgraded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    await assertNonExtractable('session', keypair);
});

test('a sealed seed moved to another slot does not open there', async () => {
    const restore = withoutEd25519();
    try {
        const W = await page();
        plantSession(W, SEEDS[0]);
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        const sealed = (await storedRecord('session')).sealed;
        // Someone with write access to the database copies it into the authority slot.
        const authority = await page();
        const { entry } = plantAuthority(authority, SEEDS[0]);
        storage.delete('lazorkit-authority');
        const db = await new Promise((resolve) => {
            const request = indexedDB.open('lazorkit-keys');
            request.onsuccess = () => resolve(request.result);
        });
        const info = JSON.parse(entry);
        await new Promise((resolve) => {
            const tx = db.transaction(['keys'], 'readwrite');
            tx.objectStore('keys').put({
                slot: 'authority',
                v: 1,
                publicKey: SEEDS[0].publicKey.toBase58(),
                sealed,
                info: { authorityPda: info.authorityPda, walletPda: info.walletPda, role: 1 },
                createdAt: 1,
            });
            tx.oncomplete = resolve;
        });
        db.close();
        await assert.rejects(
            authority.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }),
            (error) => error.name === 'OperationError',
        );
    } finally {
        restore();
    }
});

test('no IndexedDB: the key serves this page, and the plaintext goes', async () => {
    const keypair = SEEDS[1];
    globalThis.indexedDB = undefined;
    const W = await page();
    plantSession(W, keypair);
    plantAuthority(W, SEEDS[2]);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    await W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
    assertSignedAsWeb3(SEEDS[2], 'v0');
    assert.equal(storage.size, 0, 'no plaintext left');

    const reloaded = await page();
    await assert.rejects(
        reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
        /No session key found/,
    );
});

test("keyStorage: 'memory' keeps nothing at rest: the plaintext moves to memory, IndexedDB is not used", async () => {
    const keypair = SEEDS[3];
    const W = await page({ keyStorage: 'memory' });
    plantSession(W, keypair);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    assert.equal(storage.get('lazorkit-session'), undefined);
    assert.deepEqual(await indexedDB.databases(), [], 'IndexedDB not opened');

    const reloaded = await page({ keyStorage: 'memory' });
    await assert.rejects(
        reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
        /No session key found/,
    );
});

test('no secure context (no crypto.subtle): the key serves this page, and the plaintext goes', async () => {
    const keypair = SEEDS[4];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: (array) => webcrypto.getRandomValues(array) },
        configurable: true,
        writable: true,
    });
    try {
        const W = await page();
        plantSession(W, keypair);
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer(), transactionOptions: { txVersion: 'legacy' } });
        assertSignedAsWeb3(keypair, 'legacy');
        assert.equal(storage.get('lazorkit-session'), undefined);
        assert.equal(await storedRecord('session'), undefined, 'never stored without a way to seal it');
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        else delete globalThis.crypto;
    }
});

// ─── IndexedDB that fails, hangs or cannot hold a CryptoKey ─────────────────

/**
 * This profile's IndexedDB, with its next `count` opens failing as Safari's
 * do when its IndexedDB server connection is lost (an UnknownError, fired
 * asynchronously). Later opens work.
 */
function failingOpens(count) {
    const real = globalThis.indexedDB;
    let left = count;
    globalThis.indexedDB = {
        open(...args) {
            if (left-- <= 0) return real.open(...args);
            const request = {
                result: undefined,
                error: new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'),
            };
            setTimeout(() => request.onerror?.({ type: 'error', target: request, preventDefault() {} }));
            return request;
        },
        databases: () => real.databases(),
        deleteDatabase: (name) => real.deleteDatabase(name),
        cmp: (a, b) => real.cmp(a, b),
    };
    return () => (globalThis.indexedDB = real);
}

test('an IndexedDB open that fails once keeps the plaintext: the key serves this page, and moves on the next read', async () => {
    const keypair = SEEDS[0];
    const restore = failingOpens(1);
    let entry;
    try {
        const W = await page();
        ({ entry } = plantSession(W, keypair));
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(storage.get('lazorkit-session'), entry, 'the plaintext stays');
        assert.ok(warnings.some((w) => w.includes('could not be moved yet') && w.includes('UnknownError')), JSON.stringify(warnings));
    } finally {
        restore();
    }
    assert.equal(await storedRecord('session'), undefined);

    // Reload, IndexedDB working again: the key moves.
    const reloaded = await page();
    await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    assert.equal(storage.get('lazorkit-session'), undefined, 'moved on the next read');
    await assertNonExtractable('session', keypair);
});

test('the same for the authority key', async () => {
    const keypair = SEEDS[1];
    const restore = failingOpens(1);
    let entry;
    try {
        const W = await page();
        ({ entry } = plantAuthority(W, keypair));
        await W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(storage.get('lazorkit-authority'), entry, 'the plaintext stays');
    } finally {
        restore();
    }
    const reloaded = await page();
    await reloaded.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    await assertNonExtractable('authority', keypair);
});

test('a key already in IndexedDB, when the open fails: the send fails with that error (not "no key"), and works on the next try', async () => {
    const keypair = SEEDS[2];
    const W = await page();
    plantSession(W, keypair);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assert.equal(storage.size, 0);

    const reloaded = await page();
    const restore = failingOpens(1);
    try {
        await assert.rejects(
            reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }),
            (error) => error.name === 'UnknownError',
        );
    } finally {
        restore();
    }
    assert.equal(reloaded.useWalletStore.getState().isSigning, false);
    await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    await assertNonExtractable('session', keypair);
});

test('an IndexedDB open that never settles times out: the send still resolves, isSigning clears, the plaintext stays', async () => {
    const keypair = SEEDS[3];
    const real = globalThis.indexedDB;
    // An open request that never fires (Safari's first-load hang).
    globalThis.indexedDB = { open: () => ({}), databases: () => real.databases() };
    let entry;
    try {
        const W = await page();
        ({ entry } = plantSession(W, keypair));
        const started = Date.now();
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assert.ok(Date.now() - started < 9000, 'within the open timeout');
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(W.useWalletStore.getState().isSigning, false);
        assert.equal(storage.get('lazorkit-session'), entry, 'the plaintext stays');
        assert.ok(warnings.some((w) => w.includes('TimeoutError')), JSON.stringify(warnings));
    } finally {
        globalThis.indexedDB = real;
    }
    const reloaded = await page();
    await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    assertSignedAsWeb3(keypair, 'v0');
    await assertNonExtractable('session', keypair);
});

/** Until the returned undo, IndexedDB refuses to store a CryptoKey (DataCloneError): in `stores`, those records only. */
function noCryptoKeysIn(stores) {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
        const isKey = (v) => !!v && typeof v === 'object' && typeof v.type === 'string' && typeof v.algorithm === 'object';
        const holdsKey = isKey(value) || isKey(value?.privateKey);
        if (stores.includes(this.name) && holdsKey) {
            throw new DOMException('CryptoKey object could not be cloned.', 'DataCloneError');
        }
        return put.call(this, value, ...rest);
    };
    return () => (IDBObjectStore.prototype.put = put);
}

test('IndexedDB that cannot hold an Ed25519 CryptoKey (DataCloneError): the seed is sealed instead, and the plaintext goes', async () => {
    const keypair = SEEDS[4];
    const restore = noCryptoKeysIn(['keys']);
    try {
        const W = await page();
        plantSession(W, keypair);
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(storage.get('lazorkit-session'), undefined, 'not left in the clear for ever');
        const record = await storedRecord('session');
        assert.equal(record.privateKey, undefined);
        assert.equal(record.sealed.ct.length, 48);

        const reloaded = await page();
        await reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
    } finally {
        restore();
    }
});

test('IndexedDB that cannot hold any CryptoKey: as with no IndexedDB, the key serves this page and the plaintext goes', async () => {
    const keypair = SEEDS[0];
    const restore = noCryptoKeysIn(['keys', 'meta']);
    try {
        const W = await page();
        plantSession(W, keypair);
        await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
        assertSignedAsWeb3(keypair, 'v0');
        assert.equal(storage.get('lazorkit-session'), undefined);
        assert.equal(await storedRecord('session'), undefined);
        assert.ok(warnings.some((w) => w.includes('DataCloneError')), JSON.stringify(warnings));
    } finally {
        restore();
    }
});

// ─── forgetStoredKeys: sign-out ──────────────────────────────────────────────

test('forgetStoredKeys deletes every key the SDK keeps: IndexedDB, memory and plaintext', async () => {
    let W = await page();
    plantSession(W, SEEDS[0]);
    plantAuthority(W, SEEDS[1]);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    await W.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() });
    assert.ok(await storedRecord('session'));
    assert.ok(await storedRecord('authority'));

    // A key this page holds in memory only, and a plaintext entry not yet moved.
    W = await page({ keyStorage: 'memory' });
    plantSession(W, SEEDS[2]);
    await W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() });
    plantAuthority(W, SEEDS[3]);

    await W.forgetStoredKeys();
    assert.equal(storage.size, 0, 'no plaintext left');
    assert.equal(await storedRecord('session'), undefined);
    assert.equal(await storedRecord('authority'), undefined);
    assert.equal(await wrapKey(), undefined);
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);

    const reloaded = await page();
    await assert.rejects(reloaded.useWalletStore.getState().signAndSendWithSession({ instructions: transfer() }), /No session key found/);
    await assert.rejects(reloaded.useWalletStore.getState().signAndSendWithAuthority({ instructions: transfer() }), /No authority key found/);
    // With nothing stored, and with no IndexedDB, it resolves all the same.
    await reloaded.forgetStoredKeys();
    globalThis.indexedDB = undefined;
    await (await page()).forgetStoredKeys();
});

afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
});
