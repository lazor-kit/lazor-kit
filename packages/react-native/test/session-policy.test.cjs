// What a session may spend, through the built package (`pnpm build` first).
// Under LazorKit v2 a session's actions name what may leave the vault, and
// nothing they do not name may (D13): SOL only with a Sol* action
// (ActionUnlistedSolOutflow, 3037), a token only with a Token* action naming
// its mint (ActionUnlistedTokenOutflow, 3038).
//
// Checked: the actions the README's example builds, as the program reads
// them; the refusals as `UnlistedSolOutflowError` / `UnlistedTokenOutflowError`
// (from either copy of the package, wrapped or raw) and as a session send
// reports them; the error names. A scripted RPC and paymaster, no network.
// The native modules the package loads are stubbed. Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
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

const { Connection, Keypair, SendTransactionError, SystemProgram } = require('@solana/web3.js');
const sdk = require('@lazorkit/sdk-legacy');
const M = require('../dist/index.js');
// A second copy of the package: the same file loaded again, so `instanceof`
// fails between the two (duplicated bundles).
delete require.cache[require.resolve('../dist/index.js')];
const M2 = require('../dist/index.js');

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const USDC = fixed(21);
const V2 = M.PROGRAM_ID_DEVNET.toBase58();
const INNER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ─── The actions ────────────────────────────────────────────────────

test("the README's session actions name SOL and the mint, as the program reads them", () => {
  const actions = [
    M.Actions.solMaxPerTx(10_000_000n),
    M.Actions.tokenMaxPerTx({ mint: USDC, max: 5_000_000n }),
    M.Actions.tokenLimit({ mint: USDC, remaining: 100_000_000n }),
  ];
  const parsed = sdk.parseActions(M.serializeActions(actions)).map(({ type, limit, mint }) => ({ type, limit, mint: mint?.toBase58() }));
  assert.deepEqual(parsed, [
    { type: M.SessionActionType.SolMaxPerTx, limit: 10_000_000n, mint: undefined },
    { type: M.SessionActionType.TokenMaxPerTx, limit: 5_000_000n, mint: USDC.toBase58() },
    { type: M.SessionActionType.TokenLimit, limit: 100_000_000n, mint: USDC.toBase58() },
  ]);
});

// ─── The refusals ───────────────────────────────────────────────────

const hex = { 3037: '0xbdd', 3038: '0xbde' };
/** Logs of a failed instruction: `first` failed first (an inner program, or LazorKit itself). */
const logsFor = (code, first) => [
  `Program ${V2} invoke [1]`,
  ...(first === V2 ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex[code]}`]),
  `Program ${V2} failed: custom program error: ${hex[code]}`,
];
const web3Error = (code, first) =>
  new SendTransactionError({
    action: 'simulate',
    signature: '',
    transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex[code]}`,
    logs: logsFor(code, first),
  });
const korasText = (code) => `Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`;
/** A wallet-adapter `WalletError` keeps the original in `error`. */
const walletAdapterWrap = (error) => Object.assign(new Error(error.message), { name: 'WalletSendTransactionError', error });

test('UnlistedSolOutflowError and UnlistedTokenOutflowError: plain messages, the program codes, recognised from either copy and wrapped', () => {
  const sol = new M.UnlistedSolOutflowError('session');
  assert.equal(sol.message, 'This session is not allowed to spend SOL');
  assert.equal(sol.name, 'UnlistedSolOutflowError');
  assert.equal(sol.code, 3037);
  assert.equal(M.UNLISTED_SOL_OUTFLOW_CODE, 3037);
  assert.equal(new M.UnlistedSolOutflowError('authority').message, 'This key is not allowed to spend SOL');

  const token = new M.UnlistedTokenOutflowError('session');
  assert.equal(token.message, 'This session is not allowed to spend this token');
  assert.equal(token.name, 'UnlistedTokenOutflowError');
  assert.equal(token.code, 3038);
  assert.equal(M.UNLISTED_TOKEN_OUTFLOW_CODE, 3038);

  for (const [is, own, copy] of [
    [M.isUnlistedSolOutflowError, sol, new M2.UnlistedSolOutflowError()],
    [M.isUnlistedTokenOutflowError, token, new M2.UnlistedTokenOutflowError()],
  ]) {
    assert.ok(!(copy instanceof own.constructor));
    assert.equal(is(own), true);
    assert.equal(is(copy), true);
    assert.equal(is(walletAdapterWrap(own)), true);
    assert.equal(is(new Error('wrapped', { cause: copy })), true);
    assert.equal(is(Object.assign(new Error('x'), { name: own.name })), false);
  }
  assert.equal(M.isUnlistedSolOutflowError(token), false);
  assert.equal(M.isUnlistedTokenOutflowError(sol), false);
});

test("the raw 3037 / 3038: the logs decide whose it is, and one with no logs counts as LazorKit's", () => {
  for (const [code, is, other] of [
    [3037, M.isUnlistedSolOutflowError, M.isUnlistedTokenOutflowError],
    [3038, M.isUnlistedTokenOutflowError, M.isUnlistedSolOutflowError],
  ]) {
    assert.equal(is(web3Error(code, V2)), true, `${code} LazorKit's`);
    assert.equal(is(web3Error(code, INNER)), false, `${code} an inner program's`);
    assert.equal(is(walletAdapterWrap(web3Error(code, INNER))), false);
    assert.equal(is(new M.PaymasterError(korasText(code), { code: -32602 })), true);
    assert.equal(is({ InstructionError: [0, { Custom: code }] }), true);
    assert.equal(is(new M.TransactionFailedError('5'.repeat(88), { InstructionError: [0, { Custom: code }] }, 1)), true);
    assert.equal(other(web3Error(code, V2)), false);
  }
  assert.equal(M.isUnlistedSolOutflowError(new Error('custom program error: 0xbdc')), false);
  assert.equal(M.isUnlistedSolOutflowError(undefined), false);
});

