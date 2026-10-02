// The adapter never stores a session key, through the built package (`pnpm
// build` first): the app generates the session key and keeps it (the README
// shows expo-secure-store), and the adapter only signs with what it is
// handed. A session send against a scripted RPC and paymaster, no network;
// then nothing the adapter wrote to AsyncStorage holds the secret, in any
// encoding. The native modules and `react` are stubbed. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublicKey, verify } = require('node:crypto');

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

const { Connection, Keypair, SystemProgram, VersionedTransaction } = require('@solana/web3.js');

/** base58 (Bitcoin alphabet), as Solana tools print a secret key. */
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}
const sdk = require('@lazorkit/sdk-legacy');
const M = require('../dist/index.js');

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
const sessionPda = Keypair.generate().publicKey;
let owner;
const sent = [];

const rpcFetch = async (_url, init) => {
  const { id, method, params } = JSON.parse(init.body);
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  if (method === 'getLatestBlockhash') {
    return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
  }
  if (method === 'getAccountInfo' && params[0] === sessionPda.toBase58()) {
    return reply({ context: { slot: 1 }, value: { data: ['', 'base64'], executable: false, lamports: 1_000_000, owner, rentEpoch: 0, space: 0 } });
  }
  if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
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
  if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
  if (method === 'signAndSendTransaction') {
    sent.push(VersionedTransaction.deserialize(Buffer.from(params.transaction, 'base64')));
    return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
  }
  throw new Error(`unscripted paymaster ${method}`);
};
console.error = () => {};

test('a session send signs with the keypair the app hands it, and nothing the adapter stores holds its secret', async () => {
  const store = M.useWalletStore;
  const connection = new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true });
  try {
    owner = new sdk.LazorKitClient(connection).programId.toBase58();
  } catch {
    owner = sdk.PROGRAM_ID_MAINNET.toBase58();
  }
  const walletPda = Keypair.generate().publicKey;
  store.setState({
    connection,
    config: { ...store.getState().config, configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: {
      walletPda: walletPda.toBase58(),
      smartWallet: Keypair.generate().publicKey.toBase58(),
      walletDevice: Keypair.generate().publicKey.toBase58(),
      credentialId: 'dGVzdA==',
      passkeyPubkey: [2],
      platform: 'android',
      protocolVersion: 2,
    },
    isSigning: false,
    error: null,
  });

  const sessionKeypair = Keypair.generate();
  const signature = await store.getState().signAndSendWithSession(
    {
      sessionKeypair,
      sessionPda,
      instructions: [SystemProgram.transfer({ fromPubkey: walletPda, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    },
    {},
  );
  assert.equal(typeof signature, 'string');

  // Signed with the app's keypair.
  const tx = sent.at(-1);
  const index = tx.message.staticAccountKeys.findIndex((k) => k.equals(sessionKeypair.publicKey));
  assert.ok(index > 0 && index < tx.message.header.numRequiredSignatures);
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(sessionKeypair.publicKey.toBytes()).toString('base64url') },
    format: 'jwk',
  });
  assert.ok(verify(null, tx.message.serialize(), publicKey, Buffer.from(tx.signatures[index])));

  // Persisted writes are asynchronous: let them land.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(storage.size > 0, 'the adapter did persist its state');
  const seed = Buffer.from(sessionKeypair.secretKey.slice(0, 32));
  const secretForms = [
    JSON.stringify(Array.from(sessionKeypair.secretKey)),
    JSON.stringify(Array.from(seed)),
    base58(sessionKeypair.secretKey),
    base58(seed),
    Buffer.from(sessionKeypair.secretKey).toString('base64'),
    seed.toString('base64'),
    seed.toString('hex'),
  ];
  for (const [key, value] of storage) {
    for (const form of secretForms) assert.ok(!String(value).includes(form), `${key} holds the session secret`);
    assert.ok(!String(value).includes('secretKey'), key);
  }
  const persisted = JSON.parse(storage.get('lazor-wallet-store') ?? storage.values().next().value);
  assert.deepEqual(Object.keys(persisted.state).sort(), ['config', 'wallet']);
});
