// signMessage signs a domain-separated challenge, never the app's bytes,
// through the built package (`pnpm build` first) in a browser page (jsdom):
// the store (and so the hook), LazorkitWalletAdapter and the Wallet Standard
// `solana:signMessage` each open the portal's iframe, and a scripted
// stand-in answers with no checks of its own — it signs, with a real P-256
// passkey key, whatever its `message` parameter decodes to. Checked: the
// challenge the SDK hands the portal is `tag || SHA-256(tag || message)` for
// every message, a 32-byte one included, and never the message itself; a
// reply over another challenge is refused; `verifySignedMessage` accepts what
// signMessage returns and rejects a signature over the raw bytes. No network.
// Run with `pnpm test`.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

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
console.debug = () => {};
// registerWallet's first attempt (a Node Event on a jsdom window) is logged.
console.error = () => {};
globalThis.fetch = async (url) => {
    throw new Error(`unexpected fetch ${url}`);
};

const W = await import('../dist/index.mjs');

// ─── The passkey and the portal ─────────────────────────────────────────────

const TAG = Buffer.from('LazorKit signed message v1', 'utf8');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
/** The format, computed here on its own: tag || SHA-256(tag || message). */
const expectedChallenge = (message) => Buffer.concat([TAG, sha256(TAG, typeof message === 'string' ? Buffer.from(message, 'utf8') : message)]);

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function passkey() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]), uncompressed: Buffer.concat([Buffer.from([4]), x, y]) };
}

/**
 * A WebAuthn assertion as a browser makes one: clientDataJSON carries
 * base64url(challenge), the passkey signs authenticatorData ||
 * SHA-256(clientDataJSON), and the portal sends r || s with a low s.
 */
function assertion(key, challenge, { type = 'webauthn.get', origin = PORTAL, rpId = 'portal.test', flags = 0x05 } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge: Buffer.from(challenge).toString('base64url'), origin, crossOrigin: false }));
    const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
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

/** Each sign request the portal got: its URL parameters. */
const requests = [];
/** What the portal signs, from its `message` parameter: by default, what it decodes to. */
let portalSigns = (message) => Buffer.from(message, 'base64');
const answered = new WeakSet();
const portal = setInterval(() => {
    const iframe = document.getElementById('lazorkit-iframe');
    if (!iframe?.src || answered.has(iframe)) return;
    const url = new URL(iframe.src);
    if (url.searchParams.get('action') !== 'sign') return;
    answered.add(iframe);
    requests.push(url.searchParams);
    window.dispatchEvent(
        new window.MessageEvent('message', {
            origin: PORTAL,
            source: iframe.contentWindow,
            data: { type: 'sign-result', data: assertion(KEY, portalSigns(url.searchParams.get('message'))) },
        }),
    );
}, 5);
after(() => {
    clearInterval(portal);
    window.close();
});

/** The challenge the SDK handed the portal, as bytes. */
const challengeSent = (request) => Buffer.from(request.get('message'), 'base64');

const storedWallet = () => ({
    credentialId: CREDENTIAL_ID,
    passkeyPubkey: [...KEY.compressed],
    smartWallet: W.Keypair.generate().publicKey.toBase58(),
    walletDevice: '',
    vaultPda: W.Keypair.generate().publicKey.toBase58(),
    platform: 'web',
    expo: '',
    protocolVersion: 2,
});

const store = W.useWalletStore;
const config = { rpcUrl: RPC, portalUrl: PORTAL, paymasterConfig: { paymasterUrl: PAYMASTER } };

beforeEach(() => {
    requests.length = 0;
    portalSigns = (message) => Buffer.from(message, 'base64');
    localStorage.clear();
    store.setState({ config, wallet: storedWallet(), isSigning: false, error: null });
});

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('resolved');
}

// ─── The format ─────────────────────────────────────────────────────────────

