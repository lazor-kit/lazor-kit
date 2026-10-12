// The 3.0.0-next.1 fixes, through the built package (`pnpm build` first),
// with the system browser stubbed by a scripted portal and @lazorkit/wallet's
// scripted chain and paymaster (test/helpers/chain.mjs), no network:
// - the default devnet paymaster is the v2 relayer;
// - the send policy and the compute-budget code are @lazorkit/wallet's;
// - a passkey send: SetComputeUnitLimit first; LazorKit's 3007 is
//   SignatureTooOldError, sent once, and calling it again asks again; a
//   refusal that cannot change is sent once; a lost answer is sent again,
//   the same bytes, only while the blockhash is valid; the slot is read
//   last, right before the browser opens;
// - the browser: a trip that never comes back ends in PortalTimeoutError;
//   iOS opens an ephemeral session unless told not to, and waits for the
//   last session to be gone before opening the next;
// - connect: a passkey registered just now, reported through the iOS
//   authentication session, needs no second trip (never through a deep
//   link); a creation whose answer was lost uses the same seed again.
// The native modules the package loads are stubbed. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach, before } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PORTAL = 'https://portal.test';
const RP_ID = 'portal.test';
const redirectUrl = 'app://callback';

// ─── The system browser, scripted ───────────────────────────────────────────

/** Each browser trip: { url, at (ms), options }. */
const opened = [];
/** How the portal answers: `(url) => redirect parameters`, or 'hang' (never comes back). */
let answer;
/** RPC methods called so far, at each browser trip. */
const atOpen = [];
let deepLinkHandler = null;
const Platform = { OS: 'ios', select: (options) => options[Platform.OS] ?? options.default };

function redirectFor(url, redirect) {
  const back = new URL(redirect);
  for (const [name, value] of Object.entries(answer(new URL(url)))) back.searchParams.set(name, value);
  return back.toString();
}

const STUBS = {
  react: (() => {
    const R = {
      useSyncExternalStore: (_s, get) => get(),
      useDebugValue: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (current) => ({ current }),
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      createElement: () => null,
      createContext: () => ({ Provider: null }),
      useContext: () => null,
      Fragment: 'Fragment',
    };
    R.default = R;
    return R;
  })(),
  'react-native': {
    Platform,
    Linking: {
      addEventListener: (_type, handler) => {
        deepLinkHandler = handler;
        return { remove() {} };
      },
      openURL: async () => {},
    },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
    useColorScheme: () => 'light',
  },
  'expo-web-browser': {
    openAuthSessionAsync: (url, redirect, options) => {
      opened.push({ url: new URL(url), at: Date.now(), options });
      atOpen.push(chain ? chain.state.rpcCalls.map((c) => c.method) : []);
      if (answer === 'hang') return new Promise(() => {});
      return Promise.resolve({ type: 'success', url: redirectFor(url, redirect) });
    },
    dismissAuthSession: () => {},
    dismissBrowser: () => {},
    // Android: the tab opens; the portal's redirect comes as a deep link.
    openBrowserAsync: async (url) => {
      opened.push({ url: new URL(url), at: Date.now() });
      if (answer === 'hang') return { type: 'opened' };
      setTimeout(() => deepLinkHandler?.({ url: redirectFor(url, redirectUrl) }), 0);
      return { type: 'opened' };
    },
  },
  'expo-crypto': {},
  'react-native-get-random-values': {},
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : load.call(this, request, ...rest);
};

const { Connection, PublicKey, SystemProgram } = require('@solana/web3.js');
const M = require('../dist/index.js');
console.error = () => {};
console.warn = () => {};

let chain;
let RPC;
let PAYMASTER;
before(async () => {
  const helpers = await import('../../react/test/helpers/chain.mjs');
  chain = helpers.scriptedChain(M);
  RPC = helpers.RPC;
  PAYMASTER = helpers.PAYMASTER;
});

// ─── The passkey and the portal ─────────────────────────────────────────────

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
let counter = 0;
function passkey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]), rawId: Buffer.from(`mobile passkey ${++counter}`) };
}
function assertion(key, challengeB64url) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: challengeB64url, origin: PORTAL, crossOrigin: false }));
  const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
  const payload = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  const signature = sign('sha256', payload, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  let s = BigInt('0x' + signature.subarray(32).toString('hex'));
  if (s > P256_N / 2n) s = P256_N - s;
  return {
    success: 'true',
    credentialId: key.rawId.toString('base64'),
    signature: Buffer.concat([signature.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]).toString('base64'),
    msg: payload.toString('base64'),
    clientDataJSONReturn: clientDataJSON.toString('base64'),
    authenticatorDataReturn: authenticatorData.toString('base64'),
  };
}
let key;
/** The portal: a new passkey at connect (`kind=created`), and it signs whatever it is handed. */
const portal = (url) =>
  url.searchParams.get('action') === 'connect'
    ? { success: 'true', credentialId: key.rawId.toString('base64'), publicKey: key.compressed.toString('base64'), kind: 'created' }
    : assertion(key, url.searchParams.get('message'));

