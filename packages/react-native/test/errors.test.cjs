// The exported is*Error predicates, through the built package (`pnpm build`
// first): the SDK's own errors, the same errors from a second copy of the
// package, errors wrapped as an app receives them, and raw RPC / paymaster
// shapes. Then a retired v1 wallet's 4018 through the store, against a
// scripted RPC and paymaster, no network. The native modules the package
// loads are stubbed. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const STUBS = {
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
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : load.call(this, request, ...rest);
};

const { Connection, Keypair, SendTransactionError } = require('@solana/web3.js');
const v1Sdk = require('lazorkit-sdk-v1');
const M = require('../dist/index.js');
// A second copy of the package: the same file loaded again, so `instanceof`
// fails between the two (duplicated bundles).
delete require.cache[require.resolve('../dist/index.js')];
const M2 = require('../dist/index.js');

const V2 = M.PROGRAM_ID_DEVNET.toBase58();
const V1 = M.PROGRAM_ID_DEVNET_V1.toBase58();
const INNER = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SIG = '5'.repeat(88);
const PDA = M.PROGRAM_ID_DEVNET;

const hex = { 3006: '0xbbe', 3014: '0xbc6', 4018: '0xfb2' };
/** Logs of a failed instruction: `first` failed first (an inner program, or `top` itself). */
const logsFor = (code, first, top = V2) => [
  `Program ${top} invoke [1]`,
  ...(first === top ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex[code]}`]),
  `Program ${top} failed: custom program error: ${hex[code]}`,
];
const web3Error = (code, first, top) =>
  new SendTransactionError({
    action: 'simulate',
    signature: '',
    transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex[code]}`,
    logs: logsFor(code, first, top),
  });
const korasText = (code) => `Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`;
const paymasterError = (L, message, data) => new L.PaymasterError(message, { code: -32002, data });
const txFailed = (L, code, logs) => new L.TransactionFailedError(SIG, { InstructionError: [0, { Custom: code }] }, 1, logs);
/** A wallet-adapter `WalletError` keeps the original in `error`. */
const walletAdapterWrap = (error) => Object.assign(new Error(error.message), { name: 'WalletSendTransactionError', error });

test('isSignatureReusedError is true for every SignatureReusedError, whatever its cause', () => {
  assert.equal(M.isSignatureReusedError(new M.SignatureReusedError()), true);
  assert.equal(M.isSignatureReusedError(new M.SignatureReusedError(paymasterError(M, korasText(3006)))), true);
  assert.equal(
    M.isSignatureReusedError(
      new M.SignatureReusedError(
        paymasterError(M, 'Transaction simulation failed', { err: { InstructionError: [0, { Custom: 3006 }] }, logs: logsFor(3006, V2) }),
      ),
    ),
    true,
  );
  assert.equal(M.isSignatureReusedError(new M.SignatureReusedError(txFailed(M, 3006))), true);
  assert.equal(M.isSignatureReusedError(new M.SignatureReusedError({ InstructionError: [0, { Custom: 3006 }] })), true);
});

test('isSignatureReusedError is true for one from another copy of the package, and for one wrapped by wallet-adapter', () => {
  assert.ok(!(new M2.SignatureReusedError() instanceof M.SignatureReusedError));
  assert.equal(M.isSignatureReusedError(new M2.SignatureReusedError()), true);
  assert.equal(M2.isSignatureReusedError(new M.SignatureReusedError()), true);
  assert.equal(M.isSignatureReusedError(walletAdapterWrap(new M.SignatureReusedError(txFailed(M, 3006)))), true);
  assert.equal(M.isSignatureReusedError(Object.assign(new Error('x'), { name: 'SignatureReusedError' })), false);
});

test("isSignatureReusedError on raw shapes: the logs decide, and a 3006 without logs counts as LazorKit's", () => {
  assert.equal(M.isSignatureReusedError(web3Error(3006, V2)), true);
  assert.equal(M.isSignatureReusedError(web3Error(3006, INNER)), false);
  assert.equal(M.isSignatureReusedError(new Error('custom program error: 0xbbe')), true);
  assert.equal(M.isSignatureReusedError({ InstructionError: [0, { Custom: 3006 }] }), true);
  assert.equal(M.isSignatureReusedError(paymasterError(M, korasText(3006))), true);
  assert.equal(M.isSignatureReusedError(txFailed(M, 3006, logsFor(3006, INNER))), false);
  assert.equal(M.isSignatureReusedError(new Error('something else')), false);
  assert.equal(M.isSignatureReusedError(undefined), false);
});

test('isDeferredExpiredError reads through wrappers, and still claims no bare 3014', () => {
  assert.equal(M.isDeferredExpiredError(new M.DeferredExpiredError(PDA, SIG, 1000n)), true);
  assert.equal(M.isDeferredExpiredError(new M2.DeferredExpiredError(PDA, SIG, 1000n)), true);
  assert.equal(M.isDeferredExpiredError(walletAdapterWrap(new M.DeferredExpiredError(PDA, SIG, 1000n))), true);
  assert.equal(M.isDeferredExpiredError(new Error('wrapped', { cause: new M2.DeferredExpiredError(PDA, SIG, 1000n) })), true);
  assert.equal(M.isDeferredExpiredError(web3Error(3014, V2)), true);
  assert.equal(M.isDeferredExpiredError(web3Error(3014, INNER)), false);
  assert.equal(M.isDeferredExpiredError(paymasterError(M, korasText(3014))), false);
});

