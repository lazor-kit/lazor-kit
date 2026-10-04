/**
 * The flag-off check's corpus (../../flagoff.test.mjs): deterministic keys,
 * the mock ledger's initial accounts, the instruction payloads, and the case
 * matrix.
 *
 * Every key is derived from a fixed label (`sha256('lazorkit-t0/' + label)`),
 * so nothing here is a secret and every run builds byte-identical inputs.
 * The packages under test bring their own @solana/web3.js and
 * @lazorkit/sdk-legacy; this module takes them as parameters, so the
 * instructions and PDAs are built with the very same classes the wallet uses.
 */
import { createHash } from 'node:crypto';

export const CORPUS_VERSION = 1;

/** The ledger's slot before anything lands, and its block height (fixed). */
export const SLOT0 = 500_000_000;
export const BLOCK_HEIGHT0 = 480_000_000;
/** Each landing advances the ledger by this many slots. */
export const SLOTS_PER_LANDING = 3;
/** The passkey authority's counter before the first case call. */
export const COUNTER0 = 41;

export const PORTAL_URL = 'https://portal.lazor.sh';
export const PORTAL_ORIGIN = 'https://portal.lazor.sh';
export const RP_ID = 'portal.lazor.sh';
export const MOBILE_REDIRECT = 'lazorverify://wallet-callback';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const ALT_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
export const NOOP_PROGRAM = 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV';
/** devnet USDC mint, as a fee token for the mobile `feeToken` variant (never charged: the paymaster is mocked). */
export const FEE_TOKEN = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const U64_MAX = 18446744073709551615n;

export const h = (label) => createHash('sha256').update(`lazorkit-t0/${label}`).digest();
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest();

/** Deterministic bytes of any length, from a label. */
export function bytesOf(label, length) {
  const out = Buffer.alloc(length);
  for (let i = 0, block = 0; i < length; block++) {
    const chunk = h(`${label}/${block}`);
    chunk.copy(out, i, 0, Math.min(32, length - i));
    i += 32;
  }
  return out;
}

/** Rent-exempt minimum for `space` bytes at the default rent (3480 lamports/byte-year, 2 years). */
export const rentExempt = (space) => (128 + space) * 6960;

/**
 * @param {{ web3: any, sdk: any, p256: any }} deps — this package's
 *   @solana/web3.js, @lazorkit/sdk-legacy and @noble/curves/p256.
 */
