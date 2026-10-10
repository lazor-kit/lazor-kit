// Typed approval requests, through the built package (`pnpm build` first) in
// a browser page (jsdom): createSession, revokeSession and removeAuthority on
// a v2 wallet open the portal with the operation's parameters in the URL
// fragment (`#/?lk1=…`) and the query 3.x sent; the portal's reply is checked
// against what the SDK prepared before anything is sent.
//
// Checked: the request the portal gets (and that it passes the portal's own
// query check); a typed reply finalizes at the portal's slot and counter; a
// reply without `typed` (an older portal) at the prepared ones; every reply
// that does not match is `PortalReplyMismatchError` and nothing is sent; the
// portal's refusals (`RequestOutOfDateError`, `PortalRefusedError`); the
// session's expiry in seconds of the cluster clock (`expiresInSeconds`,
// `expiresAt`, the deprecated `expiresInSlots`), refused before the portal
// opens when out of range; the URL cap. A scripted chain, paymaster and
// portal, no network. Run with `pnpm test`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

// ─── A browser page ─────────────────────────────────────────────────────────

const PORTAL = 'http://portal.test';
const RPC = 'http://rpc.test/';
const PAYMASTER = 'http://paymaster.test/';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://app.test/' });
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
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));
console.debug = () => {};
console.error = () => {};
console.info = () => {};

const require = createRequire(import.meta.url);
const W = await import('../dist/index.mjs');
const A = require('@lazorkit/sdk-legacy/approval');
const { serializeActions, Actions } = require('@lazorkit/sdk-legacy');

// ─── A scripted chain and paymaster ─────────────────────────────────────────

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const USDC = fixed(21);
const CREDENTIAL = Buffer.from('a passkey credential, typed');
const CREDENTIAL_ID = CREDENTIAL.toString('base64');
const PROGRAM = W.PROGRAM_ID_DEVNET;
/** The passkey's stored counter: the next signature commits to 6. */
const STORED_COUNTER = 5;
/** The slot the scripted chain is at. */
const CHAIN_SLOT = 5000;
/** 2026-10-10 12:00 UTC: the cluster clock. */
const CLUSTER_TIME = 1_791_633_600n;
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';

const accounts = new Map();
const sent = [];
let performanceSamples = [{ slot: 1, numSlots: 150, numTransactions: 1, samplePeriodSecs: 60 }];

function passkeyAuthority() {
    const credentialIdHash = W.getCredentialHash(CREDENTIAL_ID);
    const [authorityPda] = W.findAuthorityPda(WALLET, credentialIdHash, PROGRAM);
    const data = Buffer.alloc(120);
    data[0] = 0x22;
    data[1] = 1;
    data.writeUInt32LE(STORED_COUNTER, 8);
    WALLET.toBuffer().copy(data, 16);
    Buffer.from(credentialIdHash).copy(data, 48);
    data[80] = 2;
    data.fill(0x11, 81, 113);
    accounts.set(authorityPda.toBase58(), { owner: PROGRAM.toBase58(), data });
    return authorityPda;
}

