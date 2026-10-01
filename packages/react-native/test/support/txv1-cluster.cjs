'use strict';
/**
 * A scripted cluster, paymaster and portal for txv1-send.test.cjs: the built
 * package runs in Node with its native modules stubbed, and every request it
 * makes is answered and recorded here. Nothing leaves the process: the RPC
 * and paymaster URLs end in `.test`.
 *
 * Each `world()` is a fresh wallet with its own keys (from a label), ledger,
 * RPC URL and paymaster URL, so the package's module state (passkey lanes,
 * the paymaster refusal memo) never carries from one test to the next.
 *
 * The ledger models what the adapter reads: accounts, one slot that moves on
 * with each landing, signature statuses. A landing applies the LazorKit
 * effects the next reads depend on: a passkey Execute or Authorize bumps the
 * counter, Authorize creates its DeferredExec account, ExecuteDeferred closes
 * it, RegisterPayer creates the FeeRecord. The paymaster signs as fee payer
 * at the byte level (a v1 transaction's signatures come last).
 */
const Module = require('module');
const { createHash } = require('node:crypto');

// ─── Native modules, stubbed ────────────────────────────────────────────────

const storage = new Map();
/** The portal, as the system browser opens it: `(url, redirectUrl) => result`. */
let portalHandler = null;