// ─── The store ──────────────────────────────────────────────────────────────

const store = M.useWalletStore;

function configure(extra = {}) {
  store.getState().setConfig({
    portalUrl: PORTAL,
    configPaymaster: { paymasterUrl: PAYMASTER },
    rpcUrl: RPC,
    cluster: 'devnet',
    rpId: RP_ID,
    onConfirmWallet: 'throw',
    ...extra,
  });
  store.setState({
    connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => chain.fetch(RPC, init), disableRetryOnRateLimit: true }),
  });
}

beforeEach(async () => {
  globalThis.fetch = (url, init) => chain.fetch(url, init);
  Platform.OS = 'ios';
  chain.reset();
  opened.length = 0;
  atOpen.length = 0;
  answer = portal;
  key = passkey();
  store.setState({ wallet: null, isSigning: false, isConnecting: false, error: null });
  configure();
});

const connect = () => store.getState().connect({ redirectUrl });
const send = (transactionOptions) =>
  store.getState().signAndExecuteTransaction(
    {
      instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(store.getState().wallet.smartWallet), toPubkey: chain.PROGRAM, lamports: 1 })],
      ...(transactionOptions ? { transactionOptions } : {}),
    },
    { redirectUrl },
  );
const rejection = (promise) => promise.then(() => assert.fail('expected a rejection'), (e) => e);
const programsOf = (tx) => tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
const korasRefusal = (code) => (_tx, { answer: reply }) =>
  reply({ error: { code: -32000, message: `Invalid transaction: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x${code.toString(16)}` } });
const createdWallets = () =>
  chain.state.sent.flatMap((tx) => {
    const keys = tx.message.staticAccountKeys;
    return tx.message.compiledInstructions
      .filter((ix) => keys[ix.programIdIndex].equals(chain.PROGRAM) && ix.data[0] === 0)
      .map((ix) => keys[ix.accountKeyIndexes[1]].toBase58());
  });

// ─── Defaults and shared code ───────────────────────────────────────────────

test('the default devnet paymaster is the v2 relayer', () => {
  assert.equal(M.DEFAULTS.PAYMASTER_URL, 'https://kora-devnet-production.up.railway.app');
});

test('the send policy, compute-budget and blockhash code are the same source as @lazorkit/wallet\'s', () => {
  const strip = (file) => readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).join('\n');
  const pairs = [
    ['src/core/sendPolicy.ts', '../react/core/paymaster/sendPolicy.ts'],
    ['src/core/wallet/computeBudget.ts', '../react/core/wallet/computeBudget.ts'],
    ['src/core/wallet/blockhash.ts', '../react/core/wallet/blockhash.ts'],
  ];
  for (const [mine, web] of pairs) {
    assert.equal(strip(path.join(__dirname, '..', mine)), strip(path.join(__dirname, '..', web)), mine);
  }
});

// ─── Connect ────────────────────────────────────────────────────────────────

test('iOS: a passkey registered just now, reported through the auth session: its wallet is created with no second trip', async () => {
  const wallet = await connect();
  assert.equal(opened.length, 1, 'one browser trip');
  assert.equal(wallet.protocolVersion, 2);
  assert.deepEqual(createdWallets(), [wallet.walletPda]);
});

test('Android: the same reply as a deep link is not trusted: the key is proven with a second trip first', async () => {
  Platform.OS = 'android';
  const wallet = await connect();
  assert.equal(opened.length, 2, 'connect, then the ownership proof');
  assert.equal(opened[1].url.searchParams.get('action'), 'sign');
  assert.deepEqual(createdWallets(), [wallet.walletPda]);
});

test('connect: a creation whose answer is lost, then connect again: the same seed, one wallet', async () => {
  chain.state.mode = 'drop';
  const first = await rejection(connect());
  assert.equal(first.name, 'TransactionOutcomeUnknownError', first.message);
  const tried = new Set(createdWallets());
  assert.equal(tried.size, 1);
  chain.state.mode = null;
  const wallet = await connect();
  assert.equal(wallet.walletPda, [...tried][0], 'the retry creates that wallet, not another');
});

test('connect: the creation landed but its answer was lost: found, and connected, with one wallet', async () => {
  chain.state.mode = 'lose-answer';
  const wallet = await connect();
  assert.equal(new Set(createdWallets()).size, 1);
  assert.deepEqual(createdWallets()[0], wallet.walletPda);
});