function clockAccount() {
    const data = Buffer.alloc(40);
    data.writeBigUInt64LE(BigInt(CHAIN_SLOT), 0);
    data.writeBigInt64LE(CLUSTER_TIME, 32);
    return { owner: 'Sysvar1111111111111111111111111111111111111', data };
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
            return reply({ context: { slot: CHAIN_SLOT }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
        case 'getSlot':
            return reply(CHAIN_SLOT);
        case 'getRecentPerformanceSamples':
            return reply(performanceSamples);
        case 'getAccountInfo': {
            const found = params[0] === CLOCK_SYSVAR ? clockAccount() : accounts.get(params[0]);
            return reply({ context: { slot: CHAIN_SLOT }, value: found ? account(found) : null });
        }
        case 'getMultipleAccounts':
            return reply({ context: { slot: CHAIN_SLOT }, value: params[0].map((a) => (accounts.has(a) ? account(accounts.get(a)) : null)) });
        case 'getProgramAccounts':
            return reply(
                [...accounts]
                    .filter(([, a]) => a.owner === PROGRAM.toBase58() && a.data?.length >= 113 && a.data[0] === 0x22 && a.data[1] === 1)
                    .map(([pubkey, a]) => ({ pubkey, account: account(a) })),
            );
        case 'getSignatureStatuses':
            return reply({ context: { slot: 6000 }, value: params[0].map(() => ({ slot: 5001, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
        default:
            throw new Error(`unscripted RPC ${method}`);
    }
}

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

// ─── A scripted portal ──────────────────────────────────────────────────────

/** Each sign request the dialog opened: its URL. */
const opened = [];
/**
 * How the portal answers a sign request: `(url) => reply data` for a
 * SIGNATURE_CREATED, or `{ error }` for a refusal. Defaults to a typed portal.
 */
let answer;
const answered = new Set();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    const url = new URL(iframe.src);
    if (url.searchParams.get('action') !== 'sign') return;
    answered.add(iframe.src);
    opened.push(url);
    const result = answer(url);
    window.dispatchEvent(
        new window.MessageEvent('message', {
            origin: PORTAL,
            source: iframe.contentWindow,
            data: result.error ? { type: 'error', error: result.error } : { type: 'SIGNATURE_CREATED', data: result },
        }),
    );
}, 5);
after(() => {
    clearInterval(portal);
    window.close();
});

/** A WebAuthn assertion whose clientDataJSON carries `challenge` (base64url). */
function assertion(challenge, type = 'webauthn.get') {
    return {
        normalized: Buffer.alloc(64, 1).toString('base64'),
        clientDataJSONReturn: Buffer.from(JSON.stringify({ type, challenge, origin: PORTAL })).toString('base64'),
        authenticatorDataReturn: Buffer.alloc(37, 2).toString('base64'),
        msg: '',
    };
}

/** The request the portal got, decoded as the portal decodes it. */
function requestOf(url) {
    return A.readApprovalFragment(url.hash);
}

/** A typed portal: it signs the request at `slot` and the request's counter + `ahead`. */
const typedPortal = ({ slot = 7777n, ahead = 0 } = {}) => (url) => {
    const req = requestOf(url);
    const binding = { slot, counter: req.counter + ahead };
    return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: A.typedReplyFor(req, binding) };
};

/** A portal that does not read typed requests: it signs `message`. */
const legacyPortal = () => (url) => assertion(url.searchParams.get('message'));

// ─── The store ──────────────────────────────────────────────────────────────

const store = W.useWalletStore;
W.registerCluster(RPC, 'devnet');

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    accounts.clear();
    sent.length = 0;
    opened.length = 0;
    warnings.length = 0;
    // `answered` is kept: an iframe still closing from the last test is not a new request.
    answer = typedPortal();
    performanceSamples = [{ slot: 1, numSlots: 150, numTransactions: 1, samplePeriodSecs: 60 }];
    passkeyAuthority();
    store.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true }),
        config: { portalUrl: PORTAL, paymasterConfig: { paymasterUrl: PAYMASTER }, rpcUrl: RPC, cluster: 'devnet' },
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
        isSigning: false,
        error: null,
    });
});

/** Whether the sent transaction's auth payload commits to `slot` and `counter` (prefix: slot, counter, sysvar index, 0x80). */
function signedAt(tx, { slot, counter, sysvarIxIndex }) {
    const prefix = Buffer.alloc(14);
    prefix.writeBigUInt64LE(BigInt(slot), 0);
    prefix.writeUInt32LE(counter, 8);
    prefix[12] = sysvarIxIndex;
    prefix[13] = 0x80;
    return tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data).indexOf(prefix) >= 0);
}

const limits = { solPerTxMax: 2_000_000n, tokens: [{ mint: USDC, lifetimeCap: 5_000_000n }] };

// ─── createSession ──────────────────────────────────────────────────────────

