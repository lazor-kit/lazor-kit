// Ownership proofs are domain-separated too, and a wallet's message signature
// is checked against the key on chain. Through the built package (`pnpm build`
// first) in a browser page (jsdom), with a scripted chain and a scripted
// portal that signs, with a real P-256 passkey key, whatever challenge it is
// handed. Checked: `createOwnershipChallenge` is `tag || 32 random bytes` (59
// bytes) and `verifyOwnershipProof` accepts a proof over it; connect hands
// the portal only such challenges, on the connect URL and for the proof it
// asks the portal to sign, and the proof over it settles the wallet's key; no
// challenge of one kind (transaction: 32 bytes, message: 58, proof: 59) can be
// another; `verifyWalletMessage` is true only for the key the claimed wallet
// stores on chain for the credential. No network. Run with `pnpm test`.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

// ─── A browser page ─────────────────────────────────────────────────────────

const APP = 'http://app.test/';
const PORTAL = 'http://portal.test';
const RP_ID = 'portal.test';
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
console.debug = () => {};
console.error = () => {};
console.warn = () => {};
// Only the paymaster is reached through fetch; the chain has its own (below).
// Reaching it means connect settled the passkey's key and went on to create
// its wallet, which is where these tests stop.
globalThis.fetch = async (url) => {
    throw new Error(`unexpected fetch ${url}`);
};

const W = await import('../dist/index.mjs');
const PROGRAM = W.PROGRAM_ID_DEVNET;

// ─── Formats ────────────────────────────────────────────────────────────────

const PROOF_TAG = Buffer.from('LazorKit ownership proof v1', 'utf8');
const MESSAGE_TAG = Buffer.from('LazorKit signed message v1', 'utf8');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const isProofChallenge = (bytes) => bytes.length === 59 && Buffer.from(bytes.subarray(0, 27)).equals(PROOF_TAG);

// ─── The passkey and the portal ─────────────────────────────────────────────

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function passkey() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]) };
}

/** A WebAuthn assertion as a browser makes one, with the low s the portal sends. */
function assertion(key, challenge, { rpId = RP_ID } = {}) {
    const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: PORTAL, crossOrigin: false }),
    );
    const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
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

const KEY = passkey();
const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');

/** Every portal URL the SDK opened, connect and sign: their parameters. */
const requests = [];
/** How the portal answers connect: its reply's fields, given the URL's parameters. */
let connectReply = () => ({});
const answered = new Set();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe.src)) return;
    answered.add(iframe.src);
    const params = new URL(iframe.src).searchParams;
    requests.push(params);
    const action = params.get('action');
    const data =
        action === 'connect'
            ? { credentialId: CREDENTIAL_ID, publickey: KEY.compressed.toString('base64'), ...connectReply(params) }
            : { ...assertion(KEY, Buffer.from(params.get('message'), 'base64')), credentialId: CREDENTIAL_ID };
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

// ─── A scripted chain ───────────────────────────────────────────────────────

/** Accounts that exist: address → { owner, data }. */
const accounts = new Map();
let rpcCalls = [];

const account = ({ owner, data = Buffer.alloc(0) }) => ({
    data: [data.toString('base64'), 'base64'],
    executable: false,
    lamports: 2_000_000,
    owner,
    rentEpoch: 0,
    space: data.length,
});

/** getProgramAccounts as a node answers it: the program's accounts that match every memcmp filter. */
function programAccounts(programId, filters = []) {
    return [...accounts]
        .filter(([, a]) => a.owner === programId)
        .filter(([, a]) =>
            filters.every(({ memcmp }) => {
                if (!memcmp) return true;
                const bytes = Buffer.from(memcmp.bytes, memcmp.encoding === 'base64' ? 'base64' : 'base64');
                return a.data.length >= memcmp.offset + bytes.length && a.data.subarray(memcmp.offset, memcmp.offset + bytes.length).equals(bytes);
            }),
        )
        .map(([pubkey, a]) => ({ pubkey, account: account(a) }));
}