// ─── A passkey send ─────────────────────────────────────────────────────────

test('computeUnitLimit: SetComputeUnitLimit first, before the precompile; a bad one is refused before the browser opens', async () => {
  await connect();
  opened.length = 0;
  chain.state.sent.length = 0;
  await send({ computeUnitLimit: 60_000 });
  const programs = programsOf(chain.state.sent[0]);
  assert.deepEqual(programs.slice(0, 3), ['ComputeBudget111111111111111111111111111111', 'Secp256r1SigVerify1111111111111111111111111', chain.PROGRAM.toBase58()]);
  opened.length = 0;
  const error = await rejection(send({ computeUnitLimit: 2_000_000 }));
  assert.match(error.message, /computeUnitLimit must be a whole number/);
  assert.equal(opened.length, 0, 'no browser');
});

test('an untyped Execute reads its slot last: after the preview blockhash, right before the browser opens', async () => {
  await connect();
  chain.state.rpcCalls.length = 0;
  atOpen.length = 0;
  await send();
  const before = atOpen[0];
  const slot = before.lastIndexOf('getSlot');
  assert.ok(slot >= 0, before.join(' '));
  assert.ok(before.lastIndexOf('getLatestBlockhash') < slot, before.join(' '));
});

test('3007: SignatureTooOldError, sent once, "Approval took too long"; calling it again asks again and lands', async () => {
  await connect();
  chain.state.sent.length = 0;
  opened.length = 0;
  chain.state.paymasterScript.push(korasRefusal(3007));
  const error = await rejection(send());
  assert.ok(error instanceof M.SignatureTooOldError, error.name);
  assert.equal(chain.state.sent.length, 1, 'not resent');
  const d = M.describeError(error);
  assert.equal(d.code, 'program-3007');
  assert.equal(d.title, 'Approval took too long');
  assert.equal(d.retryable, true);
  assert.equal(d.maybeSent, false);
  await send();
  assert.equal(opened.length, 2, 'a new approval for the retry');
});

test('a refusal that cannot change is sent once; a lost answer is sent again, the same bytes, while the blockhash is valid', async () => {
  await connect();
  chain.state.sent.length = 0;
  chain.state.paymasterScript.push(korasRefusal(3008));
  await rejection(send());
  assert.equal(chain.state.sent.length, 1, '3008: once');

  chain.state.sent.length = 0;
  chain.state.paymasterScript.push(() => new Response('', { status: 502 }));
  const signature = await send();
  assert.equal(typeof signature, 'string');
  assert.equal(chain.state.sent.length, 2, 'the 502, then the same bytes again');
  assert.deepEqual(Buffer.from(chain.state.sent[0].message.serialize()), Buffer.from(chain.state.sent[1].message.serialize()));

  chain.state.sent.length = 0;
  chain.state.blockHeight = 2e9; // past every blockhash here
  chain.state.paymasterScript.push(() => new Response('', { status: 502 }));
  const lost = await rejection(send());
  assert.equal(chain.state.sent.length, 1, 'not resent once the blockhash expired');
  assert.equal(M.describeError(lost).maybeSent, true, 'it may still have been sent');
});

// ─── The browser ────────────────────────────────────────────────────────────

test('a browser trip that never comes back: PortalTimeoutError once the timeout passes, "Couldn\'t open the approval page"', async () => {
  configure({ browser: { timeoutMs: 120 } });
  answer = 'hang';
  const started = Date.now();
  const error = await rejection(connect());
  assert.ok(error instanceof M.PortalTimeoutError, error.name);
  assert.ok(Date.now() - started < 2_000);
  const d = M.describeError(error);
  assert.equal(d.code, 'browser-failed');
  assert.equal(d.retryable, true);
  assert.equal(store.getState().isConnecting, false, 'connect is over');
  Platform.OS = 'android';
  const android = await rejection(connect());
  assert.ok(android instanceof M.PortalTimeoutError, android.name);
});

test('iOS: an ephemeral session by default; browserOptions.preferEphemeralSession: false shares it', async () => {
  await connect();
  assert.equal(opened[0].options.preferEphemeralSession, true);
  store.setState({ wallet: null });
  key = passkey();
  configure({ browser: { preferEphemeralSession: false } });
  await connect();
  assert.equal(opened[1].options.preferEphemeralSession, false);
});

test('iOS: the next auth session opens only once the last one has had time to go', async () => {
  await connect();
  const first = Date.now();
  await send();
  assert.ok(opened[1].at - first >= 0);
  assert.ok(opened[1].at - opened[0].at >= 700, `${opened[1].at - opened[0].at} ms between sessions`);
});