export function makeCorpus({ web3, sdk, p256 }) {
  const { PublicKey, Keypair, SystemProgram, TransactionInstruction, AddressLookupTableAccount } = web3;
  const key = (label) => new PublicKey(h(label));
  const kp = (label) => Keypair.fromSeed(h(label));
  const programId = sdk.PROGRAM_ID_DEVNET;

  // ── keys ──────────────────────────────────────────────────────────
  const feePayer = kp('fee-payer');
  const passkey = {
    priv: new Uint8Array(h('passkey/p256')),
    credentialId: h('passkey/credential-id').toString('base64'),
  };
  passkey.publicKey = p256.getPublicKey(passkey.priv, true);
  const credentialIdHash = sha256(Buffer.from(passkey.credentialId, 'base64'));
  const userSeed = new Uint8Array(h('wallet/user-seed'));
  const [walletPda, walletBump] = sdk.findWalletPda(userSeed, programId);
  const [vaultPda] = sdk.findVaultPda(walletPda, programId);
  const [authorityPda, authorityBump] = sdk.findAuthorityPda(walletPda, credentialIdHash, programId);
  const sessionKey = kp('session-key');
  const [sessionPda, sessionBump] = sdk.findSessionPda(walletPda, sessionKey.publicKey.toBytes(), programId);
  const edAuthority = kp('ed25519-authority');
  const [edAuthorityPda, edAuthorityBump] = sdk.findAuthorityPda(walletPda, edAuthority.publicKey.toBytes(), programId);
  const [protocolConfigPda, protocolConfigBump] = sdk.findProtocolConfigPda(programId);
  const [feeRecordPda, feeRecordBump] = sdk.findFeeRecordPda(feePayer.publicKey, programId);
  const [treasuryShard0, treasuryShard0Bump] = sdk.findTreasuryShardPda(0, programId);
  const recipient = key('recipient');
  const blockhash = key('blockhash').toBase58();

  // ── lookup tables (the caller's) ───────────────────────────────────
  const lutAddresses = (name) => Array.from({ length: 32 }, (_, i) => key(`lut-${name}/address/${i}`));
  const lut = (name) =>
    new AddressLookupTableAccount({
      key: key(`lut-${name}`),
      state: {
        deactivationSlot: U64_MAX,
        lastExtendedSlot: SLOT0 - 1000,
        lastExtendedSlotStartIndex: 0,
        authority: key(`lut-${name}/authority`),
        addresses: lutAddresses(name),
      },
    });
  const lutA = lut('a');
  const lutB = lut('b');

  // ── payloads (the caller's inner instructions) ─────────────────────
  const noop = new PublicKey(NOOP_PROGRAM);
  const transfer = () => SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: recipient, lamports: 1_000_000 });
  const noopIx = (metas, dataLabel, dataLength) =>
    new TransactionInstruction({ programId: noop, keys: metas, data: bytesOf(dataLabel, dataLength) });
  const metasFrom = (addresses, writableCount) =>
    addresses.map((pubkey, i) => ({ pubkey, isSigner: false, isWritable: i < writableCount }));

  const payloads = {
    /** One System transfer from the vault: the smallest real Execute. */
    transfer1: {
      describe: '1 SystemProgram.transfer vault -> recipient (1,000,000 lamports); no lookup tables',
      instructions: () => [transfer()],
      lookupTables: [],
    },
    /** Fits v0 only thanks to the caller's lookup table (24 table accounts, 64 B data). */
    lutFits: {
      describe: 'transfer + Noop ix with 24 accounts from lookup table A (4 writable) and 64 B data; lookup table A',
      instructions: () => [transfer(), noopIx(metasFrom(lutA.state.addresses.slice(0, 24), 4), 'payload/lut-fits', 64)],
      lookupTables: [lutA],
    },
    /**
     * A 2.2 KB inner payload (40 accounts x 32 B + 900 B data + a transfer),
     * with the caller's two lookup tables: over 1,232 B as v0 even with them.
     * The flag-off golden is the failure 3.4.0 / 2.4.0 report for it (as 3.3.1 / 2.3.1 and 3.2.1 / 2.2.1 did).
     */
    payload2k2: {
      describe: 'transfer + Noop ix with 40 accounts (24 from table A, 16 from table B; 4 writable) and 900 B data; lookup tables A and B',
      instructions: () => [
        transfer(),
        noopIx(metasFrom([...lutA.state.addresses.slice(0, 24), ...lutB.state.addresses.slice(0, 16)], 4), 'payload/2k2', 900),
      ],
      lookupTables: [lutA, lutB],
    },
    /** The same 2.2 KB payload, no lookup tables. */
    payload2k2NoAlt: {
      describe: 'the payload2k2 instructions with no lookup tables',
      instructions: () => [
        transfer(),
        noopIx(metasFrom([...lutA.state.addresses.slice(0, 24), ...lutB.state.addresses.slice(0, 16)], 4), 'payload/2k2', 900),
      ],
      lookupTables: [],
    },
  };

  // ── the ledger's initial accounts ──────────────────────────────────
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
  const zeros = (n) => Buffer.alloc(n);
  const D = sdk.ACCOUNT_DISCRIMINATOR;
  const owned = (data) => ({ owner: programId.toBase58(), data: Buffer.from(data), lamports: rentExempt(data.length) });

  const accounts = new Map();
  const put = (pubkey, account, label) => accounts.set(pubkey.toBase58(), { label, ...account });

  // ProtocolConfig (120 B): fees on, ONE treasury shard, so the SDK's random
  // shard pick (`randomBytes(4) % numShards`) is always shard 0.
  put(
    protocolConfigPda,
    owned(
      Buffer.concat([
        Buffer.from([D.PROTOCOL_CONFIG, 1, protocolConfigBump, 1, 1, 0, 0, 0]),
        key('protocol/admin').toBuffer(),
        key('protocol/treasury').toBuffer(),
        u64(10_000), // creation_fee
        u64(5_000), // execution_fee
        zeros(32), // pending_admin
      ]),
    ),
    'ProtocolConfig (enabled, 1 shard)',
  );
  put(treasuryShard0, owned(Buffer.from([D.TREASURY_SHARD, treasuryShard0Bump, 0, 0, 0, 0, 0, 0])), 'TreasuryShard 0');
  const feeRecord = owned(
    Buffer.concat([Buffer.from([D.FEE_RECORD, feeRecordBump, 1, 0, 0, 0, 0, 0]), u64(250_000), u32(50), u32(3), u64(SLOT0 - 100_000)]),
  );
  // Wallet (8 B), owner_count 1.
  put(walletPda, owned(Buffer.concat([Buffer.from([D.WALLET, walletBump, 1, 0]), u32(1)])), 'Wallet');
  put(vaultPda, { owner: SYSTEM_PROGRAM, data: Buffer.alloc(0), lamports: 2_000_000_000 }, 'Vault');
  put(feePayer.publicKey, { owner: SYSTEM_PROGRAM, data: Buffer.alloc(0), lamports: 10_000_000_000 }, 'Fee payer');
  // Passkey authority (145 B): Owner, Secp256r1, counter COUNTER0.
  put(
    authorityPda,
    owned(
      Buffer.concat([
        Buffer.from([D.AUTHORITY, 1, 0, authorityBump, 1, 0, 0, 0]),
        u32(COUNTER0),
        Buffer.from([0, 0, 0, 0]), // policy_len 0, padding
        walletPda.toBuffer(),
        credentialIdHash,
        Buffer.from(passkey.publicKey),
        sha256(Buffer.from(RP_ID)),
      ]),
    ),
    'Authority (passkey, Owner)',
  );
  // Session (80 B), unrestricted, expires far ahead.
  put(
    sessionPda,
    owned(
      Buffer.concat([
        Buffer.from([D.SESSION, sessionBump, 1, 0, 0, 0, 0, 0]),
        walletPda.toBuffer(),
        sessionKey.publicKey.toBuffer(),
        u64(SLOT0 + 1_000_000),
      ]),
    ),
    'Session',
  );
  // Ed25519 authority (80 B): Admin.
  put(
    edAuthorityPda,
    owned(
      Buffer.concat([
        Buffer.from([D.AUTHORITY, 0, 1, edAuthorityBump, 1, 0, 0, 0]),
        u32(0),
        Buffer.from([0, 0, 0, 0]),
        walletPda.toBuffer(),
        edAuthority.publicKey.toBuffer(),
      ]),
    ),
    'Authority (Ed25519, Admin)',
  );
  // The caller's lookup tables, as on chain (56 B meta + addresses).
  for (const table of [lutA, lutB]) {
    const meta = Buffer.concat([
      u32(1), // ProgramState::LookupTable
      u64(U64_MAX),
      u64(table.state.lastExtendedSlot),
      Buffer.from([table.state.lastExtendedSlotStartIndex, 1]),
      table.state.authority.toBuffer(),
      zeros(2),
    ]);
    const data = Buffer.concat([meta, ...table.state.addresses.map((a) => a.toBuffer())]);
    put(table.key, { owner: ALT_PROGRAM, data, lamports: rentExempt(data.length) }, `Lookup table ${table.key.toBase58().slice(0, 6)}`);
  }

  /** The ledger's accounts for a case: everything above, plus the payer's FeeRecord unless `noFeeRecord`. */
  function initialAccounts({ noFeeRecord = false } = {}) {
    const out = new Map(accounts);
    if (!noFeeRecord) out.set(feeRecordPda.toBase58(), { label: 'FeeRecord (fee payer)', ...feeRecord });
    return out;
  }

  /** The wallet the store holds after connect (what `connect` would have saved). */
  const mobileWalletInfo = {
    credentialId: passkey.credentialId,
    passkeyPubkey: Array.from(passkey.publicKey),
    expo: 'lazorverify',
    platform: 'ios',
    smartWallet: vaultPda.toBase58(),
    walletPda: walletPda.toBase58(),
    walletDevice: authorityPda.toBase58(),
    protocolVersion: 2,
  };
  return {
    programId,
    feePayer,
    passkey,
    credentialIdHash,
    userSeed,
    walletPda,
    vaultPda,
    authorityPda,
    sessionKey,
    sessionPda,
    edAuthority,
    edAuthorityPda,
    protocolConfigPda,
    feeRecordPda,
    treasuryShard0,
    recipient,
    blockhash,
    lookupTables: { [lutA.key.toBase58()]: lutA, [lutB.key.toBase58()]: lutB },
    payloads,
    initialAccounts,
    mobileWalletInfo,
  };
}

