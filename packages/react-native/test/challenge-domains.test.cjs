// Ownership proofs are domain-separated too, and a wallet's message signature
// is checked against the key on chain. Through the built package (`pnpm build`
// first), with the system browser stubbed by a scripted portal that signs,
// with a real P-256 passkey key, whatever challenge it is handed, and a
// scripted chain. Checked: `createOwnershipChallenge` is `tag || 32 random
// bytes` (59 bytes, the web SDK's format); connect hands the portal only such
// challenges, on the connect URL and for the proof it asks the portal to sign,
// and the proof over one settles the passkey's key; `verifyWalletMessage` is
// true only for the key the claimed wallet stores on chain for the
// credential. No network. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');

const PORTAL = 'https://portal.test';
const RP_ID = 'portal.test';
const RPC = 'http://rpc.test/';
const PAYMASTER = 'http://paymaster.test/';
const redirectUrl = 'app://callback';

/** Each portal URL the adapter opened: its parameters. */
const opened = [];
/** How the portal answers connect: extra redirect parameters, given the URL's. */
let connectReply = () => ({});

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
  // The portal, in the system browser: answers connect with the passkey's
  // credential and key, and each sign request with an assertion over what
  // its `message` decodes to.
  'expo-web-browser': {
    openAuthSessionAsync: async (url, redirect) => {
      const params = new URL(url).searchParams;
      opened.push(params);
      const back = new URL(redirect);
      back.searchParams.set('success', 'true');
      back.searchParams.set('credentialId', CREDENTIAL_ID);
      const fields =
        params.get('action') === 'connect'
          ? { publicKey: KEY.compressed.toString('base64'), ...connectReply(params) }
          : assertion(KEY, Buffer.from(params.get('message'), 'base64'));
      for (const [name, value] of Object.entries(fields)) back.searchParams.set(name, value);
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

console.error = () => {};
console.warn = () => {};
/** Every URL fetched: only the paymaster is reached this way (the chain has its own fetch). */
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  throw new Error(`unexpected fetch ${url}`);
};

const PROGRAM = M.PROGRAM_ID_DEVNET;

// ─── Formats and the passkey ────────────────────────────────────────────────

const PROOF_TAG = Buffer.from('LazorKit ownership proof v1', 'utf8');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const isProofChallenge = (bytes) => bytes.length === 59 && Buffer.from(bytes.subarray(0, 27)).equals(PROOF_TAG);

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function passkey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]) };
}

/** A WebAuthn assertion as the portal redirects it, with a low s. */
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
    signature: lowS.toString('base64'),
    msg: signedPayload.toString('base64'),
    clientDataJSONReturn: clientDataJSON.toString('base64'),
    authenticatorDataReturn: authenticatorData.toString('base64'),
  };
}

const KEY = passkey();
const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');

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
        const bytes = Buffer.from(memcmp.bytes, 'base64');
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

/** A v2 wallet with an Owner passkey authority, in the layout sdk-legacy reads. */
function walletOnChain({ key = KEY.compressed, credentialId = CREDENTIAL_ID, rpId = RP_ID, role = 0, walletExists = true } = {}) {
  const wallet = Keypair.generate().publicKey;
  const credentialIdHash = sha256(Buffer.from(credentialId, 'base64'));
  const [authorityPda] = M.findAuthorityPda(wallet, credentialIdHash, PROGRAM);
  const data = Buffer.alloc(145);
  data[0] = 0x22;
  data[1] = 1;
  data[2] = role;
  wallet.toBuffer().copy(data, 16);
  credentialIdHash.copy(data, 48);
  Buffer.from(key).copy(data, 80);
  sha256(rpId).copy(data, 113);
  accounts.set(authorityPda.toBase58(), { owner: PROGRAM.toBase58(), data });
  if (walletExists) accounts.set(wallet.toBase58(), { owner: PROGRAM.toBase58(), data: Buffer.alloc(48, 1) });
  return { wallet, vault: M.findVaultPda(wallet, PROGRAM)[0] };
}

const store = M.useWalletStore;

