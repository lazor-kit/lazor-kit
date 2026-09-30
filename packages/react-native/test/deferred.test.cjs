// Which 3014 is the deferred authorization's expiry, through the built
// package (`pnpm build` first): executeDeferred against a scripted RPC and
// paymaster, no network. The native modules the package loads are stubbed.
// Run with `pnpm test`.
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

const { Connection, Keypair } = require('@solana/web3.js');
const sdk = require('@lazorkit/sdk-legacy');
const M = require('../dist/index.js');

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
const LAZORKIT = M.PROGRAM_ID_DEVNET.toBase58();
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SIGNATURE = '5'.repeat(88);

/** Kora's text for a 3014, which names no program. */
const KORA_3014 = { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(3014))' };
const logs3014 = (first) => ({
  code: -32002,
  message: 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0xbc6',
  data: {
    logs: [
      `Program ${LAZORKIT} invoke [1]`,
      ...(first === LAZORKIT ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: 0xbc6`]),
      `Program ${LAZORKIT} failed: custom program error: 0xbc6`,
    ],
  },
});

function deferredExecData(expiresAt) {
  const data = Buffer.alloc(176);
  data.writeBigUInt64LE(BigInt(expiresAt), 168);
  return data;
}

// What the scripted RPC answers: `reads[n]` for the n-th read of the
// DeferredExec account after the one that finds its program (the last one
// repeats), either one answer or one per commitment; `status` for the
// signature.
let rpc;
let paymaster; // { error } or { signature }
let paymasterSends;
let reads;

function connection(deferredExecPda) {
  let owner;
  const fetch = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    if (method === 'getLatestBlockhash') {
      return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
    }
    if (method === 'getAccountInfo' && params[0] === deferredExecPda.toBase58()) {
      const commitment = params[1]?.commitment ?? 'confirmed';
      // The first read is the one that tells which program wrote it.
      const scripted = reads === null ? { slot: 400, expiresAt: 1000 } : rpc.reads[Math.min(reads.length, rpc.reads.length - 1)];
      if (reads === null) reads = [];
      else reads.push(commitment);
      const step = scripted[commitment] ?? scripted;
      if (step.error) return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: step.error }), { status: 200 });
      if (step.missing) return reply({ context: { slot: step.slot }, value: null });
      return reply({
        context: { slot: step.slot },
        value: {
          data: [deferredExecData(step.expiresAt).toString('base64'), 'base64'],
          executable: false,
          lamports: 2_000_000,
          owner,
          rentEpoch: 0,
          space: 176,
        },
      });
    }
    if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
    if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
    if (method === 'getSignatureStatuses') return reply({ context: { slot: 2000 }, value: [rpc.status] });
    throw new Error(`unscripted RPC ${method}`);
  };
  const conn = new Connection(RPC, { commitment: 'confirmed', fetch, disableRetryOnRateLimit: true });
  try {
    owner = new sdk.LazorKitClient(conn).programId.toBase58();
  } catch {
    owner = sdk.PROGRAM_ID_MAINNET.toBase58();
  }
  return conn;
}

globalThis.fetch = async (url, init) => {
  assert.equal(String(url), PAYMASTER);
  const { id, method } = JSON.parse(init.body);
  const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
  if (method === 'signAndSendTransaction') {
    paymasterSends++;
    return paymaster.error ? answer({ error: paymaster.error }) : answer({ result: { signature: paymaster.signature } });
  }
  throw new Error(`unscripted paymaster ${method}`);
};

beforeEach(() => {
  paymasterSends = 0;
  reads = null;
});

/** executeDeferred with the RPC and paymaster scripted; resolves with what it threw. */
async function executeDeferred(script, answer) {
  rpc = script;
  paymaster = answer;
  const deferredExecPda = Keypair.generate().publicKey;
  const store = M.useWalletStore;
  store.setState({
    connection: connection(deferredExecPda),
    config: { ...store.getState().config, configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: {
      walletPda: Keypair.generate().publicKey.toBase58(),
      smartWallet: Keypair.generate().publicKey.toBase58(),
      credentialId: 'test',
      protocolVersion: 2,
    },
    isSigning: false,
    error: null,
  });
  const deferredPayload = sdk.deserializeDeferredPayload(
    sdk.serializeDeferredPayload({
      walletPda: Keypair.generate().publicKey,
      deferredExecPda,
      compactInstructions: [],
      remainingAccounts: [],
    }),
  );
  try {
    await store.getState().executeDeferred({ deferredPayload });
  } catch (error) {
    return { error, deferredExecPda };
  }
  assert.fail('executeDeferred resolved');
}

const open = { slot: 500, expiresAt: 1000 };
const behind = { error: { code: -32005, message: 'Node is behind by 42 slots' } };
const landed3014 = (slot) => ({ slot, confirmations: null, err: { InstructionError: [0, { Custom: 3014 }] }, confirmationStatus: 'finalized' });

test("an inner program's 3014 is not reported as an expiry when the account cannot be read again", async () => {
  const { error, deferredExecPda } = await executeDeferred({ reads: [open, behind] }, { error: KORA_3014 });
  assert.equal(paymasterSends, 1);
  assert.equal(error.name, 'PaymasterError');
  assert.ok(!(error instanceof M.DeferredExpiredError));
  assert.equal(M.isDeferredExpiredError(error), false);
  assert.ok(error.deferredExecPda.equals(deferredExecPda));
  assert.equal(error.expiresAtSlot, 1000n);
});

test("an inner program's 3014 is not reported as an expiry when the wallet's RPC lacks the account", async () => {
  const { error } = await executeDeferred(
    { reads: [{ slot: 480, missing: true }, { slot: 481, missing: true }] },
    { error: KORA_3014 },
  );
  assert.equal(error.name, 'PaymasterError');
  assert.equal(M.isDeferredExpiredError(error), false);
});

test('logs that name another program as the first to fail with 3014 keep that failure', async () => {
  const { error } = await executeDeferred({ reads: [open, behind] }, { error: logs3014(ATA_PROGRAM) });
  assert.equal(error.name, 'PaymasterError');
  assert.equal(M.isDeferredExpiredError(error), false);
});

test('logs that name LazorKit as the first to fail with 3014 are the expiry, whatever the account reads', async () => {
  const { error, deferredExecPda } = await executeDeferred({ reads: [open, open] }, { error: logs3014(LAZORKIT) });
  assert.ok(error instanceof M.DeferredExpiredError, `${error.name}: ${error.message}`);
  assert.ok(error.deferredExecPda.equals(deferredExecPda));
  assert.equal(error.expiresAtSlot, 1000n);
  assert.equal(M.isDeferredExpiredError(error), true);
});

test('an expiry at the window edge is reported as one although the confirmed read trails the tip', async () => {
  const { error } = await executeDeferred(
    {
      reads: [
        { slot: 998, expiresAt: 1000 },
        { confirmed: { slot: 1000, expiresAt: 1000 }, processed: { slot: 1002, expiresAt: 1000 } },
      ],
    },
    { error: KORA_3014 },
  );
  assert.ok(error instanceof M.DeferredExpiredError, `${error.name}: ${error.message}`);
  assert.equal(error.expiresAtSlot, 1000n);
});

test("a 3014 on chain at or before expires_at is an inner program's, although the account reads as expired by now", async () => {
  const past = { slot: 1500, expiresAt: 1000 };
  const { error } = await executeDeferred({ reads: [open, past], status: landed3014(900) }, { signature: SIGNATURE });
  assert.equal(error.name, 'TransactionFailedError');
  assert.equal(M.isDeferredExpiredError(error), false);
});

test('a 3014 on chain after expires_at is the expiry, although the account reads as open', async () => {
  const { error } = await executeDeferred({ reads: [open, open], status: landed3014(1001) }, { signature: SIGNATURE });
  assert.ok(error instanceof M.DeferredExpiredError, `${error.name}: ${error.message}`);
  assert.equal(error.expiresAtSlot, 1000n);
});

test('any other TX2 failure carries the authorization it was for', async () => {
  const { error, deferredExecPda } = await executeDeferred(
    {
      reads: [open],
      status: { slot: 600, confirmations: null, err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'finalized' },
    },
    { signature: SIGNATURE },
  );
  assert.equal(error.name, 'TransactionFailedError');
  assert.ok(error.deferredExecPda.equals(deferredExecPda));
  assert.equal(error.expiresAtSlot, 1000n);
});

test('isDeferredExpiredError is true for every DeferredExpiredError, and not for a bare 3014', async () => {
  const pda = Keypair.generate().publicKey;
  assert.equal(M.isDeferredExpiredError(new M.DeferredExpiredError(pda, 'sig', 1000n)), true);
  const copy = Object.assign(new Error('expired'), { name: 'DeferredExpiredError', code: M.DEFERRED_EXPIRED_CODE });
  assert.equal(M.isDeferredExpiredError(copy), true);
  const { error } = await executeDeferred({ reads: [{ slot: 1001, expiresAt: 1000 }] }, { error: KORA_3014 });
  assert.equal(paymasterSends, 0);
  assert.ok(error instanceof M.DeferredExpiredError);
  assert.equal(M.isDeferredExpiredError(error), true);
  assert.equal(M.isDeferredExpiredError(new Error(KORA_3014.message)), false);
  assert.equal(M.isDeferredExpiredError(Object.assign(new Error(logs3014(LAZORKIT).message), logs3014(LAZORKIT).data)), true);
  assert.equal(M.isDeferredExpiredError(Object.assign(new Error(logs3014(ATA_PROGRAM).message), logs3014(ATA_PROGRAM).data)), false);
});