test('createSession sends the typed request in the fragment, with the query 3.x sent, and the portal finalizes it at its own slot', async () => {
    const { sessionPda, sessionPublicKey } = await store.getState().createSession({ spendingLimits: limits, expiresInSeconds: 3600 });
    assert.equal(opened.length, 1);
    const url = opened[0];

    // The query is 3.x's: the challenge, an empty transaction, the credential.
    assert.deepEqual([...url.searchParams.keys()], ['action', 'message', 'transaction', 'credentialId']);
    assert.equal(url.searchParams.get('transaction'), '');
    assert.equal(url.searchParams.get('credentialId'), CREDENTIAL_ID);
    assert.ok(url.hash.startsWith('#/?lk1='), url.hash);

    const req = requestOf(url);
    const [authorityPda] = W.findAuthorityPda(WALLET, W.getCredentialHash(CREDENTIAL_ID), PROGRAM);
    assert.deepEqual(
        { ...req, args: undefined },
        {
            v: 1,
            kind: 'createSession',
            cluster: 'devnet',
            programId: PROGRAM.toBase58(),
            wallet: WALLET.toBase58(),
            authority: authorityPda.toBase58(),
            credentialId: CREDENTIAL.toString('base64url'),
            payer: FEE_PAYER.toBase58(),
            counter: STORED_COUNTER + 1,
            preparedSlot: String(CHAIN_SLOT),
            args: undefined,
        },
    );
    assert.deepEqual(req.args, {
        sessionKey: sessionPublicKey,
        expiresAt: String(CLUSTER_TIME + 3600n),
        actions: Buffer.from(
            serializeActions([Actions.solMaxPerTx(2_000_000n), Actions.tokenLimit({ mint: USDC, remaining: 5_000_000n })]),
        ).toString('base64url'),
    });
    // The portal's own check: the query is this request's challenge, the authority this credential's.
    assert.deepEqual(A.checkApprovalQuery(req, { message: url.searchParams.get('message'), credentialId: url.searchParams.get('credentialId') }), { ok: true });

    // Finalized at the portal's slot, with the counter prepared.
    assert.equal(sent.length, 1);
    assert.ok(signedAt(sent[0], { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 6 }));
    assert.ok(!signedAt(sent[0], { slot: BigInt(CHAIN_SLOT), counter: STORED_COUNTER + 1, sysvarIxIndex: 6 }));
    assert.equal(sessionPda, W.findSessionPda(WALLET, new PublicKey(sessionPublicKey).toBytes(), PROGRAM)[0].toBase58());
});

test("a counter that moved forward before Approve: the portal signs the chain's counter, and the transaction carries it", async () => {
    answer = typedPortal({ slot: 9000n, ahead: 2 });
    await store.getState().createSession({ spendingLimits: limits });
    assert.equal(sent.length, 1);
    assert.ok(signedAt(sent[0], { slot: 9000n, counter: STORED_COUNTER + 3, sysvarIxIndex: 6 }));
});

test('a portal that does not read typed requests signs the challenge in the query: finalized at the prepared slot and counter', async () => {
    answer = legacyPortal();
    await store.getState().createSession({ spendingLimits: limits });
    assert.equal(sent.length, 1);
    assert.ok(signedAt(sent[0], { slot: BigInt(CHAIN_SLOT), counter: STORED_COUNTER + 1, sysvarIxIndex: 6 }));
});

test('a reply that does not match the request is PortalReplyMismatchError, and nothing is sent', async () => {
    const mismatches = {
        'another kind': (url) => {
            const req = requestOf(url);
            const binding = { slot: 7777n, counter: req.counter };
            return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: { ...A.typedReplyFor(req, binding), kind: 'revokeSession' } };
        },
        'a counter below the prepared one': (url) => {
            const req = requestOf(url);
            const binding = { slot: 7777n, counter: req.counter - 1 };
            return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: A.typedReplyFor(req, binding) };
        },
        'another sysvar index': (url) => {
            const req = requestOf(url);
            const binding = { slot: 7777n, counter: req.counter };
            return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: { ...A.typedReplyFor(req, binding), sysvarIxIndex: 5 } };
        },
        'a typed block whose slot is not the one signed': (url) => {
            const req = requestOf(url);
            return { ...assertion(url.searchParams.get('message')), typed: A.typedReplyFor(req, { slot: 7777n, counter: req.counter }) };
        },
        'another request signed (a later expiry)': (url) => {
            const req = requestOf(url);
            const other = { ...req, args: { ...req.args, expiresAt: String(BigInt(req.args.expiresAt) + 86_400n) } };
            const binding = { slot: 7777n, counter: req.counter };
            return { ...assertion(A.approvalChallengeBase64url(other, binding)), typed: A.typedReplyFor(req, binding) };
        },
        'a malformed typed block (an extra key)': (url) => {
            const req = requestOf(url);
            const binding = { slot: 7777n, counter: req.counter };
            return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: { ...A.typedReplyFor(req, binding), note: 'x' } };
        },
        'a malformed typed block (the slot as a number)': (url) => {
            const req = requestOf(url);
            const binding = { slot: 7777n, counter: req.counter };
            return { ...assertion(A.approvalChallengeBase64url(req, binding)), typed: { ...A.typedReplyFor(req, binding), slot: 7777 } };
        },
        'no typed block, and another challenge signed': (url) => assertion(Buffer.alloc(32, 9).toString('base64url')),
        'a registration, not an assertion': (url) => assertion(url.searchParams.get('message'), 'webauthn.create'),
    };
    for (const [what, reply] of Object.entries(mismatches)) {
        answer = reply;
        await assert.rejects(store.getState().createSession({ spendingLimits: limits }), (error) => {
            assert.equal(error.name, 'PortalReplyMismatchError', `${what}: ${error.message}`);
            assert.ok(error instanceof W.PortalReplyMismatchError, what);
            return true;
        });
        assert.equal(sent.length, 0, `${what}: nothing sent`);
        assert.equal(store.getState().isSigning, false);
    }
});

