// When an action's onSuccess / onFail run, and what they can change, through
// the built package (`pnpm build` first): the store and the hook against a
// scripted RPC and paymaster where every transaction lands, no network. The
// native modules are stubbed, and so is `react`, so the hook can be called
// outside a renderer. The contract, the same as the web SDK's:
// - C1 the callback runs once `isSigning` / `isConnecting` is false again,
//   right before the promise settles;
// - C2 exactly one callback per call, agreeing with the promise, refusals
//   included;
// - C3 what a callback throws changes nothing;
// - C4 a send started from a callback runs;
// - C5 every declared callback is honoured (store and hook connect and
//   disconnect).
// Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

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
    Platform: { OS: 'android', select: (options) => options.android ?? options.default },
    Linking: { addEventListener: () => ({ remove() {} }), openURL: async () => {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
    useColorScheme: () => 'light',
  },
  'expo-web-browser': {},
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
const sdk = require('@lazorkit/sdk-legacy');
const M = require('../dist/index.js');

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
/** DeferredExec accounts that exist, with an authorization still open. */
const openAuthorizations = new Set();
let owner;
let sends = 0;

const rpcFetch = async (_url, init) => {
  const { id, method, params } = JSON.parse(init.body);
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  if (method === 'getLatestBlockhash') {
    return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
  }
  if (method === 'getAccountInfo' && openAuthorizations.has(params[0])) {
    const data = Buffer.alloc(176);
    data.writeBigUInt64LE(1000n, 168);
    return reply({
      context: { slot: 500 },
      value: { data: [data.toString('base64'), 'base64'], executable: false, lamports: 2_000_000, owner, rentEpoch: 0, space: 176 },
    });
  }
  if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
  if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
  // Every transaction lands, successfully.
  if (method === 'getSignatureStatuses') {
    return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 600, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
  }
  throw new Error(`unscripted RPC ${method}`);
};
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), PAYMASTER);
  const { id, method } = JSON.parse(init.body);
  const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
  if (method === 'signAndSendTransaction') {
    sends++;
    return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
  }
  throw new Error(`unscripted paymaster ${method}`);
};

// The adapter's logger.error; what a callback throws is logged there.
const logged = [];
console.error = (...args) => logged.push(args);

const store = M.useWalletStore;
const storedWallet = () => ({
  walletPda: Keypair.generate().publicKey.toBase58(),
  smartWallet: Keypair.generate().publicKey.toBase58(),
  walletDevice: Keypair.generate().publicKey.toBase58(),
  credentialId: 'dGVzdA==',
  passkeyPubkey: [2],
  platform: 'android',
  protocolVersion: 2,
});

beforeEach(() => {
  logged.length = 0;
  const connection = new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true });
  try {
    owner = new sdk.LazorKitClient(connection).programId.toBase58();
  } catch {
    owner = sdk.PROGRAM_ID_MAINNET.toBase58();
  }
  store.setState({
    connection,
    config: { ...store.getState().config, configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: storedWallet(),
    isSigning: false,
    isConnecting: false,
    error: null,
  });
});

/** A deferred payload whose authorization is open: executeDeferred sends it, and it lands. */
function deferredPayload() {
  const deferredExecPda = Keypair.generate().publicKey;
  openAuthorizations.add(deferredExecPda.toBase58());
  return sdk.deserializeDeferredPayload(
    sdk.serializeDeferredPayload({
      walletPda: Keypair.generate().publicKey,
      deferredExecPda,
      compactInstructions: [],
      remainingAccounts: [],
    }),
  );
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('resolved');
}

const redirectUrl = 'app://callback';

test('C1, C4: onSuccess runs once isSigning is false, and a send started from it runs', async () => {
  let signingInCallback;
  let nested;
  await store.getState().executeDeferred(
    { deferredPayload: deferredPayload() },
    {
      onSuccess: () => {
        signingInCallback = store.getState().isSigning;
        nested = store.getState().executeDeferred({ deferredPayload: deferredPayload() });
      },
    },
  );
  assert.equal(signingInCallback, false);
  assert.equal(typeof (await nested), 'string');
});

test('C3: a throwing onSuccess does not turn a landed transaction into a failure', async () => {
  const before = sends;
  const failures = [];
  const signature = await store.getState().executeDeferred(
    { deferredPayload: deferredPayload() },
    {
      onSuccess: () => {
        throw new Error('app bug in onSuccess');
      },
      onFail: (error) => failures.push(error),
    },
  );
  assert.equal(sends - before, 1);
  assert.equal(typeof signature, 'string');
  assert.deepEqual(failures, []);
  assert.equal(store.getState().error, null);
});

test('C1, C5: store.connect calls onSuccess once isConnecting is false', async () => {
  const wallet = store.getState().wallet;
  const calls = [];
  const connected = await store.getState().connect({
    redirectUrl,
    onSuccess: (result) => calls.push([result, store.getState().isConnecting]),
    onFail: (error) => calls.push(error),
  });
  assert.equal(connected, wallet);
  assert.deepEqual(calls, [[wallet, false]]);
});

