// Typed approval requests through the redirect channel, through the built
// package (`pnpm build` first), with the system browser stubbed by a
// scripted portal and a scripted chain and paymaster, no network.
// createSession, revokeSession and removeAuthority on a v2 wallet open the
// portal with the operation's parameters in the URL fragment (`#/?lk1=…`)
// and the query 2.x sent; the redirect's `typed*` parameters are checked
// against what the adapter prepared before anything is sent.
//
// Checked: the request the portal gets (and that it passes the portal's own
// query check); a typed reply finalizes at the portal's slot and counter; a
// reply without one at the prepared ones; a reply that does not match (a
// forged deep link included) is `PortalReplyMismatchError` and nothing is
// sent; the portal's refusals (`type=error&code=…`); the session's expiry in
// seconds of the cluster clock (`expiresInSeconds`, `expiresAt`, the
// deprecated `expiresAtSlot`); actions over the transaction's room, refused
// before the portal opens; the URL cap; v1 wallets (no typed request, the
// prepared challenge, slot expiry). Run with `pnpm test`.
'use strict';
const Module = require('module');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PORTAL = 'https://portal.test';
const RPC = 'http://rpc.test/';
const PAYMASTER = 'http://paymaster.test/';
const redirectUrl = 'app://callback';

/** Each portal URL the adapter opened. */
const opened = [];
/** How the portal answers a sign request: `(url) => redirect parameters`. */
let answer;

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
  // The portal, in the system browser.
  'expo-web-browser': {
    openAuthSessionAsync: async (url, redirect) => {
      const parsed = new URL(url);
      opened.push(parsed);
      const back = new URL(redirect);
      for (const [name, value] of Object.entries(answer(parsed))) back.searchParams.set(name, value);
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

const { Connection, Keypair, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { createHash } = require('node:crypto');
const A = require('@lazorkit/sdk-legacy/approval');
const sdk = require('@lazorkit/sdk-legacy');
const M = require('../dist/index.js');

const warnings = [];
console.error = () => {};
console.warn = (...args) => warnings.push(args.map(String).join(' '));

// ─── A scripted chain and paymaster ─────────────────────────────────────────

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const PROGRAM = M.PROGRAM_ID_DEVNET;
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const CREDENTIAL = Buffer.from('a mobile passkey credential');
const CREDENTIAL_ID = CREDENTIAL.toString('base64');
const STORED_COUNTER = 9;
const CHAIN_SLOT = 5000;
const CLUSTER_TIME = 1_791_633_600n;
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
const credentialIdHash = createHash('sha256').update(CREDENTIAL).digest();
const [AUTHORITY] = M.findAuthorityPda(WALLET, credentialIdHash, PROGRAM);

const accounts = new Map();
const sent = [];
let performanceSamples;

function authorityAccount() {
  const data = Buffer.alloc(145);
  data[0] = 0x22;
  data[1] = 1;
  data.writeUInt32LE(STORED_COUNTER, 8);
  WALLET.toBuffer().copy(data, 16);
  credentialIdHash.copy(data, 48);
  data[80] = 2;
  data.fill(0x11, 81, 113);
  return { owner: PROGRAM.toBase58(), data };
}

function clockAccount() {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(BigInt(CHAIN_SLOT), 0);
  data.writeBigInt64LE(CLUSTER_TIME, 32);
  return { owner: 'Sysvar1111111111111111111111111111111111111', data };
}

const account = ({ owner, data = Buffer.alloc(0) }) => ({
  data: [data.toString('base64'), 'base64'],
  executable: false,
  lamports: 2_000_000,
  owner,
  rentEpoch: 0,
  space: data.length,
});

async function rpc(init) {
  const { id, method, params } = JSON.parse(init.body);
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
  const get = (address) => (address === CLOCK_SYSVAR ? clockAccount() : accounts.get(address));
  switch (method) {
    case 'getLatestBlockhash':
      return reply({ context: { slot: CHAIN_SLOT }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
    case 'getSlot':
      return reply(CHAIN_SLOT);
    case 'getRecentPerformanceSamples':
      return reply(performanceSamples);
    case 'getAccountInfo': {
      const found = get(params[0]);
      return reply({ context: { slot: CHAIN_SLOT }, value: found ? account(found) : null });
    }
    case 'getMultipleAccounts':
      return reply({ context: { slot: CHAIN_SLOT }, value: params[0].map((a) => (get(a) ? account(get(a)) : null)) });
    case 'getSignatureStatuses':
      return reply({ context: { slot: 6000 }, value: params[0].map(() => ({ slot: 5001, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
    default:
      throw new Error(`unscripted RPC ${method}`);
  }
}

globalThis.fetch = async (url, init) => {
  assert.equal(String(url), PAYMASTER);
  const { id, method, params } = JSON.parse(init.body);
  const answerWith = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
  if (method === 'getPayerSigner') return answerWith({ result: { signer_address: FEE_PAYER.toBase58() } });
  if (method === 'signAndSendTransaction') {
    sent.push(VersionedTransaction.deserialize(Buffer.from(params.transaction, 'base64')));
    return answerWith({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
  }
  throw new Error(`unscripted paymaster ${method}`);
};

// ─── The portal ─────────────────────────────────────────────────────────────

/** A sign redirect whose clientDataJSON carries `challenge` (base64url). */
function assertion(challenge, type = 'webauthn.get') {
  return {
    success: 'true',
    credentialId: CREDENTIAL_ID,
    signature: Buffer.alloc(64, 1).toString('base64'),
    msg: 'AA==',
    clientDataJSONReturn: Buffer.from(JSON.stringify({ type, challenge, origin: PORTAL })).toString('base64'),
    authenticatorDataReturn: Buffer.alloc(37, 2).toString('base64'),
  };
}

const requestOf = (url) => A.readApprovalFragment(url.hash);

/** A typed portal: signs the request at `slot` and its counter + `ahead`, and says so in `typed*`. */
const typedPortal = ({ slot = 7777n, ahead = 0 } = {}) => (url) => {
  const req = requestOf(url);
  const binding = { slot, counter: req.counter + ahead };
  return { ...assertion(A.approvalChallengeBase64url(req, binding)), ...A.typedReplyParams(A.typedReplyFor(req, binding)) };
};

const legacyPortal = () => (url) => assertion(url.searchParams.get('message'));

// ─── The store ──────────────────────────────────────────────────────────────

const store = M.useWalletStore;
M.registerCluster(RPC, 'devnet');

beforeEach(() => {
  accounts.clear();
  accounts.set(AUTHORITY.toBase58(), authorityAccount());
  sent.length = 0;
  opened.length = 0;
  warnings.length = 0;
  answer = typedPortal();
  performanceSamples = [{ slot: 1, numSlots: 150, numTransactions: 1, samplePeriodSecs: 60 }];
  store.setState({
    connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => rpc(init), disableRetryOnRateLimit: true }),
    config: { ...store.getState().config, portalUrl: PORTAL, configPaymaster: { paymasterUrl: PAYMASTER } },
    wallet: {
      walletPda: WALLET.toBase58(),
      smartWallet: M.findVaultPda(WALLET, PROGRAM)[0].toBase58(),
      walletDevice: AUTHORITY.toBase58(),
      credentialId: CREDENTIAL_ID,
      passkeyPubkey: [2, ...new Array(32).fill(0x11)],
      platform: 'ios',
      protocolVersion: 2,
    },
    isSigning: false,
    isConnecting: false,
    error: null,
  });
});

function signedAt(tx, { slot, counter, sysvarIxIndex }) {
  const prefix = Buffer.alloc(14);
  prefix.writeBigUInt64LE(BigInt(slot), 0);
  prefix.writeUInt32LE(counter, 8);
  prefix[12] = sysvarIxIndex;
  prefix[13] = 0x80;
  return tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data).indexOf(prefix) >= 0);
}

const actions = [sdk.Actions.solMaxPerTx(2_000_000n), sdk.Actions.solRecurringLimit({ limit: 20_000_000n, windowSeconds: 86_400n })];
const createSession = (extra = {}) =>
  store.getState().createSession({ sessionKey: Keypair.generate().publicKey, actions, ...extra }, { redirectUrl });

// ─── createSession ──────────────────────────────────────────────────────────

test('createSession sends the typed request in the fragment, with the query 2.x sent, and finalizes at the portal slot', async () => {
  const sessionKey = Keypair.generate().publicKey;
  await store.getState().createSession({ sessionKey, actions, expiresInSeconds: 3600 }, { redirectUrl });
  assert.equal(opened.length, 1);
  const url = opened[0];
  assert.deepEqual([...url.searchParams.keys()], ['action', 'message', 'credentialId', 'redirect_url']);
  assert.equal(url.searchParams.get('redirect_url'), redirectUrl);
  assert.ok(url.hash.startsWith('#/?lk1='));

  const req = requestOf(url);
  assert.equal(req.kind, 'createSession');
  assert.equal(req.cluster, 'devnet');
  assert.equal(req.wallet, WALLET.toBase58());
  assert.equal(req.authority, AUTHORITY.toBase58());
  assert.equal(req.credentialId, CREDENTIAL.toString('base64url'));
  assert.equal(req.payer, FEE_PAYER.toBase58());
  assert.equal(req.counter, STORED_COUNTER + 1);
  assert.deepEqual(req.args, {
    sessionKey: sessionKey.toBase58(),
    expiresAt: String(CLUSTER_TIME + 3600n),
    actions: Buffer.from(sdk.serializeActions(actions)).toString('base64url'),
  });
  assert.deepEqual(A.checkApprovalQuery(req, { message: url.searchParams.get('message'), credentialId: url.searchParams.get('credentialId') }), { ok: true });

  assert.equal(sent.length, 1);
  assert.ok(signedAt(sent[0], { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 6 }));
});

test("a counter that moved forward: the chain's counter is signed and carried", async () => {
  answer = typedPortal({ slot: 9000n, ahead: 1 });
  await createSession();
  assert.ok(signedAt(sent[0], { slot: 9000n, counter: STORED_COUNTER + 2, sysvarIxIndex: 6 }));
});

test('a portal that does not read typed requests: finalized at the prepared slot and counter', async () => {
  answer = legacyPortal();
  await createSession();
  assert.ok(signedAt(sent[0], { slot: BigInt(CHAIN_SLOT), counter: STORED_COUNTER + 1, sysvarIxIndex: 6 }));
});

test('a redirect that does not match the request (a forged deep link included) is PortalReplyMismatchError; nothing is sent', async () => {
  const mismatches = {
    'another kind': (url) => ({ ...typedPortal()(url), typedKind: 'removeAuthority' }),
    'some typed parameters only': (url) => {
      const reply = typedPortal()(url);
      delete reply.typedSysvarIx;
      return reply;
    },
    'a counter below the prepared one': (url) => {
      const req = requestOf(url);
      const binding = { slot: 7777n, counter: req.counter - 1 };
      return { ...assertion(A.approvalChallengeBase64url(req, binding)), ...A.typedReplyParams(A.typedReplyFor(req, binding)) };
    },
    'a slot with a leading zero': (url) => ({ ...typedPortal()(url), typedSlot: '07777' }),
    'another request signed': (url) => {
      const req = requestOf(url);
      const other = { ...req, args: { ...req.args, actions: '' } };
      const binding = { slot: 7777n, counter: req.counter };
      return { ...assertion(A.approvalChallengeBase64url(other, binding)), ...A.typedReplyParams(A.typedReplyFor(req, binding)) };
    },
    'no typed parameters, and another challenge': () => assertion(Buffer.alloc(32, 3).toString('base64url')),
  };
  for (const [what, reply] of Object.entries(mismatches)) {
    answer = reply;
    await assert.rejects(createSession(), (error) => {
      assert.equal(error.name, 'PortalReplyMismatchError', `${what}: ${error.message}`);
      assert.ok(error instanceof M.PortalReplyMismatchError, what);
      return true;
    });
  }
  assert.equal(sent.length, 0);
});

test("the portal's refusals: type=error&code=stale-counter is RequestOutOfDateError; another code PortalRefusedError", async () => {
  answer = () => ({ type: 'error', error: 'This request is out of date. Your passkey signed nothing.', code: 'stale-counter' });
  await assert.rejects(createSession(), (error) => {
    assert.ok(error instanceof M.RequestOutOfDateError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /signed nothing/);
    return true;
  });
  answer = () => ({ type: 'error', error: "LazorKit can't check this request on this network.", code: 'wrong-network' });
  await assert.rejects(createSession(), (error) => {
    assert.ok(error instanceof M.PortalRefusedError);
    assert.equal(error.code, 'wrong-network');
    return true;
  });
  // A plain portal error, as before.
  answer = () => ({ error: 'Something went wrong' });
  await assert.rejects(createSession(), (error) => {
    assert.ok(error instanceof M.LazorKitError);
    assert.equal(error.code, 'PORTAL_ERROR');
    return true;
  });
  assert.equal(sent.length, 0);
});

// ─── Expiry ─────────────────────────────────────────────────────────────────

test('expiry: seconds of the cluster clock (default 5 hours), expiresAt as given, expiresAtSlot converted with the measured slot time', async () => {
  const expiresAtOf = () => BigInt(requestOf(opened.at(-1)).args.expiresAt);
  await createSession();
  assert.equal(expiresAtOf(), CLUSTER_TIME + 18_000n);
  await createSession({ expiresAt: CLUSTER_TIME + 60n });
  assert.equal(expiresAtOf(), CLUSTER_TIME + 60n);
  // 1,000 slots past the chain's slot at 0.4 s a slot: 400 s.
  await createSession({ expiresAtSlot: BigInt(CHAIN_SLOT + 1000) });
  assert.equal(expiresAtOf(), CLUSTER_TIME + 400n);
  assert.equal(warnings.filter((w) => /expiresAtSlot.*deprecated/.test(w)).length, 1);

  const before = opened.length;
  for (const [extra, message] of [
    [{ expiresInSeconds: 2_592_001 }, /at most 2592000/],
    [{ expiresAt: CLUSTER_TIME - 1n }, /after the cluster's time/],
    [{ expiresAt: 412_388_000n }, /looks like a slot/],
    [{ expiresAtSlot: BigInt(CHAIN_SLOT) }, /not after the current slot/],
    [{ expiresAt: CLUSTER_TIME + 60n, expiresAtSlot: 6000n }, /takes one of/],
  ]) {
    await assert.rejects(createSession(extra), message);
  }
  assert.equal(opened.length, before, 'refused before the portal opens');
});

// ─── revokeSession and removeAuthority ──────────────────────────────────────

test('revokeSession and removeAuthority send typed requests and land at the portal slot', async () => {
  const sessionPda = fixed(31);
  await store.getState().revokeSession({ sessionPda }, { redirectUrl });
  let req = requestOf(opened.at(-1));
  assert.equal(req.kind, 'revokeSession');
  assert.deepEqual(req.args, { session: sessionPda.toBase58(), refund: FEE_PAYER.toBase58() });
  assert.ok(signedAt(sent.at(-1), { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 5 }));

  const target = fixed(41);
  const refund = fixed(42);
  await store.getState().removeAuthority({ targetAuthorityPda: target, refundDestination: refund }, { redirectUrl });
  req = requestOf(opened.at(-1));
  assert.equal(req.kind, 'removeAuthority');
  assert.deepEqual(req.args, { target: target.toBase58(), refund: refund.toBase58() });
  assert.ok(signedAt(sent.at(-1), { slot: 7777n, counter: STORED_COUNTER + 1, sysvarIxIndex: 5 }));
  assert.equal(sent.length, 2);
});

test('other passkey actions open the portal as 2.x did: no fragment', async () => {
  answer = legacyPortal();
  await store.getState().addAuthorityEd25519({ newEd25519Pubkey: fixed(51), role: M.ROLE_ADMIN }, { redirectUrl });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].hash, '');
});

// ─── What fits ──────────────────────────────────────────────────────────────

test('actions that cannot fit in the CreateSession transaction are refused before the portal opens', async () => {
  const mint = (byte) => fixed(byte);
  const tooMany = Array.from({ length: 17 }, () => sdk.Actions.solMaxPerTx(1n));
  await assert.rejects(createSession({ actions: tooMany }), /17 actions; a session holds at most 16/);
  // Four recurring token limits: 4 x 75 = 300 bytes, over 244.
  const tooBig = [61, 62, 63, 64].map((b) => sdk.Actions.tokenRecurringLimit({ mint: mint(b), limit: 1n, windowSeconds: 86_400n }));
  assert.equal(sdk.serializeActions(tooBig).length, 300);
  await assert.rejects(createSession({ actions: tooBig }), /300 bytes of actions; at most 244 fit/);
  assert.equal(opened.length, 0, 'the portal never opened');
  assert.equal(sent.length, 0);

  // Three fit (225 bytes).
  await createSession({ actions: tooBig.slice(0, 3) });
  assert.equal(sent.length, 1);
});

test('a portal URL over the cap is refused with TypedRequestTooLargeError before the browser opens', async () => {
  store.setState({ config: { ...store.getState().config, portalUrl: `${PORTAL}/${'p'.repeat(16_000)}` } });
  await assert.rejects(createSession(), (error) => {
    assert.ok(error instanceof M.TypedRequestTooLargeError, error.message);
    assert.equal(error.limit, 16_384);
    return true;
  });
  assert.equal(opened.length, 0);
  assert.equal(sent.length, 0);
});

// ─── v1 wallets ─────────────────────────────────────────────────────────────

const V1_PROGRAM = sdk.legacyProgramIdFor(PROGRAM);

/** Connect a v1 wallet: its passkey authority at the v1 program, with v1's discriminator (2). */
function connectV1Wallet() {
  const authority = authorityAccount();
  authority.data[0] = 2;
  authority.owner = V1_PROGRAM.toBase58();
  accounts.set(AUTHORITY.toBase58(), authority);
  accounts.set(WALLET.toBase58(), { owner: V1_PROGRAM.toBase58() });
  store.setState({ wallet: { ...store.getState().wallet, protocolVersion: 1 } });
}

/** Whether the sent transaction carries `value` as a little-endian u64 (a v1 session's expiry slot). */
function carriesU64(tx, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data).indexOf(bytes) >= 0);
}

test('v1 wallet: no typed request, the prepared challenge is checked, and the session expires at a slot (50,000 ahead by default)', async () => {
  connectV1Wallet();
  answer = legacyPortal();
  // No slot-time samples: the default needs none (nor does a limit without a window).
  performanceSamples = [];
  const perTx = [sdk.Actions.solMaxPerTx(2_000_000n)];
  await createSession({ actions: perTx });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].hash, '', 'no typed request');
  assert.ok(carriesU64(sent[0], CHAIN_SLOT + 50_000), 'expires 50,000 slots ahead');
  assert.equal(M.DEFAULTS.SESSION_EXPIRY_SLOTS, 50_000n);

  // expiresAtSlot as given, with no warning.
  await createSession({ actions: perTx, expiresAtSlot: BigInt(CHAIN_SLOT + 1_000) });
  assert.ok(carriesU64(sent[1], CHAIN_SLOT + 1_000));
  assert.equal(warnings.filter((w) => /deprecated/.test(w)).length, 0);

  // A time, or a recurring window, needs the slot time; without it the error names what was passed.
  await assert.rejects(createSession(), /so a recurring limit's windowSeconds \(a v1 wallet counts the window in slots\) cannot be converted/);
  await assert.rejects(
    createSession({ actions: perTx, expiresInSeconds: 600 }),
    /no performance samples\), so expiresInSeconds \(a v1 wallet's session expires at a slot\) cannot be converted\. Pass expiresAtSlot instead\./,
  );
  // With it: 600 s at 0.4 s a slot is 1,500 slots.
  performanceSamples = [{ slot: 1, numSlots: 150, numTransactions: 1, samplePeriodSecs: 60 }];
  await createSession({ expiresInSeconds: 600 });
  assert.ok(carriesU64(sent[2], CHAIN_SLOT + 1_500));
  // The recurring window, a day in seconds, is a day of slots for v1: 216,000 at 0.4 s.
  assert.ok(carriesU64(sent[2], 216_000), 'the window in slots');
  assert.ok(!carriesU64(sent[2], 86_400), 'not in seconds');

  await store.getState().revokeSession({ sessionPda: fixed(34) }, { redirectUrl });
  await store.getState().removeAuthority({ targetAuthorityPda: fixed(44), refundDestination: fixed(45) }, { redirectUrl });
  assert.equal(sent.length, 5);
  assert.ok(opened.every((url) => url.hash === ''));
});

test('v1 wallet: a redirect over another challenge, or with typed parameters, is PortalReplyMismatchError; nothing is sent', async () => {
  connectV1Wallet();
  const typedParams = { typedV: '1', typedKind: 'createSession', typedSlot: '7777', typedCounter: String(STORED_COUNTER + 1), typedSysvarIx: '6' };
  const mismatches = {
    'another challenge': () => assertion(Buffer.alloc(32, 9).toString('base64url')),
    'typed parameters to an untyped request': (url) => ({ ...assertion(url.searchParams.get('message')), ...typedParams }),
  };
  for (const [what, reply] of Object.entries(mismatches)) {
    answer = reply;
    await assert.rejects(createSession(), (error) => {
      assert.ok(error instanceof M.PortalReplyMismatchError, `${what}: ${error.message}`);
      return true;
    });
  }
  answer = () => assertion(Buffer.alloc(32, 8).toString('base64url'));
  await assert.rejects(store.getState().revokeSession({ sessionPda: fixed(35) }, { redirectUrl }), (error) => error instanceof M.PortalReplyMismatchError);
  await assert.rejects(
    store.getState().removeAuthority({ targetAuthorityPda: fixed(46), refundDestination: fixed(47) }, { redirectUrl }),
    (error) => error instanceof M.PortalReplyMismatchError,
  );
  assert.equal(sent.length, 0);
});