// ── the case matrix ───────────────────────────────────────────────────

/** Transaction options per variant (flag off: no 'v1' anywhere). 2.4.0 (as 2.2.1) has no `txVersion`: 'v0' is passed and ignored. */
export const MOBILE_VARIANTS = {
  omit: {},
  v0: { txVersion: 'v0' },
  cu50k: { computeUnitLimit: 50_000 },
  feeToken: { feeToken: FEE_TOKEN },
};

/**
 * Paymaster / chain faults on the flag-off path: the error handling around a
 * send (`signAndExecuteTransaction`, `sendAndConfirm`, the 3006 log lookups),
 * which the v1 change touches, must stay byte- and call-identical.
 *
 *   sends[i]     the answer to the i-th signAndSendTransaction (then: success)
 *   always       the answer to every signAndSendTransaction
 *   landedErr    the on-chain error a landed transaction's status reports
 *   simulateLogs the logs simulateTransaction returns
 *
 * An answer: { error } (a JSON-RPC error, nothing sent), { error, land: true }
 * (sent and landed with `landedErr`, the error names its signature in
 * `data.signature`), or { http, text } (a gateway answer).
 */
export const FAULTS = {
  internalError: {
    describe: 'every send refused with a JSON-RPC internal error (-32603), nothing sent',
    always: { error: { code: -32603, message: 'Internal error: upstream RPC unavailable' } },
  },
  internalErrorOnce: {
    describe: 'the first send refused with -32603, the next one lands',
    sends: [{ error: { code: -32603, message: 'Internal error: upstream RPC unavailable' } }],
  },
  http502Once: {
    describe: 'the first send answered by a gateway 502 (may have been sent), the next one lands',
    sends: [{ http: 502, text: 'Bad Gateway' }],
  },
  reused3006Kora: {
    describe: "every send refused with Kora's 3006 text (no logs); simulateTransaction logs name LazorKit as the program failing with 0xbbe",
    always: { error: { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(1, Custom(3006))' } },
    simulateLogs: (lk) => [`Program ${lk} invoke [1]`, `Program ${lk} consumed 9000 of 200000 compute units`, `Program ${lk} failed: custom program error: 0xbbe`],
  },
  reused3006Inner: {
    describe: "every send refused with Kora's 3006 text; simulateTransaction logs name an inner program as the first to fail with 0xbbe",
    always: { error: { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(1, Custom(3006))' } },
    simulateLogs: (lk) => [
      `Program ${lk} invoke [1]`,
      `Program ${NOOP_PROGRAM} invoke [2]`,
      `Program ${NOOP_PROGRAM} failed: custom program error: 0xbbe`,
      `Program ${lk} failed: custom program error: 0xbbe`,
    ],
  },
  alreadyProcessed: {
    describe: 'every send refused as already processed (the same bytes landed before)',
    always: { error: { code: -32002, message: 'Transaction simulation failed: This transaction has already been processed' } },
  },
  landed3006: {
    describe: 'the send lands, and its status reports InstructionError(1, Custom(3006)); getTransaction has no record',
    landedErr: { InstructionError: [1, { Custom: 3006 }] },
  },
  sentThenFailed: {
    describe: 'the paymaster sent it and reports its signature with an error; it landed with InstructionError(1, Custom(1))',
    sends: [{ error: { code: -32002, message: 'Transaction failed: custom program error: 0x1' }, land: true }],
    landedErr: { InstructionError: [1, { Custom: 1 }] },
  },
};

function mobile(flow, payload, variant, extra = {}) {
  const id = `mobile/${flow}/${payload}/${variant}${extra.fault ? `+${extra.fault}` : ''}`;
  return { id, pkg: 'mobile', flow, payload, variant, ...extra };
}

/**
 * Flows (one case = one fresh process):
 *   execute          signAndExecuteTransaction, passkey
 *   execute-register the same, with the fee payer's FeeRecord absent (RegisterPayer is prepended)
 *   session          signAndSendWithSession (Ed25519 session key)
 *   authorizeAndExecute  the bundled deferred pair (tx1 Authorize, tx2 ExecuteDeferred)
 *   deferred         authorizeDeferred, then executeDeferred with its payload (same options both)
 *   transferSol      transferSol (a passkey Execute of one transfer)
 *   execute-pair     two passkey Executes back to back (the second reads past the first: minContextSlot)
 *
 * A case id is `mobile/<flow>/<payload>/<variant>[+<fault>]` (FAULTS above).
 */
export function caseMatrix() {
  const cases = [];
  const mobV = ['omit', 'v0'];
  for (const p of ['transfer1', 'lutFits', 'payload2k2', 'payload2k2NoAlt']) for (const v of mobV) cases.push(mobile('execute', p, v));
  for (const v of ['cu50k', 'feeToken']) cases.push(mobile('execute', 'transfer1', v));
  cases.push(mobile('execute', 'lutFits', 'cu50k'));
  for (const v of mobV) cases.push(mobile('execute-register', 'transfer1', v, { noFeeRecord: true }));
  for (const f of ['session', 'authorizeAndExecute', 'deferred']) {
    for (const p of ['transfer1', 'lutFits']) for (const v of mobV) cases.push(mobile(f, p, v));
    for (const v of ['cu50k', 'feeToken']) cases.push(mobile(f, 'transfer1', v));
  }
  for (const v of mobV) cases.push(mobile('transferSol', 'transfer1', v));
  cases.push(mobile('execute-pair', 'transfer1', 'omit'));
  for (const fault of Object.keys(FAULTS)) cases.push(mobile('execute', 'transfer1', 'omit', { fault }));
  for (const fault of ['reused3006Kora', 'landed3006']) cases.push(mobile('session', 'transfer1', 'omit', { fault }));
  return cases;
}