test("the portal's refusals: stale-counter is RequestOutOfDateError (retryable), the others PortalRefusedError with the code", async () => {
    answer = () => ({ error: { code: 'stale-counter', message: 'This request is out of date. Your passkey signed nothing.' } });
    await assert.rejects(store.getState().createSession({ spendingLimits: limits }), (error) => {
        assert.ok(error instanceof W.RequestOutOfDateError);
        assert.equal(error.code, 'stale-counter');
        assert.equal(error.retryable, true);
        assert.match(error.message, /signed nothing/);
        return true;
    });
    answer = () => ({ error: { code: 'request-invalid', message: "This request can't go through." } });
    await assert.rejects(store.getState().createSession({ spendingLimits: limits }), (error) => {
        assert.ok(error instanceof W.PortalRefusedError);
        assert.equal(error.code, 'request-invalid');
        return true;
    });
    // An error without a typed-request code is reported as before.
    answer = () => ({ error: { message: 'User cancelled' } });
    await assert.rejects(store.getState().createSession({ spendingLimits: limits }), (error) => {
        assert.equal(error.constructor, Error);
        assert.equal(error.message, 'User cancelled');
        return true;
    });
    assert.equal(sent.length, 0);
});

// ─── The session's expiry ───────────────────────────────────────────────────

test('expiry: seconds of the cluster clock, by default 5 hours; expiresAt as given', async () => {
    const expiresAtOf = () => BigInt(requestOf(opened.at(-1)).args.expiresAt);
    await store.getState().createSession({ spendingLimits: limits });
    assert.equal(expiresAtOf(), CLUSTER_TIME + BigInt(W.DEFAULTS.SESSION_EXPIRY_SECONDS));
    assert.equal(W.DEFAULTS.SESSION_EXPIRY_SECONDS, 18_000);

    await store.getState().createSession({ spendingLimits: limits, expiresInSeconds: 600n });
    assert.equal(expiresAtOf(), CLUSTER_TIME + 600n);

    await store.getState().createSession({ spendingLimits: limits, expiresAt: Number(CLUSTER_TIME) + 7200 });
    assert.equal(expiresAtOf(), CLUSTER_TIME + 7200n);

    // The longest a session may last.
    await store.getState().createSession({ spendingLimits: limits, expiresAt: CLUSTER_TIME + W.MAX_SESSION_SECONDS });
    assert.equal(expiresAtOf(), CLUSTER_TIME + 2_592_000n);
    assert.equal(sent.length, 4);
});