test('signedMessageChallenge is tag || SHA-256(tag || message): 58 bytes, fixed vectors', () => {
    assert.equal(W.SIGNED_MESSAGE_DOMAIN, 'LazorKit signed message v1');
    const vectors = [
        ['hello', '4c617a6f724b6974207369676e6564206d657373616765207631f0a0cabfe4698ae1261c9e56c6fd10a3800e99ac443a2b499ecead9d79897a21'],
        [new Uint8Array(0), '4c617a6f724b6974207369676e6564206d65737361676520763100e05b0accc59e75916a1f60ee3e1d8686e4f317e55a300f385a752b04f9a695'],
        [new Uint8Array(32), '4c617a6f724b6974207369676e6564206d657373616765207631ad1549f2a749d2e4124c97601838c5bbe5badfcf958e40d7bfdcaddb167cc0d2'],
    ];
    for (const [message, hex] of vectors) {
        assert.equal(Buffer.from(W.signedMessageChallenge(message)).toString('hex'), hex);
    }
    // A string is signed as its UTF-8 bytes.
    assert.deepEqual(W.signedMessageChallenge('héllo ✓'), new Uint8Array(expectedChallenge(Buffer.from('héllo ✓', 'utf8'))));
});

test('no message, of any length, is its own challenge, and no challenge is 32 bytes', () => {
    for (const length of [0, 1, 31, 32, 33, 58, 64, 1000]) {
        for (let i = 0; i < 20; i++) {
            const message = new Uint8Array(randomBytes(length));
            const challenge = W.signedMessageChallenge(message);
            assert.equal(challenge.length, 58);
            assert.deepEqual(Buffer.from(challenge), expectedChallenge(message));
            assert.notDeepEqual(Buffer.from(challenge), Buffer.from(message));
            assert.deepEqual(Buffer.from(challenge.subarray(0, TAG.length)), TAG);
        }
    }
});

// ─── Every signMessage path ─────────────────────────────────────────────────

test("the store's signMessage (the hook's) sends the domain-separated challenge and the text, and returns a verifiable signature", async () => {
    const result = await store.getState().signMessage('Sign in to app.test, nonce 42');
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.deepEqual(challengeSent(request), expectedChallenge('Sign in to app.test, nonce 42'));
    assert.notDeepEqual(challengeSent(request), Buffer.from('Sign in to app.test, nonce 42'));
    assert.equal(request.get('displayMessage'), 'Sign in to app.test, nonce 42');
    assert.equal(request.get('credentialId'), CREDENTIAL_ID);
    assert.deepEqual(Object.keys(result).sort(), ['authenticatorDataBase64', 'clientDataJsonBase64', 'signature', 'signedPayload']);
    assert.equal(store.getState().isSigning, false);
    assert.equal(
        W.verifySignedMessage({ message: 'Sign in to app.test, nonce 42', publicKey: store.getState().wallet.passkeyPubkey, rpId: 'portal.test', origin: PORTAL, ...result }),
        true,
    );
});

test('a 32-byte message through the store is not the challenge: the portal gets its domain-separated one', async () => {
    const message = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 bytes
    assert.equal(Buffer.byteLength(message), 32);
    await store.getState().signMessage(message);
    assert.equal(challengeSent(requests[0]).length, 58);
    assert.deepEqual(challengeSent(requests[0]), expectedChallenge(message));
});

test('LazorkitWalletAdapter.signMessage: a 32-byte message is never the challenge, and the result verifies', async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    const adapter = new W.LazorkitWalletAdapter(config);
    await adapter.connect();
    const message = new Uint8Array(randomBytes(32));
    const signature = await adapter.signMessage(message);

    assert.equal(requests.length, 1);
    assert.deepEqual(challengeSent(requests[0]), expectedChallenge(message));
    assert.notDeepEqual(challengeSent(requests[0]), Buffer.from(message));
    assert.equal(requests[0].get('transaction'), null);
    // Random bytes are not UTF-8 text: nothing to show but the challenge.
    assert.equal(requests[0].get('displayMessage'), null);

    const result = JSON.parse(Buffer.from(signature).toString('utf8'));
    assert.equal(W.verifySignedMessage({ message, publicKey: wallet.passkeyPubkey, ...result }), true);
    assert.equal(W.verifySignedMessage({ message: new Uint8Array(32), publicKey: wallet.passkeyPubkey, ...result }), false);
    await adapter.disconnect();
});