beforeEach(() => {
  opened.length = 0;
  fetched.length = 0;
  rpcCalls = [];
  accounts.clear();
  connectReply = () => ({});
  store.getState().setConfig({
    ...store.getState().config,
    portalUrl: PORTAL,
    rpcUrl: RPC,
    cluster: 'devnet',
    rpId: RP_ID,
    configPaymaster: { paymasterUrl: PAYMASTER },
  });
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

test("createOwnershipChallenge is tag || 32 random bytes: 59 bytes, the web SDK's format", () => {
  assert.equal(M.OWNERSHIP_PROOF_DOMAIN, 'LazorKit ownership proof v1');
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const challenge = M.createOwnershipChallenge();
    assert.ok(isProofChallenge(challenge));
    assert.notEqual(challenge.length, 32);
    assert.notEqual(challenge.length, M.signedMessageChallenge('x').length);
    seen.add(Buffer.from(challenge).toString('hex'));
  }
  assert.equal(seen.size, 100);
});

// ─── connect ────────────────────────────────────────────────────────────────

test("connect asks the portal to sign only tagged proof challenges, and the proof over one settles the passkey's key", async () => {
  await rejection(store.getState().connect({ redirectUrl }));
  // It got as far as creating the wallet for the reported key: the proof verified.
  assert.ok(fetched.some((url) => url === PAYMASTER), `reached the paymaster (${fetched})`);

  assert.deepEqual(opened.map((p) => p.get('action')), ['connect', 'sign']);
  const [connectRequest, signRequest] = opened;
  const connectChallenge = Buffer.from(connectRequest.get('challenge'), 'base64');
  const proofChallenge = Buffer.from(signRequest.get('message'), 'base64');
  assert.ok(isProofChallenge(connectChallenge), 'the connect URL carries a tagged challenge');
  assert.ok(isProofChallenge(proofChallenge), 'the proof the portal signs is over a tagged challenge');
  assert.ok(!connectChallenge.equals(proofChallenge));
  assert.equal(signRequest.get('transaction'), null);
  assert.equal(signRequest.get('credentialId'), CREDENTIAL_ID);
});

test("connect takes the portal's assertion over the tagged connect challenge as the proof, with no second prompt", async () => {
  connectReply = (params) => assertion(KEY, Buffer.from(params.get('challenge'), 'base64'));
  await rejection(store.getState().connect({ redirectUrl }));
  assert.ok(fetched.some((url) => url === PAYMASTER), `reached the paymaster (${fetched})`);
  assert.deepEqual(opened.map((p) => p.get('action')), ['connect']);
  assert.ok(isProofChallenge(Buffer.from(opened[0].get('challenge'), 'base64')));
});

// ─── verifyWalletMessage ────────────────────────────────────────────────────

function signed(message, key = KEY) {
  const reply = assertion(key, M.signedMessageChallenge(message));
  return {
    signature: reply.signature,
    signedPayload: reply.msg,
    clientDataJsonBase64: reply.clientDataJSONReturn,
    authenticatorDataBase64: reply.authenticatorDataReturn,
  };
}

const MESSAGE = 'Sign in to app.test\nNonce: 42';

test("verifyWalletMessage is true only for the key the claimed wallet stores on chain", async () => {
  const { wallet, vault } = walletOnChain();
  const result = signed(MESSAGE);
  const verify = (overrides) =>
    M.verifyWalletMessage({ connection, wallet, credentialId: CREDENTIAL_ID, rpId: RP_ID, message: MESSAGE, ...result, ...overrides });

  assert.equal(await verify({}), true);
  assert.equal(await verify({ wallet: vault.toBase58() }), true);

  // Another passkey's signature, whatever key the client sends along.
  const intruder = passkey();
  assert.equal(await verify({ ...signed(MESSAGE, intruder), publicKey: intruder.compressed }), false);
  // Another wallet, credential, relying party or message.
  assert.equal(await verify({ wallet: Keypair.generate().publicKey }), false);
  assert.equal(await verify({ credentialId: Buffer.from('another credential').toString('base64') }), false);
  assert.equal(await verify({ rpId: 'evil.test' }), false);
  assert.equal(await verify({ message: 'Sign in to evil.test' }), false);
  // A non-Owner authority, and a closed wallet.
  assert.equal(await verify({ wallet: walletOnChain({ role: 1 }).wallet }), false);
  assert.equal(await verify({ wallet: walletOnChain({ walletExists: false }).wallet }), false);

  // A signature over the raw bytes reads nothing and is false.
  const raw = assertion(KEY, Buffer.from(MESSAGE));
  rpcCalls = [];
  assert.equal(
    await verify({ signature: raw.signature, signedPayload: raw.msg, clientDataJsonBase64: raw.clientDataJSONReturn, authenticatorDataBase64: raw.authenticatorDataReturn }),
    false,
  );
  assert.deepEqual(rpcCalls, []);
  assert.equal(await verify({ wallet: 'not an address' }), false);
});