test('isRetiredDeploymentError is true for every V1WalletRetiredError, from either copy, wrapped or not', () => {
  assert.equal(M.isRetiredDeploymentError(new M.V1WalletRetiredError()), true);
  assert.equal(M.isRetiredDeploymentError(new M.V1WalletRetiredError(web3Error(4018, V1, V1))), true);
  assert.equal(M.isRetiredDeploymentError(new M2.V1WalletRetiredError()), true);
  assert.equal(M.isRetiredDeploymentError(walletAdapterWrap(new M.V1WalletRetiredError())), true);
});

test('isRetiredDeploymentError on raw 4018 shapes: Kora text, data-only logs, a TransactionError', () => {
  assert.equal(M.isRetiredDeploymentError(web3Error(4018, V1, V1)), true);
  assert.equal(M.isRetiredDeploymentError(new Error('custom program error: 0xfb2'), 1), true);
  assert.equal(M.isRetiredDeploymentError({ InstructionError: [0, { Custom: 4018 }] }, 1), true);
  assert.equal(M.isRetiredDeploymentError(paymasterError(M, korasText(4018)), 1), true);
  assert.equal(M.isRetiredDeploymentError(paymasterError(M, 'Transaction simulation failed', { logs: logsFor(4018, V1, V1) })), true);
  assert.equal(M.isRetiredDeploymentError(txFailed(M, 4018), 1), true);
  assert.equal(M.isRetiredDeploymentError(paymasterError(M, korasText(4018)), 2), false);
  assert.equal(M.isRetiredDeploymentError(new Error('custom program error: 0x1'), 1), false);
});

// ─── A retired v1 wallet's 4018 through the store ───────────────────

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
let paymasterAnswer;

globalThis.fetch = async (url, init) => {
  assert.equal(String(url), PAYMASTER);
  const { id, method } = JSON.parse(init.body);
  const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
  if (method === 'signAndSendTransaction') return answer({ error: paymasterAnswer });
  throw new Error(`unscripted paymaster ${method}`);
};

function scriptedConnection(deferredExecPda) {
  const fetch = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    if (method === 'getLatestBlockhash') {
      return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
    }
    if (method === 'getAccountInfo' && params[0] === deferredExecPda.toBase58()) {
      const data = Buffer.alloc(176);
      data.writeBigUInt64LE(1000n, 168);
      return reply({
        context: { slot: 500 },
        // Owned by the v1 program: the flow runs as a v1 wallet's.
        value: { data: [data.toString('base64'), 'base64'], executable: false, lamports: 2_000_000, owner: V1, rentEpoch: 0, space: 176 },
      });
    }
    if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
    if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
    throw new Error(`unscripted RPC ${method}`);
  };
  return new Connection(RPC, { commitment: 'confirmed', fetch, disableRetryOnRateLimit: true });
}

/** executeDeferred of a v1 authorization, with the paymaster answering `error`. */
async function executeV1Deferred(error) {
  paymasterAnswer = error;
  const deferredExecPda = Keypair.generate().publicKey;
  M.registerCluster(RPC, 'devnet');
  const store = M.useWalletStore;
  store.setState({
    connection: scriptedConnection(deferredExecPda),
    config: { ...store.getState().config, rpcUrl: RPC, cluster: 'devnet', configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: {
      walletPda: Keypair.generate().publicKey.toBase58(),
      smartWallet: Keypair.generate().publicKey.toBase58(),
      credentialId: 'test',
      protocolVersion: 1,
    },
    isSigning: false,
    error: null,
  });
  const deferredPayload = v1Sdk.deserializeDeferredPayload(
    v1Sdk.serializeDeferredPayload({
      walletPda: Keypair.generate().publicKey,
      deferredExecPda,
      compactInstructions: [],
      remainingAccounts: [],
    }),
  );
  try {
    await store.getState().executeDeferred({ deferredPayload });
  } catch (caught) {
    return caught;
  }
  assert.fail('executeDeferred resolved');
}

test("a retired v1 program's 4018 in Kora's text reaches the app as V1WalletRetiredError", async (t) => {
  t.mock.method(console, 'error', () => {});
  const error = await executeV1Deferred({ code: -32602, message: korasText(4018) });
  assert.ok(error instanceof M.V1WalletRetiredError, `${error.name}: ${error.message}`);
  assert.equal(error.cause.name, 'PaymasterError');
  assert.equal(M.useWalletStore.getState().error, error);
});

test("a retired v1 program's 4018 whose logs are only in the paymaster's data reaches the app as V1WalletRetiredError", async (t) => {
  t.mock.method(console, 'error', () => {});
  const error = await executeV1Deferred({ code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(4018, V1, V1) } });
  assert.ok(error instanceof M.V1WalletRetiredError, `${error.name}: ${error.message}`);
  // Mapped once: the cause is the paymaster's error, not another V1WalletRetiredError.
  assert.equal(error.cause.name, 'PaymasterError');
});