test("Wallet Standard solana:signMessage: the challenge is the domain-separated one, and the output's signature verifies", async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    W.registerLazorkitWallet(config);
    let standardWallet;
    window.dispatchEvent(new window.CustomEvent('wallet-standard:app-ready', { detail: { register: (w) => (standardWallet = w) } }));
    assert.ok(standardWallet);
    const { accounts } = await standardWallet.features['standard:connect'].connect();
    const message = new Uint8Array(Buffer.from('Sign in to app.test'));
    const [output] = await standardWallet.features['solana:signMessage'].signMessage({ account: accounts[0], message });

    assert.equal(requests.length, 1);
    assert.deepEqual(challengeSent(requests[0]), expectedChallenge(message));
    assert.equal(requests[0].get('displayMessage'), 'Sign in to app.test');
    assert.deepEqual(output.signedMessage, message);
    const result = JSON.parse(Buffer.from(output.signature).toString('utf8'));
    assert.equal(W.verifySignedMessage({ message, publicKey: wallet.passkeyPubkey, ...result }), true);
    await standardWallet.features['standard:disconnect'].disconnect();
});

test('DialogManager.openSignMessage sends the domain-separated challenge for a string or bytes', async () => {
    const dialog = new W.DialogManager({ portalUrl: PORTAL });
    try {
        await dialog.openSignMessage('hello', CREDENTIAL_ID);
        await dialog.openSignMessage(new Uint8Array(Buffer.from('hello')), CREDENTIAL_ID);
    } finally {
        dialog.destroy();
    }
    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.deepEqual(challengeSent(request), expectedChallenge('hello'));
        assert.equal(request.get('displayMessage'), 'hello');
    }
});

test('bytes that start with a UTF-8 BOM keep it in displayMessage, so the text round-trips to the signed bytes', async () => {
    const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')]));
    const dialog = new W.DialogManager({ portalUrl: PORTAL });
    try {
        await dialog.openSignMessage(bytes, CREDENTIAL_ID);
    } finally {
        dialog.destroy();
    }
    assert.equal(requests.length, 1);
    const shown = requests[0].get('displayMessage');
    assert.equal(shown, '\uFEFFhi');
    // A portal recomputes the challenge from the UTF-8 of what it shows.
    assert.deepEqual(Buffer.from(shown, 'utf8'), Buffer.from(bytes));
    assert.deepEqual(challengeSent(requests[0]), expectedChallenge(bytes));
});

// ─── A reply over another challenge ─────────────────────────────────────────

test('a portal reply over any other challenge is refused, on the store and the adapter', async () => {
    for (const other of [(message) => Buffer.from(message.slice(0, -2), 'base64'), () => Buffer.from('hello'), () => randomBytes(32)]) {
        portalSigns = other;
        store.setState({ wallet: storedWallet(), isSigning: false, error: null });
        const error = await rejection(store.getState().signMessage('hello'));
        assert.match(error.message, /did not sign this message/);
        assert.equal(store.getState().isSigning, false);
        assert.equal(store.getState().error, error);
    }

    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    const adapter = new W.LazorkitWalletAdapter(config);
    await adapter.connect();
    const errors = [];
    adapter.on('error', (error) => errors.push(error));
    portalSigns = () => Buffer.from('hello');
    const error = await rejection(adapter.signMessage(new Uint8Array(Buffer.from('hello'))));
    assert.match(error.message, /did not sign this message/);
    assert.deepEqual(errors, [error]);
    await adapter.disconnect();
});

