// signMessage signs a domain-separated challenge, never the app's bytes,
// through the built package (`pnpm build` first): the store and the hook open
// the portal in the system browser (stubbed), and a scripted stand-in
// redirects back with no checks of its own — it signs, with a real P-256
// passkey key, whatever its `message` parameter decodes to. Checked: the
// challenge in the portal URL is `tag || SHA-256(tag || message)` for every
// message, a 32-byte one included, and never the message itself; a reply over
// another challenge is refused; `verifySignedMessage` accepts what signMessage
// returns and rejects a signature over the raw bytes. The format's vectors are
// the web SDK's. No network. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');

const PORTAL = 'https://portal.test';
const redirectUrl = 'app://callback';

/** Each portal URL the adapter opened. */
const opened = [];
/** What the portal signs, from its `message` parameter: by default, what it decodes to. */
let portalSigns = (message) => Buffer.from(message, 'base64');

const storage = new Map();
const ReactStub = {
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useDebugValue: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (current) => ({ current }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  createElement: () => null,
  createContext: () => ({ Provider: null }),
  useContext: () => null,
  Fragment: 'Fragment',
};
ReactStub.default = ReactStub;
const STUBS = {
  react: ReactStub,
  'react-native': {
    Platform: { OS: 'ios', select: (options) => options.ios ?? options.default },
    Linking: { addEventListener: () => ({ remove() {} }), openURL: async () => {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
    useColorScheme: () => 'light',
  },
  // The portal, in the system browser: answers each sign request by
  // redirecting to `redirectUrl` with the passkey's assertion.
  'expo-web-browser': {
    openAuthSessionAsync: async (url, redirect) => {
      const request = new URL(url);
      opened.push(request.searchParams);
      const reply = assertion(KEY, portalSigns(request.searchParams.get('message')));
      const back = new URL(redirect);
      back.searchParams.set('success', 'true');
      back.searchParams.set('signature', reply.normalized);
      back.searchParams.set('msg', reply.msg);
      back.searchParams.set('clientDataJSONReturn', reply.clientDataJSONReturn);
      back.searchParams.set('authenticatorDataReturn', reply.authenticatorDataReturn);
      return { type: 'success', url: back.toString() };
    },
  },
  'expo-crypto': {},
  'react-native-get-random-values': {},
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => void storage.set(key, value),
      removeItem: async (key) => void storage.delete(key),
    },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : load.call(this, request, ...rest);
};

const { Connection, Keypair } = require('@solana/web3.js');
const M = require('../dist/index.js');

// The adapter's logger.error.
console.error = () => {};
globalThis.fetch = async (url) => {
  throw new Error(`unexpected fetch ${url}`);
};

// ─── The passkey ────────────────────────────────────────────────────────────

const TAG = Buffer.from('LazorKit signed message v1', 'utf8');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
/** The format, computed here on its own: tag || SHA-256(tag || message). */
const expectedChallenge = (message) =>
  Buffer.concat([TAG, sha256(TAG, typeof message === 'string' ? Buffer.from(message, 'utf8') : message)]);

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function passkey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]) };
}

/** A WebAuthn assertion as a browser makes one, with the low s the portal sends. */
function assertion(key, challenge, { type = 'webauthn.get', origin = PORTAL, rpId = 'portal.test', flags = 0x05 } = {}) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type, challenge: Buffer.from(challenge).toString('base64url'), origin, crossOrigin: false }),
  );
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

const store = M.useWalletStore;
const storedWallet = () => ({
  walletPda: Keypair.generate().publicKey.toBase58(),
  smartWallet: Keypair.generate().publicKey.toBase58(),
  walletDevice: Keypair.generate().publicKey.toBase58(),
  credentialId: CREDENTIAL_ID,
  passkeyPubkey: [...KEY.compressed],
  platform: 'ios',
  protocolVersion: 2,
});

/** The challenge the adapter handed the portal, as bytes. */
const challengeSent = (request) => Buffer.from(request.get('message'), 'base64');

