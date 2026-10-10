// A session or authority that landed is reported as landed, even when its key
// cannot be stored afterwards: createSession and addAuthority resolve, call
// onSuccess and not onFail, and leave `error` clear. Here the page has no
// IndexedDB, and localStorage refuses the slots 3.2.1 kept keys in; a key
// those slots still hold is not left in place. keys-e2e.test.mjs covers the
// key such a call still signs with. Through the built package (`pnpm build`
// first) in a browser page (jsdom): the passkey approves in the portal (a
// scripted stand-in answering the dialog's iframe), against a scripted chain
// and paymaster, no network. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair } from '@solana/web3.js';

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

const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));
// The portal dialog's debug log.
console.debug = () => {};

const W = await import('../dist/index.mjs');
const PROGRAM = W.PROGRAM_ID_DEVNET;

// ─── A scripted chain, paymaster and portal ─────────────────────────────────

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');

/** Accounts that exist: address → { owner, data }. */
const accounts = new Map();
let sends = 0;

/** The wallet's passkey authority, on chain. */
function passkeyAuthority() {
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
}

const account = ({ owner, data = Buffer.alloc(0) }) => ({
    data: [data.toString('base64'), 'base64'],
    executable: false,
    lamports: 2_000_000,
    owner,
    rentEpoch: 0,
    space: data.length,
});

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
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    switch (method) {
        case 'getLatestBlockhash':
            return reply({ context: { slot: 5000 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
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
            // Every transaction lands, successfully.
            return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 1001, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
        default:
            throw new Error(`unscripted RPC ${method}`);
    }
}

globalThis.fetch = async (url, init) => {
    assert.equal(String(url), PAYMASTER);
    const { id, method } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: FEE_PAYER.toBase58() } });
    if (method === 'signAndSendTransaction') {
        sends++;
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
};

/**
 * The portal: answers each sign request the SDK's dialog opens, as the
 * portal's iframe would once the user approved with the passkey. It answers
 * after the dialog's credential sync (500 ms in) has run, as a user would.
 */
const answered = new Set();
const seen = new Map();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    const url = new URL(iframe.src);
    if (url.searchParams.get('action') !== 'sign') return;
    if (!seen.has(iframe.src)) seen.set(iframe.src, Date.now());
    if (Date.now() - seen.get(iframe.src) < 700) return;
    answered.add(iframe.src);
    const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: url.searchParams.get('message'), origin: PORTAL });
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
    window.close();
});

// ─── The store, with storage that refuses the SDK's keys ────────────────────

const store = W.useWalletStore;
const KEY_SLOTS = ['lazorkit-session', 'lazorkit-authority'];
const setItem = window.Storage.prototype.setItem;

beforeEach(() => {
    window.Storage.prototype.setItem = setItem;
    localStorage.clear();
    accounts.clear();
    warnings.length = 0;
    store.getState().setConfig({ rpcUrl: RPC, portalUrl: PORTAL, paymasterConfig: { paymasterUrl: PAYMASTER }, cluster: 'devnet' });
    passkeyAuthority();
    store.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true }),
        wallet: {
            credentialId: CREDENTIAL_ID,
            passkeyPubkey: [2, ...new Array(32).fill(0x11)],
            smartWallet: WALLET.toBase58(),
            vaultPda: W.findVaultPda(WALLET, PROGRAM)[0].toBase58(),
            walletDevice: '',
            protocolVersion: 2,
        },
        isSigning: false,
        error: null,
    });
});

/** From now on, writing a session or authority key fails, as a full or blocked storage does. */
function refuseKeyWrites() {
    window.Storage.prototype.setItem = function (name, value) {
        if (KEY_SLOTS.includes(name)) throw new window.DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return setItem.call(this, name, value);
    };
}

for (const [name, slot, call] of [
    ['createSession', 'lazorkit-session', (callbacks) => store.getState().createSession({ unrestricted: true, ...callbacks })],
    ['addAuthority', 'lazorkit-authority', (callbacks) => store.getState().addAuthority({ role: 1, ...callbacks })],
]) {
    test(`${name}: a key that cannot be stored once it landed does not report it as failed`, async () => {
        // A key an earlier call kept: later calls must not sign with it in
        // place of the new one.
        localStorage.setItem(slot, JSON.stringify({ secretKey: [1], publicKey: 'the previous key' }));
        refuseKeyWrites();
        const before = sends;
        const calls = [];
        const result = await call({
            onSuccess: (...args) => calls.push(['onSuccess', ...args]),
            onFail: (error) => calls.push(['onFail', error]),
        });
        assert.equal(sends - before, 1, 'it was sent, and landed');
        assert.deepEqual(calls, [['onSuccess', ...Object.values(result)]]);
        assert.equal(store.getState().error, null);
        assert.equal(store.getState().isSigning, false);
        assert.ok(warnings.some((w) => w.includes('could not be stored')), 'a warning says the key was not kept');
        assert.equal(localStorage.getItem(slot), null, 'the previous key is not left in its place');
    });
}