test('C3, C5: the hook\'s connect calls onSuccess once, and a throwing one does not fail it', async () => {
  const wallet = store.getState().wallet;
  const calls = [];
  const connected = await M.useWallet().connect({
    redirectUrl,
    onSuccess: (result) => {
      calls.push(result);
      throw new Error('app bug in onSuccess');
    },
    onFail: (error) => calls.push(error),
  });
  assert.equal(connected, wallet);
  assert.deepEqual(calls, [wallet]);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().wallet, wallet);
});

test('C1, C2: a connect that fails calls onFail once isConnecting is false, with the error it rejects with', async () => {
  const calls = [];
  const error = await rejection(
    store.getState().connect({
      redirectUrl,
      confirmWallet: Keypair.generate().publicKey.toBase58(),
      onSuccess: () => calls.push('onSuccess'),
      onFail: (e) => calls.push([e, store.getState().isConnecting]),
    }),
  );
  assert.match(error.message, /is not the connected wallet/);
  assert.deepEqual(calls, [[error, false]]);
  assert.equal(store.getState().error, error);
});

test('C2: a connect refused while one runs calls its onFail, and leaves error (the running one\'s) alone', async () => {
  const running = new Error('the running connect');
  store.setState({ isConnecting: true, error: running });
  const calls = [];
  const error = await rejection(store.getState().connect({ redirectUrl, onFail: (e) => calls.push(e) }));
  assert.equal(error.message, 'Already connecting');
  assert.deepEqual(calls, [error]);
  assert.equal(store.getState().error, running);
});

test('C3, C5: disconnect honours its callbacks, from the store and from the hook', async () => {
  const calls = [];
  await store.getState().disconnect({ onSuccess: () => calls.push('store onSuccess'), onFail: (e) => calls.push(e) });
  assert.deepEqual(calls, ['store onSuccess']);
  assert.equal(store.getState().wallet, null);

  store.setState({ wallet: storedWallet() });
  await M.useWallet().disconnect({
    onSuccess: () => {
      calls.push('hook onSuccess');
      throw new Error('app bug in onSuccess');
    },
    onFail: (e) => calls.push(e),
  });
  assert.deepEqual(calls, ['store onSuccess', 'hook onSuccess']);
  assert.equal(store.getState().wallet, null);
});

/** Every action that takes callbacks, called with `callbacks`. */
const actions = {
  signAndExecuteTransaction: (callbacks) => store.getState().signAndExecuteTransaction({ instructions: [] }, { redirectUrl, ...callbacks }),
  signMessage: (callbacks) => store.getState().signMessage('hello', { redirectUrl, ...callbacks }),
  createSession: (callbacks) =>
    store.getState().createSession({ sessionKey: Keypair.generate().publicKey, expiresAtSlot: 1n, unrestricted: true }, { redirectUrl, ...callbacks }),
  revokeSession: (callbacks) => store.getState().revokeSession({ sessionPda: Keypair.generate().publicKey }, { redirectUrl, ...callbacks }),
  signAndSendWithSession: (callbacks) =>
    store.getState().signAndSendWithSession(
      { sessionPda: Keypair.generate().publicKey, sessionKeypair: Keypair.generate(), instructions: [] },
      callbacks,
    ),
  addAuthorityEd25519: (callbacks) =>
    store.getState().addAuthorityEd25519({ newEd25519Pubkey: Keypair.generate().publicKey, role: 1 }, { redirectUrl, ...callbacks }),
  removeAuthority: (callbacks) =>
    store.getState().removeAuthority({ targetAuthorityPda: Keypair.generate().publicKey }, { redirectUrl, ...callbacks }),
  authorizeAndExecute: (callbacks) => store.getState().authorizeAndExecute({ instructions: [] }, { redirectUrl, ...callbacks }),
  authorizeDeferred: (callbacks) => store.getState().authorizeDeferred({ instructions: [] }, { redirectUrl, ...callbacks }),
  executeDeferred: (callbacks) => store.getState().executeDeferred({ deferredPayload: deferredPayload() }, callbacks),
  reclaimDeferred: (callbacks) => store.getState().reclaimDeferred({ deferredExecPda: Keypair.generate().publicKey }, callbacks),
  transferSol: (callbacks) => store.getState().transferSol({ recipient: feePayer, lamports: 1 }, { redirectUrl, ...callbacks }),
};

test("C2: a call refused while another is signing calls its onFail, and leaves error (the running call's) alone", async () => {
  for (const [name, call] of Object.entries(actions)) {
    const running = new Error('the running call');
    store.setState({ isSigning: true, error: running });
    const calls = [];
    const error = await rejection(call({ onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) }));
    assert.equal(error.name, 'SigningError', name);
    assert.deepEqual(calls, [error], name);
    assert.equal(store.getState().error, running, name);
  }
});

test('C2: a call refused for want of a wallet calls its onFail, and records the error', async () => {
  for (const [name, call] of Object.entries(actions)) {
    store.setState({ isSigning: false, error: null, wallet: null });
    const calls = [];
    const error = await rejection(call({ onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) }));
    assert.equal(error.message, 'No wallet connected', name);
    assert.deepEqual(calls, [error], name);
    assert.equal(store.getState().error, error, name);
    assert.equal(store.getState().isSigning, false, name);
  }
});