async function rpc(init) {
    const { id, method, params } = JSON.parse(init.body);
    rpcCalls.push(method);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    switch (method) {
        case 'getProgramAccounts':
            return reply(programAccounts(params[0], params[1]?.filters));
        case 'getAccountInfo': {
            const found = accounts.get(params[0]);
            return reply({ context: { slot: 5000 }, value: found ? account(found) : null });
        }
        default:
            throw new Error(`unscripted RPC ${method}`);
    }
}

const connection = new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true });

/**
 * A v2 wallet with an Owner passkey authority for `credentialId`, created
 * under `rpId`, storing `key`: the authority layout sdk-legacy reads
 * (discriminator 0x22, Secp256r1, role, wallet at 16, credential hash at 48,
 * compressed key at 80, rpId hash at 113).
 */
function walletOnChain({ key = KEY.compressed, credentialId = CREDENTIAL_ID, rpId = RP_ID, role = 0, walletExists = true } = {}) {
    const wallet = Keypair.generate().publicKey;
    const credentialIdHash = W.getCredentialHash(credentialId);
    const [authorityPda] = W.findAuthorityPda(wallet, credentialIdHash, PROGRAM);
    const data = Buffer.alloc(145);
    data[0] = 0x22;
    data[1] = 1;
    data[2] = role;
    wallet.toBuffer().copy(data, 16);
    Buffer.from(credentialIdHash).copy(data, 48);
    Buffer.from(key).copy(data, 80);
    sha256(rpId).copy(data, 113);
    accounts.set(authorityPda.toBase58(), { owner: PROGRAM.toBase58(), data });
    if (walletExists) accounts.set(wallet.toBase58(), { owner: PROGRAM.toBase58(), data: Buffer.alloc(48, 1) });
    return { wallet, vault: W.findVaultPda(wallet, PROGRAM)[0] };
}

const store = W.useWalletStore;

beforeEach(() => {
    requests.length = 0;
    rpcCalls = [];
    accounts.clear();
    connectReply = () => ({});
    localStorage.clear();
    store.getState().setConfig({ rpcUrl: RPC, portalUrl: PORTAL, paymasterConfig: { paymasterUrl: PAYMASTER }, cluster: 'devnet' });
    store.setState({ connection, wallet: null, isConnecting: false, isSigning: false, error: null });
});

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('resolved');
}

// ─── The ownership-proof format ─────────────────────────────────────────────

test('createOwnershipChallenge is tag || 32 random bytes: 59 bytes, never a transaction or message challenge', () => {
    assert.equal(W.OWNERSHIP_PROOF_DOMAIN, 'LazorKit ownership proof v1');
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
        const challenge = W.createOwnershipChallenge();
        assert.ok(challenge instanceof Uint8Array);
        assert.ok(isProofChallenge(challenge), 'tag || 32 bytes');
        assert.notEqual(challenge.length, 32); // a transaction challenge
        assert.notEqual(challenge.length, W.signedMessageChallenge('x').length); // a message challenge
        assert.ok(!Buffer.from(challenge.subarray(0, MESSAGE_TAG.length)).equals(MESSAGE_TAG));
        seen.add(Buffer.from(challenge).toString('hex'));
    }
    assert.equal(seen.size, 200, 'fresh every time');
    // And no message challenge is a proof challenge, whatever the message.
    for (const length of [0, 27, 32, 59, 100]) {
        const message = new Uint8Array(randomBytes(length));
        assert.ok(!isProofChallenge(W.signedMessageChallenge(message)));
        assert.equal(W.signedMessageChallenge(message).length, 58);
    }
});