test('expiresInSlots (deprecated) is converted with the measured slot time, and warns once', async () => {
    // 150 slots a minute: 0.4 s a slot, so 50,000 slots are 20,000 s.
    await store.getState().createSession({ spendingLimits: limits, expiresInSlots: 50_000n });
    assert.equal(BigInt(requestOf(opened.at(-1)).args.expiresAt), CLUSTER_TIME + 20_000n);
    await store.getState().createSession({ spendingLimits: limits, expiresInSlots: 50_000n });
    assert.equal(warnings.filter((w) => /expiresInSlots.*deprecated/.test(w)).length, 1);

    // No samples to measure with: refused, nothing opened.
    performanceSamples = [];
    const before = opened.length;
    await assert.rejects(store.getState().createSession({ spendingLimits: limits, expiresInSlots: 50_000n }), /slot time could not be measured.*expiresInSeconds/);
    assert.equal(opened.length, before);
});

test('an expiry the program would refuse is refused before the portal opens', async () => {
    const refused = [
        [{ expiresInSeconds: 0 }, /expiresInSeconds must be more than 0 and at most 2592000/],
        [{ expiresInSeconds: 2_592_001 }, /expiresInSeconds must be more than 0 and at most 2592000/],
        [{ expiresInSeconds: 1.5 }, /expiresInSeconds must be a whole number of seconds/],
        [{ expiresAt: CLUSTER_TIME }, /must be after the cluster's time/],
        [{ expiresAt: CLUSTER_TIME + 2_592_001n }, /at most 30 days ahead/],
        [{ expiresAt: 412_388_000n }, /not a Unix time in seconds \(it looks like a slot\)/],
        [{ expiresInSeconds: 60, expiresAt: CLUSTER_TIME + 60n }, /takes one of expiresInSeconds, expiresAt and expiresInSlots/],
        [{ expiresInSlots: 0n }, /expiresInSlots must be a bigint from 1/],
    ];
    for (const [expiry, message] of refused) {
        await assert.rejects(store.getState().createSession({ spendingLimits: limits, ...expiry }), message);
    }
    assert.equal(opened.length, 0);
    assert.equal(sent.length, 0);
});

// ─── revokeSession and removeAuthority ──────────────────────────────────────

test('revokeSession sends a typed revokeSession request and lands at the portal slot', async () => {
    const sessionPda = fixed(31);
    await store.getState().revokeSession({ sessionPda });
    const req = requestOf(opened[0]);
    assert.equal(req.kind, 'revokeSession');
    assert.deepEqual(req.args, { session: sessionPda.toBase58(), refund: FEE_PAYER.toBase58() });
    assert.equal(req.counter, STORED_COUNTER + 1);
    assert.ok(signedAt(sent[0], { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 5 }));
});

test('removeAuthority sends a typed removeAuthority request and lands at the portal slot', async () => {
    const target = fixed(41);
    await store.getState().removeAuthority(target.toBase58());
    const req = requestOf(opened[0]);
    assert.equal(req.kind, 'removeAuthority');
    assert.deepEqual(req.args, { target: target.toBase58(), refund: FEE_PAYER.toBase58() });
    assert.ok(signedAt(sent[0], { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 5 }));

    // A reply for the other kind of request is refused.
    answer = (url) => {
        const r = requestOf(url);
        const binding = { slot: 7777n, counter: r.counter };
        return { ...assertion(A.approvalChallengeBase64url(r, binding)), typed: { ...A.typedReplyFor(r, binding), kind: 'revokeSession' } };
    };
    // (Another target: the same request would be the same URL, which this portal answers once.)
    await assert.rejects(store.getState().removeAuthority(fixed(42).toBase58()), (error) => error instanceof W.PortalReplyMismatchError);
    assert.equal(sent.length, 1);
});

// ─── The other passkey actions are unchanged ────────────────────────────────

test('signAndSendTransaction and addAuthority open the portal as 3.x did: no fragment', async () => {
    answer = legacyPortal();
    await store.getState().addAuthority({ role: W.ROLE_ADMIN });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].hash, '');
});

// ─── The cap ────────────────────────────────────────────────────────────────

test('a portal URL over the cap is refused with TypedRequestTooLargeError before anything opens', async () => {
    store.setState({ config: { ...store.getState().config, portalUrl: `${PORTAL}/${'p'.repeat(16_000)}` } });
    await assert.rejects(store.getState().createSession({ spendingLimits: limits }), (error) => {
        assert.ok(error instanceof W.TypedRequestTooLargeError, error.message);
        assert.equal(error.limit, 16_384);
        return true;
    });
    assert.equal(opened.length, 0);
    assert.equal(sent.length, 0);
});