const STUBS = {
  'react-native': {
    Platform: { OS: 'ios', select: (options) => options.ios ?? options.default },
    Linking: { addEventListener: () => ({ remove() {} }), openURL: async () => {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
    useColorScheme: () => 'light',
  },
  'expo-web-browser': {
    openAuthSessionAsync: (url, redirectUrl) => portalHandler(url, redirectUrl),
    openBrowserAsync: async () => {
      throw new Error('the Android browser path is not used here');
    },
    dismissBrowser() {},
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

const web3 = require('@solana/web3.js');
const sdk = require('@lazorkit/sdk-legacy');
const { ed25519 } = require('@noble/curves/ed25519');
const { p256 } = require('@noble/curves/p256');
const M = require('../../dist/index.js');

const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } =
  web3;

const PORTAL_URL = 'https://portal.lazor.sh';
const RP_ID = 'portal.lazor.sh';
const REDIRECT = 'lazorverify://wallet-callback';
const NOOP = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const SECP256R1 = 'Secp256r1SigVerify1111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const SLOTS_PER_LANDING = 3;
const U64_MAX = 18446744073709551615n;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const rentExempt = (space) => (128 + space) * 6960;
const reply = (id, body, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status, headers: { 'content-type': 'application/json' } });

// ─── Worlds ─────────────────────────────────────────────────────────────────

/** By paymaster URL: the paymaster is reached through the global `fetch`. */
const byPaymaster = new Map();
let worlds = 0;
let slotBase = 500_000_000;

globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  const world = byPaymaster.get(url);
  if (!world) throw new TypeError(`txv1-cluster: no world answers ${url}`);
  return world.paymasterFetch(init);
};

/**
 * A wallet on a scripted cluster.
 *
 * options:
 *   cluster          'devnet' (the default: LazorKit v2 at 57bTNW…) or 'mainnet'
 *   noFeeRecord      the fee payer has no FeeRecord yet: RegisterPayer is prepended
 *   rateLimitRetries the Connection retries a 429 as web3.js does by default
 */
function world(options = {}) {
  const n = ++worlds;
  const h = (label) => sha256(`lazorkit-txv1-wiring/${n}/${label}`);
  const cluster = options.cluster ?? 'devnet';
  const programId = cluster === 'devnet' ? sdk.PROGRAM_ID_DEVNET : sdk.PROGRAM_ID_MAINNET;
  const rpcUrl = `http://rpc-${n}.${cluster}.test/`;
  const paymasterUrl = `http://paymaster-${n}.test/`;
  M.registerCluster(rpcUrl, cluster);

  const D = sdk.ACCOUNT_DISCRIMINATOR;
  const feePayer = Keypair.fromSeed(h('fee-payer'));
  const passkeyPrivate = new Uint8Array(h('passkey'));
  const passkeyPublic = p256.getPublicKey(passkeyPrivate, true);
  const credentialId = h('credential-id').toString('base64');
  const credentialIdHash = sha256(Buffer.from(credentialId, 'base64'));
  const userSeed = new Uint8Array(h('user-seed'));
  const [walletPda, walletBump] = sdk.findWalletPda(userSeed, programId);
  const [vaultPda] = sdk.findVaultPda(walletPda, programId);
  const [authorityPda, authorityBump] = sdk.findAuthorityPda(walletPda, credentialIdHash, programId);
  const sessionKey = Keypair.fromSeed(h('session-key'));
  const [sessionPda, sessionBump] = sdk.findSessionPda(walletPda, sessionKey.publicKey.toBytes(), programId);
  const [protocolConfigPda, protocolConfigBump] = sdk.findProtocolConfigPda(programId);
  const [feeRecordPda, feeRecordBump] = sdk.findFeeRecordPda(feePayer.publicKey, programId);
  const [treasuryShard0, treasuryShard0Bump] = sdk.findTreasuryShardPda(0, programId);
  const recipient = new PublicKey(h('recipient'));
  const blockhash = new PublicKey(h('blockhash')).toBase58();

  const owned = (data) => ({ owner: programId.toBase58(), data: Buffer.from(data), lamports: rentExempt(data.length) });
  const accounts = new Map();
  const put = (key, account) => accounts.set(key.toBase58(), account);
  // Fees on, one treasury shard: the SDK's random shard pick is always shard 0.
  put(
    protocolConfigPda,
    owned(
      Buffer.concat([
        Buffer.from([D.PROTOCOL_CONFIG, 1, protocolConfigBump, 1, 1, 0, 0, 0]),
        new PublicKey(h('admin')).toBuffer(),
        new PublicKey(h('treasury')).toBuffer(),
        u64(10_000),
        u64(5_000),
        Buffer.alloc(32),
      ]),
    ),
  );
  put(treasuryShard0, owned(Buffer.from([D.TREASURY_SHARD, treasuryShard0Bump, 0, 0, 0, 0, 0, 0])));
  if (!options.noFeeRecord) {
    put(
      feeRecordPda,
      owned(Buffer.concat([Buffer.from([D.FEE_RECORD, feeRecordBump, 1, 0, 0, 0, 0, 0]), u64(250_000), u32(50), u32(3), u64(1)])),
    );
  }
  put(walletPda, owned(Buffer.concat([Buffer.from([D.WALLET, walletBump, 1, 0]), u32(1)])));
  put(vaultPda, { owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), lamports: 2_000_000_000 });
  put(feePayer.publicKey, { owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), lamports: 10_000_000_000 });
  put(
    authorityPda,
    owned(
      Buffer.concat([
        Buffer.from([D.AUTHORITY, 1, 0, authorityBump, 1, 0, 0, 0]),
        u32(41),
        Buffer.from([0, 0, 0, 0]),
        walletPda.toBuffer(),
        credentialIdHash,
        Buffer.from(passkeyPublic),
        sha256(Buffer.from(RP_ID)),
      ]),
    ),
  );
  put(
    sessionPda,
    owned(
      Buffer.concat([
        Buffer.from([D.SESSION, sessionBump, 1, 0, 0, 0, 0, 0]),
        walletPda.toBuffer(),
        sessionKey.publicKey.toBuffer(),
        u64(10_000_000_000),
      ]),
    ),
  );

  slotBase += 100_000;
  const ledger = { slot: slotBase, statuses: new Map(), sendAttempts: 0, accounts };
  const rec = { rpc: [], paymaster: [], sends: [], portal: [] };
  const lookupTables = new Map();

  const w = {
    n,
    cluster,
    programId,
    rpcUrl,
    paymasterUrl,
    feePayer,
    walletPda,
    vaultPda,
    authorityPda,
    sessionKey,
    sessionPda,
    feeRecordPda,
    recipient,
    blockhash,
    ledger,
    rec,
    /**
     * Scripted answers. Each takes the request and returns undefined to fall
     * through to the default, or the answer:
     *   simulate(params)       a Response, or { result } / { error }, or a Promise of one
     *   getTransaction(params) { result } / { error }
     *   send(decoded, attempt) { error } (nothing sent), { land: err } (sent, lands with err),
     *                          { landAndError: error } (sent, lands, and the error names it)
     *   cdjPadding             bytes the portal adds to clientDataJSON (Chrome's extra field)
     */
    script: {},
    counter: () => accounts.get(authorityPda.toBase58()).data.readUInt32LE(8),
    walletInfo: {
      credentialId,
      passkeyPubkey: Array.from(passkeyPublic),
      expo: 'lazorverify',
      platform: 'ios',
      smartWallet: vaultPda.toBase58(),
      walletPda: walletPda.toBase58(),
      walletDevice: authorityPda.toBase58(),
      protocolVersion: 2,
    },
    /** The RPC methods called, in order. */
    methods: () => rec.rpc.map((r) => r.method),
    /** Each `signAndSendTransaction` the paymaster received, decoded. */
    sent: () => rec.sends,
    transfer: (lamports = 1_000_000) => SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: recipient, lamports }),
    /** A Noop-program instruction with `accounts` fresh accounts and `data` bytes. */
    noop(accountCount, dataLength, label = 'noop') {
      const keys = Array.from({ length: accountCount }, (_, i) => ({
        pubkey: new PublicKey(h(`${label}/account/${i}`)),
        isSigner: false,
        isWritable: i < 4,
      }));
      return new TransactionInstruction({ programId: NOOP, keys, data: Buffer.alloc(dataLength, 7) });
    },
    /** A lookup table holding `count` fresh addresses, known to the ledger. */
    lookupTable(count, label = 'table') {
      const addresses = Array.from({ length: count }, (_, i) => new PublicKey(h(`${label}/address/${i}`)));
      const table = new web3.AddressLookupTableAccount({
        key: new PublicKey(h(label)),
        state: {
          deactivationSlot: U64_MAX,
          lastExtendedSlot: slotBase - 1000,
          lastExtendedSlotStartIndex: 0,
          authority: new PublicKey(h(`${label}/authority`)),
          addresses,
        },
      });
      lookupTables.set(table.key.toBase58(), table);
      return table;
    },
    /** A Noop instruction over `count` addresses of `table` (4 writable). */
    noopFrom(table, count, dataLength = 64) {
      return new TransactionInstruction({
        programId: NOOP,
        keys: table.state.addresses.slice(0, count).map((pubkey, i) => ({ pubkey, isSigner: false, isWritable: i < 4 })),
        data: Buffer.alloc(dataLength, 9),
      });
    },
  };

  // ── JSON-RPC ──────────────────────────────────────────────────────────
  const ctx = () => ({ apiVersion: '2.3.0', slot: ledger.slot });
  const accountJson = (a) =>
    a ? { data: [a.data.toString('base64'), 'base64'], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length } : null;
  const notReached = (config) =>
    config && typeof config.minContextSlot === 'number' && config.minContextSlot > ledger.slot
      ? { error: { code: -32016, message: 'Minimum context slot has not been reached', data: { contextSlot: ledger.slot } } }
      : null;

  function answer(method, params) {
    switch (method) {
      case 'getAccountInfo':
        return notReached(params[1]) ?? { result: { context: ctx(), value: accountJson(accounts.get(params[0])) } };
      case 'getMultipleAccounts':
        return notReached(params[1]) ?? { result: { context: ctx(), value: params[0].map((k) => accountJson(accounts.get(k))) } };
      case 'getSlot':
        return notReached(params[0]) ?? { result: ledger.slot };
      case 'getLatestBlockhash':
        return notReached(params[0]) ?? { result: { context: ctx(), value: { blockhash, lastValidBlockHeight: 480_000_150 } } };
      case 'getEpochInfo':
        return { result: { absoluteSlot: ledger.slot, blockHeight: 480_000_000, epoch: 1, slotIndex: 0, slotsInEpoch: 432_000, transactionCount: null } };
      case 'getSignatureStatuses':
        return {
          result: {
            context: ctx(),
            value: params[0].map((sig) => {
              const st = ledger.statuses.get(sig);
              return st ? { slot: st.slot, confirmations: 0, err: st.err, status: st.err ? { Err: st.err } : { Ok: null }, confirmationStatus: 'confirmed' } : null;
            }),
          },
        };
      case 'simulateTransaction':
        return {
          result: {
            context: ctx(),
            value: { err: null, logs: [], accounts: null, unitsConsumed: 13_011, loadedAccountsDataSize: 161_320, returnData: null },
          },
        };
      case 'getTransaction':
        return { result: null };
      default:
        return { error: { code: -32601, message: `txv1-cluster: method not found: ${method}` } };
    }
  }

  async function rpcFetch(_url, init) {
    const { id, method, params = [] } = JSON.parse(init.body);
    rec.rpc.push({ method, params });
    const scripted = method === 'simulateTransaction' ? w.script.simulate : method === 'getTransaction' ? w.script.getTransaction : undefined;
    const out = (scripted && (await scripted(params))) ?? answer(method, params);
    return out instanceof Response ? out : reply(id, out);
  }
  w.connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: !options.rateLimitRetries });

  // ── Landing ───────────────────────────────────────────────────────────
  function decode(raw) {
    const tx = VersionedTransaction.deserialize(raw);
    const tables = (tx.message.addressTableLookups ?? []).map((l) => lookupTables.get(l.accountKey.toBase58()));
    const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: tables });
    const signers = tx.message.header.numRequiredSignatures;
    const messageLength = tx.version === 1 ? raw.length - 64 * signers : null;
    return {
      tx,
      raw,
      version: tx.version,
      bytes: raw.length,
      config: tx.version === 1 ? tx.message.transactionConfig : null,
      staticKeys: tx.message.staticAccountKeys.map((k) => k.toBase58()),
      signers,
      messageLength,
      instructions: message.instructions.map((ix) => ({
        program: ix.programId.toBase58(),
        keys: ix.keys.map((k) => k.pubkey.toBase58()),
        data: Buffer.from(ix.data),
      })),
    };
  }

  /** The signature in slot `i`, and whether it verifies (null for an empty slot). */
  function signatureAt(decoded, i) {
    if (decoded.version !== 1) {
      const sig = decoded.tx.signatures[i];
      if (sig.every((b) => b === 0)) return null;
      return ed25519.verify(sig, decoded.tx.message.serialize(), new PublicKey(decoded.staticKeys[i]).toBytes());
    }
    const sig = decoded.raw.subarray(decoded.messageLength + 64 * i, decoded.messageLength + 64 * (i + 1));
    if (sig.every((b) => b === 0)) return null;
    return ed25519.verify(sig, decoded.raw.subarray(0, decoded.messageLength), new PublicKey(decoded.staticKeys[i]).toBytes());
  }

  function land(decoded, signature, err) {
    ledger.slot += SLOTS_PER_LANDING;
    const slot = ledger.slot;
    ledger.statuses.set(signature, { slot, err: err ?? null });
    if (err) return slot;
    const passkeySigned = decoded.instructions.some((ix) => ix.program === SECP256R1);
    for (const ix of decoded.instructions) {
      if (ix.program !== programId.toBase58()) continue;
      const disc = ix.data[0];
      if (passkeySigned && (disc === sdk.DISC_EXECUTE || disc === sdk.DISC_AUTHORIZE)) {
        const authority = accounts.get(ix.keys[2]);
        authority.data.writeUInt32LE(authority.data.readUInt32LE(8) + 1, 8);
      }
      if (disc === sdk.DISC_AUTHORIZE) {
        const expiresAt = BigInt(slot + ix.data.readUInt16LE(65));
        const data = Buffer.alloc(176);
        data[0] = D.DEFERRED_EXEC;
        data[1] = 1;
        ix.data.copy(data, 8, 1, 33);
        ix.data.copy(data, 40, 33, 65);
        new PublicKey(ix.keys[1]).toBuffer().copy(data, 72);
        new PublicKey(ix.keys[2]).toBuffer().copy(data, 104);
        new PublicKey(ix.keys[0]).toBuffer().copy(data, 136);
        data.writeBigUInt64LE(expiresAt, 168);
        accounts.set(ix.keys[3], { owner: programId.toBase58(), data, lamports: rentExempt(176) });
      }
      if (disc === sdk.DISC_EXECUTE_DEFERRED) accounts.delete(ix.keys[3]);
      if (disc === sdk.DISC_REGISTER_PAYER) {
        const data = Buffer.alloc(32);
        data[0] = D.FEE_RECORD;
        data[2] = 1;
        accounts.set(ix.keys[1], { owner: programId.toBase58(), data, lamports: rentExempt(32) });
      }
    }
    return slot;
  }

  // ── Paymaster ─────────────────────────────────────────────────────────
  w.paymasterFetch = async (init) => {
    const { id, method, params } = JSON.parse(init.body);
    rec.paymaster.push({ method, body: init.body });
    if (method === 'getPayerSigner') {
      return reply(id, { result: { signer_address: feePayer.publicKey.toBase58(), payment_address: feePayer.publicKey.toBase58() } });
    }
    if (method !== 'signAndSendTransaction') return reply(id, { error: { code: -32601, message: `method not found: ${method}` } });
    const attempt = ledger.sendAttempts++;
    const raw = Buffer.from(params.transaction, 'base64');
    const decoded = decode(raw);
    const payerSlotEmpty = signatureAt(decoded, 0) === null;
    const signaturesValid = decoded.staticKeys.slice(1, decoded.signers).map((_, i) => signatureAt(decoded, i + 1));
    // Sign as fee payer (address 0), as a byte-level relayer does.
    let signature;
    if (decoded.version === 1) {
      const sig = ed25519.sign(raw.subarray(0, decoded.messageLength), feePayer.secretKey.subarray(0, 32));
      raw.set(sig, decoded.messageLength);
      signature = base58(sig);
    } else {
      decoded.tx.sign([feePayer]);
      signature = base58(decoded.tx.signatures[0]);
    }
    const plan = (w.script.send && w.script.send(decoded, attempt)) ?? {};
    const entry = { ...decoded, attempt, signature, payerSlotEmpty, signaturesValid, params, landed: false };
    rec.sends.push(entry);
    if (plan.error) return reply(id, { error: plan.error });
    entry.landed = true;
    entry.slot = land(decoded, signature, plan.land ?? plan.landAndError?.landed);
    if (plan.landAndError) return reply(id, { error: { ...plan.landAndError.error, data: { signature } } });
    return reply(id, { result: { signature, signed_transaction: raw.toString('base64'), signer_pubkey: feePayer.publicKey.toBase58() } });
  };
  byPaymaster.set(paymasterUrl, w);

  // ── Portal ────────────────────────────────────────────────────────────
  w.portal = async (url, redirectUrl) => {
    const u = new URL(url);
    const params = Object.fromEntries(u.searchParams.entries());
    rec.portal.push(params);
    const challenge = params.message;
    const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
    const padding = w.script.cdjPadding ? `,"other_keys_can_be_added_here":"${'x'.repeat(w.script.cdjPadding)}"` : '';
    const cdj = Buffer.from(`{"type":"webauthn.get","challenge":"${challenge}","origin":"${PORTAL_URL}","crossOrigin":false${padding}}`);
    const msg = Buffer.concat([authData, sha256(cdj)]);
    const r = new URL(redirectUrl);
    r.searchParams.set('success', 'true');
    // 64 bytes: the adapter does not check it, and nothing here runs the precompile.
    r.searchParams.set('signature', Buffer.concat([h('passkey-signature/r'), h('passkey-signature/s')]).toString('base64'));
    r.searchParams.set('msg', msg.toString('base64'));
    r.searchParams.set('message', challenge);
    r.searchParams.set('credentialId', credentialId);
    r.searchParams.set('clientDataJSONReturn', cdj.toString('base64'));
    r.searchParams.set('authenticatorDataReturn', authData.toString('base64'));
    return { type: 'success', url: r.toString() };
  };
  return w;
}