// ─── verifySignedMessage ────────────────────────────────────────────────────

/** A message signature as signMessage returns it, made with KEY. */
function signed(message, options) {
    const reply = assertion(KEY, expectedChallenge(message), options);
    return {
        signature: reply.normalized,
        signedPayload: reply.msg,
        clientDataJsonBase64: reply.clientDataJSONReturn,
        authenticatorDataBase64: reply.authenticatorDataReturn,
    };
}

test('verifySignedMessage accepts a valid signature, with the key in every form it takes', () => {
    const result = signed('hello');
    for (const publicKey of [KEY.compressed, KEY.uncompressed, KEY.uncompressed.subarray(1), [...KEY.compressed], KEY.compressed.toString('base64')]) {
        assert.equal(W.verifySignedMessage({ message: 'hello', publicKey, ...result }), true);
    }
    assert.equal(W.verifySignedMessage({ message: new Uint8Array(Buffer.from('hello')), publicKey: KEY.compressed, ...result }), true);
    assert.equal(W.verifySignedMessage({ message: 'hello', publicKey: KEY.compressed, ...result, signature: Buffer.from(result.signature, 'base64') }), true);
    assert.equal(W.verifySignedMessage({ message: 'hello', publicKey: KEY.compressed, rpId: 'portal.test', origin: PORTAL, ...result }), true);
});

test('verifySignedMessage rejects a signature over the raw message bytes, whatever their length', () => {
    for (const message of [new Uint8Array(Buffer.from('hello')), new Uint8Array(randomBytes(32))]) {
        const reply = assertion(KEY, message);
        const raw = {
            signature: reply.normalized,
            signedPayload: reply.msg,
            clientDataJsonBase64: reply.clientDataJSONReturn,
            authenticatorDataBase64: reply.authenticatorDataReturn,
        };
        assert.equal(W.verifySignedMessage({ message, publicKey: KEY.compressed, ...raw }), false);
    }
});

test('verifySignedMessage rejects another message, key, type, relying party or origin, and tampering; never throws', () => {
    const result = signed('hello');
    const verify = (overrides) => W.verifySignedMessage({ message: 'hello', publicKey: KEY.compressed, ...result, ...overrides });
    assert.equal(verify({ message: 'hello!' }), false);
    assert.equal(verify({ publicKey: passkey().compressed }), false);
    assert.equal(verify({ rpId: 'evil.test' }), false);
    assert.equal(verify({ origin: 'http://evil.test' }), false);
    const signature = Buffer.from(result.signature, 'base64');
    signature[10] ^= 1;
    assert.equal(verify({ signature: signature.toString('base64') }), false);
    assert.equal(verify({ signature: Buffer.alloc(64).toString('base64') }), false);
    assert.equal(verify({ signature: Buffer.from(result.signature, 'base64').subarray(0, 63) }), false);
    assert.equal(verify({ signedPayload: Buffer.alloc(69).toString('base64') }), false);
    const authenticatorData = Buffer.from(result.authenticatorDataBase64, 'base64');
    authenticatorData[36] ^= 1;
    assert.equal(verify({ authenticatorDataBase64: authenticatorData.toString('base64') }), false);
    // Signed, but as a registration, or without the user present.
    for (const options of [{ type: 'webauthn.create' }, { flags: 0x04 }]) {
        assert.equal(W.verifySignedMessage({ message: 'hello', publicKey: KEY.compressed, ...signed('hello', options) }), false);
    }
    // Malformed input is false, not an exception.
    for (const overrides of [
        { clientDataJsonBase64: Buffer.from('not json').toString('base64') },
        { clientDataJsonBase64: Buffer.from('null').toString('base64') },
        { authenticatorDataBase64: '' },
        { publicKey: [1, 2, 3] },
        { publicKey: 'not a key' },
        { signature: undefined },
        { message: 42 },
    ]) {
        assert.equal(verify(overrides), false, JSON.stringify(Object.keys(overrides)));
    }
});