beforeEach(() => {
  opened.length = 0;
  portalSigns = (message) => Buffer.from(message, 'base64');
  store.setState({
    connection: new Connection('http://rpc.test/', { commitment: 'confirmed' }),
    config: { ...store.getState().config, portalUrl: PORTAL },
    wallet: storedWallet(),
    isSigning: false,
    error: null,
  });
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

test("signedMessageChallenge is tag || SHA-256(tag || message): 58 bytes, the web SDK's vectors", () => {
  assert.equal(M.SIGNED_MESSAGE_DOMAIN, 'LazorKit signed message v1');
  const vectors = [
    ['hello', '4c617a6f724b6974207369676e6564206d657373616765207631f0a0cabfe4698ae1261c9e56c6fd10a3800e99ac443a2b499ecead9d79897a21'],
    [new Uint8Array(0), '4c617a6f724b6974207369676e6564206d65737361676520763100e05b0accc59e75916a1f60ee3e1d8686e4f317e55a300f385a752b04f9a695'],
    [new Uint8Array(32), '4c617a6f724b6974207369676e6564206d657373616765207631ad1549f2a749d2e4124c97601838c5bbe5badfcf958e40d7bfdcaddb167cc0d2'],
  ];
  for (const [message, hex] of vectors) {
    assert.equal(Buffer.from(M.signedMessageChallenge(message)).toString('hex'), hex);
  }
  for (const length of [0, 31, 32, 33, 1000]) {
    const message = new Uint8Array(randomBytes(length));
    const challenge = M.signedMessageChallenge(message);
    assert.equal(challenge.length, 58);
    assert.deepEqual(Buffer.from(challenge), expectedChallenge(message));
    assert.notDeepEqual(Buffer.from(challenge), Buffer.from(message));
  }
});

// ─── signMessage ────────────────────────────────────────────────────────────

test('the store and the hook send the domain-separated challenge and the text, and return a verifiable signature', async () => {
  const message = 'Sign in to app.test, nonce 42';
  const fromStore = await store.getState().signMessage(message, { redirectUrl });
  const fromHook = await M.useWallet().signMessage(message, { redirectUrl });
  assert.equal(opened.length, 2);
  for (const request of opened) {
    assert.deepEqual(challengeSent(request), expectedChallenge(message));
    assert.notDeepEqual(challengeSent(request), Buffer.from(message));
    assert.equal(request.get('displayMessage'), message);
    assert.equal(request.get('credentialId'), CREDENTIAL_ID);
    assert.equal(request.get('redirect_url'), redirectUrl);
  }
  for (const result of [fromStore, fromHook]) {
    assert.deepEqual(Object.keys(result).sort(), ['authenticatorDataBase64', 'clientDataJsonBase64', 'signature', 'signedPayload']);
    const publicKey = store.getState().wallet.passkeyPubkey;
    assert.equal(M.verifySignedMessage({ message, publicKey, rpId: 'portal.test', origin: PORTAL, ...result }), true);
    assert.equal(M.verifySignedMessage({ message: 'another message', publicKey, ...result }), false);
  }
  assert.equal(store.getState().isSigning, false);
});

test('a 32-byte message is not the challenge: the portal gets its domain-separated one', async () => {
  const message = 'abcdefghijklmnopqrstuvwxyz012345';
  assert.equal(Buffer.byteLength(message), 32);
  await store.getState().signMessage(message, { redirectUrl });
  assert.equal(challengeSent(opened[0]).length, 58);
  assert.deepEqual(challengeSent(opened[0]), expectedChallenge(message));
});

test('a portal reply over any other challenge is refused, and onFail runs with it', async () => {
  for (const other of [(message) => Buffer.from(message.slice(0, -2), 'base64'), () => Buffer.from('hello'), () => randomBytes(32)]) {
    portalSigns = other;
    store.setState({ wallet: storedWallet(), isSigning: false, error: null });
    const failures = [];
    const error = await rejection(store.getState().signMessage('hello', { redirectUrl, onFail: (e) => failures.push(e) }));
    assert.match(error.message, /did not sign this message/);
    assert.deepEqual(failures, [error]);
    assert.equal(store.getState().isSigning, false);
  }
});

// ─── verifySignedMessage ────────────────────────────────────────────────────

test('verifySignedMessage accepts a valid signature and rejects a raw-bytes one, or any tampering', () => {
  const reply = assertion(KEY, expectedChallenge('hello'));
  const result = {
    signature: reply.normalized,
    signedPayload: reply.msg,
    clientDataJsonBase64: reply.clientDataJSONReturn,
    authenticatorDataBase64: reply.authenticatorDataReturn,
  };
  const verify = (overrides) => M.verifySignedMessage({ message: 'hello', publicKey: KEY.compressed, ...result, ...overrides });
  assert.equal(verify({}), true);
  assert.equal(verify({ publicKey: [...KEY.compressed] }), true);
  assert.equal(verify({ publicKey: KEY.compressed.toString('base64') }), true);

  // Signed over the raw message bytes, whatever their length.
  for (const message of [Buffer.from('hello'), randomBytes(32)]) {
    const raw = assertion(KEY, message);
    assert.equal(
      M.verifySignedMessage({
        message: new Uint8Array(message),
        publicKey: KEY.compressed,
        signature: raw.normalized,
        signedPayload: raw.msg,
        clientDataJsonBase64: raw.clientDataJSONReturn,
        authenticatorDataBase64: raw.authenticatorDataReturn,
      }),
      false,
    );
  }

  assert.equal(verify({ message: 'hello!' }), false);
  assert.equal(verify({ publicKey: passkey().compressed }), false);
  assert.equal(verify({ rpId: 'evil.test' }), false);
  assert.equal(verify({ origin: 'https://evil.test' }), false);
  const signature = Buffer.from(result.signature, 'base64');
  signature[10] ^= 1;
  assert.equal(verify({ signature: signature.toString('base64') }), false);
  assert.equal(verify({ signedPayload: Buffer.alloc(69).toString('base64') }), false);
  assert.equal(verify({ clientDataJsonBase64: Buffer.from('not json').toString('base64') }), false);
  assert.equal(verify({ publicKey: 'not a key' }), false);
});