test("ERROR_NAMES and errorFromCode name 3036-3038 and 4018, and keep the protocol SDK's names", () => {
  assert.equal(M.ERROR_NAMES[3036], 'SessionNotExpired');
  assert.equal(M.ERROR_NAMES[3037], 'ActionUnlistedSolOutflow');
  assert.equal(M.ERROR_NAMES[3038], 'ActionUnlistedTokenOutflow');
  assert.equal(M.ERROR_NAMES[4018], 'RetiredDeployment');
  assert.equal(M.errorFromCode(3037), 'ActionUnlistedSolOutflow');
  assert.equal(M.errorFromCode(3038), 'ActionUnlistedTokenOutflow');
  assert.equal(M.errorFromCode(3032), 'SessionTokenAuthorityChanged');
  assert.equal(M.errorFromCode(3035), 'PolicyRankMismatch');
  assert.equal(M.errorFromCode(3006), 'SignatureReused');
  assert.equal(M.errorFromCode(1), undefined);
});

// ─── Through the store ──────────────────────────────────────────────

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
/** Accounts that exist: address → owner. */
const accounts = new Map();
/** How a landed transaction ended: `null`, or its TransactionError. */
let landedErr = null;
/** The paymaster's JSON-RPC error for a send, or `null` to send it. */
let refusal = null;
let owner;

const rpcFetch = async (_url, init) => {
  const { id, method, params } = JSON.parse(init.body);
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  if (method === 'getLatestBlockhash') {
    return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
  }
  if (method === 'getAccountInfo') {
    const found = accounts.get(params[0]);
    return reply({
      context: { slot: 1 },
      value: found ? { data: ['', 'base64'], executable: false, lamports: 1_000_000, owner: found, rentEpoch: 0, space: 0 } : null,
    });
  }
  if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
  if (method === 'getSignatureStatuses') {
    return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 600, confirmations: 1, err: landedErr, confirmationStatus: 'confirmed' })) });
  }
  throw new Error(`unscripted RPC ${method}`);
};
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), PAYMASTER);
  const { id, method } = JSON.parse(init.body);
  const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
  if (method === 'signAndSendTransaction') {
    if (refusal) return answer({ error: refusal });
    return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
  }
  throw new Error(`unscripted paymaster ${method}`);
};
// The adapter logs each failed action; keep the output to the assertions.
console.error = () => {};

const store = M.useWalletStore;
const WALLET = fixed(11);

beforeEach(() => {
  accounts.clear();
  landedErr = null;
  refusal = null;
  const connection = new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true });
  try {
    owner = new sdk.LazorKitClient(connection).programId.toBase58();
  } catch {
    owner = sdk.PROGRAM_ID_MAINNET.toBase58();
  }
  store.setState({
    connection,
    config: { ...store.getState().config, configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: {
      walletPda: WALLET.toBase58(),
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
});

/** A session of WALLET's that exists on chain, and its key. */
function session() {
  const sessionKeypair = Keypair.generate();
  const sessionPda = M.findSessionPda(WALLET, sessionKeypair.publicKey.toBytes())[0];
  accounts.set(sessionPda.toBase58(), owner);
  return { sessionKeypair, sessionPda };
}

const transfer = () => [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: fixed(13), lamports: 1000 })];

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('resolved');
}

test("a session send the paymaster refuses for SOL its actions do not name rejects with UnlistedSolOutflowError", async () => {
  refusal = { code: -32602, message: korasText(3037) };
  const failures = [];
  const error = await rejection(
    store.getState().signAndSendWithSession({ ...session(), instructions: transfer() }, { onFail: (e) => failures.push(e) }),
  );
  assert.ok(error instanceof M.UnlistedSolOutflowError, `${error.name}: ${error.message}`);
  assert.equal(error.message, 'This session is not allowed to spend SOL');
  assert.equal(error.signer, 'session');
  assert.equal(error.cause.name, 'PaymasterError');
  assert.deepEqual(failures, [error]);
  assert.equal(store.getState().error, error);
});

test('a session send that lands and fails for a token its actions do not name rejects with UnlistedTokenOutflowError', async () => {
  landedErr = { InstructionError: [0, { Custom: 3038 }] };
  const error = await rejection(store.getState().signAndSendWithSession({ ...session(), instructions: transfer() }, {}));
  assert.ok(error instanceof M.UnlistedTokenOutflowError, `${error.name}: ${error.message}`);
  assert.equal(error.message, 'This session is not allowed to spend this token');
  assert.equal(error.cause.name, 'TransactionFailedError');
});

test("an inner program's 3037, which the logs name, and any other failure are reported as they came", async () => {
  refusal = { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(3037, INNER) } };
  const inner = await rejection(store.getState().signAndSendWithSession({ ...session(), instructions: transfer() }, {}));
  assert.equal(inner.name, 'PaymasterError');

  refusal = null;
  landedErr = { InstructionError: [0, { Custom: 3023 }] };
  const other = await rejection(store.getState().signAndSendWithSession({ ...session(), instructions: transfer() }, {}));
  assert.equal(other.name, 'TransactionFailedError');
});