test('verifyOwnershipProof accepts a proof over the tagged challenge, for the signing key only', () => {
    const proofOver = (challenge) => {
        const reply = assertion(KEY, challenge);
        return {
            challenge,
            signature: new Uint8Array(Buffer.from(reply.normalized, 'base64')),
            authenticatorData: new Uint8Array(Buffer.from(reply.authenticatorDataReturn, 'base64')),
            clientDataJson: new Uint8Array(Buffer.from(reply.clientDataJSONReturn, 'base64')),
        };
    };
    const proof = proofOver(W.createOwnershipChallenge());
    const mine = { publicKey: new Uint8Array(KEY.compressed) };
    const other = { publicKey: new Uint8Array(passkey().compressed) };
    assert.deepEqual(W.verifyOwnershipProof([mine, other], proof, RP_ID), [mine]);
    assert.deepEqual(W.verifyOwnershipProof([mine], proof, 'evil.test'), []);
    // A proof that claims another challenge than the one signed proves nothing.
    assert.deepEqual(W.verifyOwnershipProof([mine], { ...proof, challenge: W.createOwnershipChallenge() }, RP_ID), []);
});

// ─── connect ────────────────────────────────────────────────────────────────

test("connect asks the portal to sign only tagged proof challenges, and the proof over one settles the passkey's key", async () => {
    // A passkey with no wallet that signed in (so the key the portal reports is
    // not evidence): connect proves it with one portal sign, then creates.
    connectReply = () => ({ kind: 'asserted' });
    const error = await rejection(store.getState().connect());
    // It got as far as creating the wallet for the reported key: the proof verified.
    assert.match(error.message, /unexpected fetch http:\/\/paymaster\.test/);

    assert.deepEqual(requests.map((r) => r.get('action')), ['connect', 'sign']);
    const [connectRequest, signRequest] = requests;
    const connectChallenge = Buffer.from(connectRequest.get('challenge'), 'base64');
    const proofChallenge = Buffer.from(signRequest.get('message'), 'base64');
    assert.ok(isProofChallenge(connectChallenge), 'the connect URL carries a tagged challenge');
    assert.ok(isProofChallenge(proofChallenge), 'the proof the portal signs is over a tagged challenge');
    assert.ok(!connectChallenge.equals(proofChallenge), 'a fresh one for each');
    assert.equal(signRequest.get('transaction'), '');
    assert.equal(signRequest.get('credentialId'), CREDENTIAL_ID);
    assert.ok(rpcCalls.includes('getProgramAccounts'));
});

test("connect takes the portal's assertion over the tagged connect challenge as the proof, with no second prompt", async () => {
    connectReply = (params) => ({ kind: 'asserted', ...assertion(KEY, Buffer.from(params.get('challenge'), 'base64')) });
    const error = await rejection(store.getState().connect());
    assert.match(error.message, /unexpected fetch http:\/\/paymaster\.test/);
    assert.deepEqual(requests.map((r) => r.get('action')), ['connect']);
    assert.ok(isProofChallenge(Buffer.from(requests[0].get('challenge'), 'base64')));
});

// ─── verifyWalletMessage ────────────────────────────────────────────────────

/** A message signature as signMessage returns it, made with `key`. */
function signed(message, key = KEY, options) {
    const reply = assertion(key, W.signedMessageChallenge(message), options);
    return {
        signature: reply.normalized,
        signedPayload: reply.msg,
        clientDataJsonBase64: reply.clientDataJSONReturn,
        authenticatorDataBase64: reply.authenticatorDataReturn,
    };
}

const MESSAGE = 'Sign in to app.test\nNonce: 42';

test('verifyWalletMessage is true for the key the wallet stores on chain, by wallet or vault address', async () => {
    const { wallet, vault } = walletOnChain();
    const result = signed(MESSAGE);
    for (const claimed of [wallet, vault, wallet.toBase58(), vault.toBase58()]) {
        assert.equal(
            await W.verifyWalletMessage({ connection, wallet: claimed, credentialId: CREDENTIAL_ID, rpId: RP_ID, message: MESSAGE, ...result }),
            true,
        );
    }
    // With the cluster named, for a connection whose URL does not say.
    assert.equal(
        await W.verifyWalletMessage({ connection, cluster: 'devnet', wallet, credentialId: CREDENTIAL_ID, rpId: RP_ID, origin: PORTAL, message: MESSAGE, ...result }),
        true,
    );
});