/**
 * Point the package's store at `w`: its connection, wallet and paymaster
 * (`acceptsTxV1` as given; left out when undefined).
 */
function use(w, { acceptsTxV1 } = {}) {
  portalHandler = w.portal;
  M.useWalletStore.setState({
    connection: w.connection,
    config: {
      portalUrl: PORTAL_URL,
      configPaymaster: { paymasterUrl: w.paymasterUrl, ...(acceptsTxV1 !== undefined ? { acceptsTxV1 } : {}) },
      rpcUrl: w.rpcUrl,
      cluster: w.cluster,
      rpId: RP_ID,
    },
    wallet: w.walletInfo,
    isSigning: false,
    error: null,
  });
  return M.useWalletStore.getState();
}

/** What the package logged, by level, while `fn` ran. */
async function captureConsole(fn) {
  const lines = { log: [], info: [], warn: [], error: [] };
  const saved = {};
  for (const level of Object.keys(lines)) {
    saved[level] = console[level];
    console[level] = (...args) => lines[level].push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
  }
  try {
    return { lines, value: await fn() };
  } catch (error) {
    return { lines, error };
  } finally {
    Object.assign(console, saved);
  }
}

module.exports = { M, sdk, web3, world, use, captureConsole, REDIRECT, SECP256R1, COMPUTE_BUDGET, NOOP };