test("verifyWalletMessage is false for any other passkey's signature, whatever key the client claims", async () => {
    const { wallet } = walletOnChain();
    const intruder = passkey();
    const result = signed(MESSAGE, intruder);
    // The intruder's signature checks out against the intruder's own key...
    assert.equal(W.verifySignedMessage({ message: MESSAGE, publicKey: intruder.compressed, ...result }), true);
    // ...but it is not the wallet's: a key the client sends is never used.
    const params = { connection, wallet, credentialId: CREDENTIAL_ID, rpId: RP_ID, message: MESSAGE, ...result, publicKey: intruder.compressed };
    assert.equal(await W.verifyWalletMessage(params), false);
});

test('verifyWalletMessage is false for another wallet, credential, relying party, message, a non-Owner, or a closed wallet', async () => {
    const result = signed(MESSAGE);
    const verify = (overrides) =>
        W.verifyWalletMessage({ connection, credentialId: CREDENTIAL_ID, rpId: RP_ID, message: MESSAGE, ...result, ...overrides });

    // The passkey's wallet is not the one claimed.
    walletOnChain();
    assert.equal(await verify({ wallet: Keypair.generate().publicKey }), false);

    const { wallet } = walletOnChain();
    assert.equal(await verify({ wallet, credentialId: Buffer.from('another credential').toString('base64') }), false);
    assert.equal(await verify({ wallet, rpId: 'evil.test' }), false);
    assert.equal(await verify({ wallet, message: 'Sign in to evil.test' }), false);
    assert.equal(await verify({ wallet, origin: 'http://evil.test' }), false);

    // The authority was created under another relying party.
    const elsewhere = walletOnChain({ rpId: 'other.test' });
    assert.equal(await verify({ wallet: elsewhere.wallet }), false);
    // An Admin, not an Owner.
    const admin = walletOnChain({ role: 1 });
    assert.equal(await verify({ wallet: admin.wallet }), false);
    // The wallet account is gone (a migrated wallet leaves authorities behind).
    const closed = walletOnChain({ walletExists: false });
    assert.equal(await verify({ wallet: closed.wallet }), false);
});

test('verifyWalletMessage: a signature over the raw message bytes is false, malformed input is false, an unreadable chain rejects', async () => {
    const { wallet } = walletOnChain();
    const message = new Uint8Array(randomBytes(32));
    const reply = assertion(KEY, message);
    const raw = {
        signature: reply.normalized,
        signedPayload: reply.msg,
        clientDataJsonBase64: reply.clientDataJSONReturn,
        authenticatorDataBase64: reply.authenticatorDataReturn,
    };
    const base = { connection, wallet, credentialId: CREDENTIAL_ID, rpId: RP_ID };
    rpcCalls = [];
    assert.equal(await W.verifyWalletMessage({ ...base, message, ...raw }), false);
    assert.deepEqual(rpcCalls, [], 'nothing is read for a reply that is not over the message');

    const result = signed(MESSAGE);
    for (const overrides of [{ wallet: 'not an address' }, { credentialId: '' }, { rpId: '' }, { clientDataJsonBase64: 'bm90IGpzb24=' }, { message: 42 }]) {
        assert.equal(await W.verifyWalletMessage({ ...base, message: MESSAGE, ...result, ...overrides }), false, JSON.stringify(overrides));
    }

    const down = new Connection(RPC, { fetch: async () => new Response('', { status: 503 }), disableRetryOnRateLimit: true });
    await assert.rejects(W.verifyWalletMessage({ ...base, connection: down, cluster: 'devnet', message: MESSAGE, ...result }));
});
