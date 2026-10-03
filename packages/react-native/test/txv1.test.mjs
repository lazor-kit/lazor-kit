// The v1 writer (txv1.ts), offline, on Node 18 or later: U1 the golden
// vectors, U2 edges and guards, U3 signing (with a secret key, or by a key
// that signs the message itself) and the web3.js read-back, U6 the
// program ceilings, and the limit policy, v0 measurement, WebAuthn
// placeholder and errors. The kit 8.4.0 differential (U11) is
// tools/txv1-oracle.
//
// This file is byte-identical in packages/react/test and
// packages/react-native/test (scripts/check-txv1-identical.mjs). Each copy
// loads its own package's txv1.ts, through TypeScript's transpileModule
// (types are checked by the typecheck and build), with that package's
// @solana/web3.js; @noble/curves, which the writer does not import, checks
// its signatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import ts from 'typescript';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = await loadWriter();
const VECTORS = JSON.parse(
  readFileSync(join(PACKAGE, '..', '..', 'test-vectors', 'txv1.json'), 'utf8')
);
const LAZORKIT = new PublicKey('57bTNWqtYTJbWuLWASKo6GqUTAK6oFDUR5c6hEc6V8nv');
const SECP256R1 = new PublicKey('Secp256r1SigVerify1111111111111111111111111');
const COMPUTE_BUDGET = new PublicKey('ComputeBudget111111111111111111111111111111');

function writerSource() {
  return ['core/wallet/txv1.ts', 'src/core/wallet/txv1.ts']
    .map((path) => join(PACKAGE, path))
    .find((path) => existsSync(path));
}

async function loadWriter() {
  const source = writerSource();
  const code = ts.transpileModule(readFileSync(source, 'utf8'), {
    fileName: source,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
  }).outputText;
  // Under this package's node_modules, so its imports resolve to this package's dependencies.
  const dir = join(PACKAGE, 'node_modules', '.cache', 'txv1-test');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash('sha256').update(code).digest('hex').slice(0, 16)}.mjs`);
  if (!existsSync(file)) {
    writeFileSync(`${file}.${process.pid}`, code);
    renameSync(`${file}.${process.pid}`, file);
  }
  return import(pathToFileURL(file).href);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** The vectors' test keys: label L is the keypair of seed sha256('lazorkit-txv1-vector:' + L). */
function key(label) {
  const seed = createHash('sha256').update(`lazorkit-txv1-vector:${label}`).digest();
  return Keypair.fromSeed(seed);
}
const address = (label) => key(label).publicKey;
const blockhash = (label) =>
  new PublicKey(createHash('sha256').update(`blockhash:${label}`).digest()).toBase58();
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const ix = (programId, keys = [], dataLength = 0) =>
  new TransactionInstruction({ programId, keys, data: Buffer.alloc(dataLength, 7) });
const CONFIG = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 196_608 };
const PAYER = address('payer');
const accounts = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => meta(address(`account-${from + i}`), false, i % 2 === 0));
const compile = (instructions, extra = {}) =>
  T.compileTransactionV1({
    payer: PAYER,
    blockhash: blockhash('test'),
    instructions,
    config: CONFIG,
    ...extra,
  });
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

function decodeInput(input) {
  return {
    payer: new PublicKey(input.payer),
    blockhash: input.blockhash,
    config: {
      computeUnitLimit: input.config.computeUnitLimit,
      loadedAccountsDataSizeLimit: input.config.loadedAccountsDataSizeLimit,
      ...(input.config.priorityFeeLamports !== undefined
        ? { priorityFeeLamports: BigInt(input.config.priorityFeeLamports) }
        : {}),
    },
    instructions: input.instructions.map(
      (i) =>
        new TransactionInstruction({
          programId: new PublicKey(i.programId),
          keys: i.keys.map((k) => meta(new PublicKey(k.pubkey), k.isSigner, k.isWritable)),
          data: Buffer.from(i.data, 'base64'),
        })
    ),
  };
}

/** What web3.js reads from v1 wire bytes: payer, blockhash, config, instructions with their flags. */
function web3Meaning(wire) {
  const tx = VersionedTransaction.deserialize(wire);
  const message = TransactionMessage.decompile(tx.message);
  return JSON.stringify({
    version: tx.version,
    payer: message.payerKey.toBase58(),
    blockhash: message.recentBlockhash,
    config: tx.message.transactionConfig,
    instructions: message.instructions.map((i) => [
      i.programId.toBase58(),
      i.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      base64(i.data),
    ]),
  });
}

/** The input's meaning, with the one role per address the wire format gives. */
function inputMeaning({ payer, blockhash: lifetime, instructions, config }) {
  const roles = new Map([[payer.toBase58(), [true, true]]]);
  for (const i of instructions) {
    for (const k of i.keys) {
      const [s, w] = roles.get(k.pubkey.toBase58()) ?? [false, false];
      roles.set(k.pubkey.toBase58(), [s || k.isSigner, w || k.isWritable]);
    }
  }
  return JSON.stringify({
    version: 1,
    payer: payer.toBase58(),
    blockhash: lifetime,
    config: {
      computeUnitLimit: config.computeUnitLimit,
      heapSize: null,
      loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit,
      priorityFee:
        config.priorityFeeLamports === undefined ? null : Number(config.priorityFeeLamports),
    },
    instructions: instructions.map((i) => [
      i.programId.toBase58(),
      i.keys.map((k) => [k.pubkey.toBase58(), ...roles.get(k.pubkey.toBase58())]),
      base64(i.data),
    ]),
  });
}

// ─── U1: golden vectors ─────────────────────────────────────────────────────

test('U1: the vector keys are the documented test keys', () => {
  for (const [label, expected] of Object.entries(VECTORS.keys)) {
    assert.equal(address(label).toBase58(), expected, label);
  }
});

test('U1: every golden vector reproduces byte for byte, signatures included', () => {
  assert.ok(VECTORS.vectors.length >= 13);
  for (const vector of VECTORS.vectors) {
    const { expected } = vector;
    const compiled = T.compileTransactionV1(decodeInput(vector.input));
    assert.equal(compiled.fits, expected.fits, vector.name);
    assert.equal(compiled.overflow, expected.overflow, vector.name);
    for (const field of ['bytes', 'addresses', 'instructions', 'signers']) {
      assert.equal(compiled[field], expected[field], `${vector.name}: ${field}`);
    }
    if (!expected.fits) {
      assert.equal(compiled.wire, undefined, vector.name);
      continue;
    }
    assert.equal(compiled.messageLength, expected.messageLength, vector.name);
    assert.equal(base64(compiled.wire), expected.unsigned, `${vector.name}: unsigned bytes`);
    const signed = T.signTransactionV1(compiled, vector.sign.map(key));
    expected.signatures.forEach((signature, i) => {
      const at = compiled.messageLength + 64 * i;
      const slot = signed.subarray(at, at + 64);
      assert.equal(
        slot.some((b) => b !== 0) ? base64(slot) : null,
        signature,
        `${vector.name}: signature ${i}`
      );
    });
  }
});

test('U1: the shapes match the design: passkey Execute 949 B / 12, Ed25519 565 / 11, tx2 2205 / 58', () => {
  const byName = new Map(VECTORS.vectors.map((v) => [v.name, v.expected]));
  const shape = (name) => [byName.get(name).bytes, byName.get(name).addresses];
  assert.deepEqual(shape('passkey-execute-1-transfer'), [949, 12]);
  assert.deepEqual(shape('ed25519-execute-2-signers'), [565, 11]);
  assert.deepEqual(shape('authorize-tx1'), [896, 9]);
  assert.deepEqual(shape('execute-deferred-tx2-1-transfer'), [487, 10]);
  assert.deepEqual(shape('execute-deferred-tx2-58-addresses'), [2205, 58]);
  assert.deepEqual(shape('execute-4096-bytes'), [4096, 64]);
});

test('U1: each v1 transaction that landed on devnet re-encodes to its size and meaning', () => {
  assert.equal(VECTORS.landed.length, 8);
  for (const landed of VECTORS.landed) {
    const wire = Buffer.from(landed.wire, 'base64');
    const tx = VersionedTransaction.deserialize(wire);
    const { payerKey, recentBlockhash, instructions } = TransactionMessage.decompile(tx.message);
    const c = tx.message.transactionConfig;
    const compiled = T.compileTransactionV1({
      payer: payerKey,
      blockhash: recentBlockhash,
      instructions,
      config: {
        computeUnitLimit: c.computeUnitLimit,
        loadedAccountsDataSizeLimit: c.loadedAccountsDataSizeLimit,
        ...(c.priorityFee !== null ? { priorityFeeLamports: BigInt(c.priorityFee) } : {}),
      },
    });
    assert.equal(compiled.bytes, wire.length, landed.name);
    assert.equal(web3Meaning(compiled.wire), web3Meaning(wire), landed.name);
  }
});

test('the v0 compiler the writer uses gives the legacy compiler’s header, keys and indexes', () => {
  for (const vector of VECTORS.vectors.filter((v) => v.expected.fits)) {
    const { payer, blockhash: recentBlockhash, instructions } = decodeInput(vector.input);
    const args = { payerKey: payer, recentBlockhash, instructions };
    const v0 = new TransactionMessage(args).compileToV0Message();
    const legacy = new TransactionMessage(args).compileToLegacyMessage();
    const view = (header, keys, compiled) =>
      JSON.stringify([
        header,
        keys.map((k) => k.toBase58()),
        compiled.map((i) => [i.programIdIndex, i.accountKeyIndexes, base64(i.data)]),
      ]);
    assert.equal(
      view(v0.header, v0.staticAccountKeys, v0.compiledInstructions),
      view(legacy.header, legacy.accountKeys, legacy.compiledInstructions),
      vector.name
    );
  }
});

// ─── U2: edges and guards ───────────────────────────────────────────────────

test('U2: at every limit it fits; one over, it returns fits:false and the limit, without throwing', () => {
  const program = address('program-a');
  const cases = [
    // [name, instructions, expected overflow or undefined]
    ['64 addresses', [ix(program, accounts(62))], undefined],
    ['65 addresses', [ix(program, accounts(63))], 'addresses'],
    [
      '12 signers',
      [
        ix(
          program,
          accounts(11).map((m) => ({ ...m, isSigner: true }))
        ),
      ],
      undefined,
    ],
    [
      '13 signers',
      [
        ix(
          program,
          accounts(12).map((m) => ({ ...m, isSigner: true }))
        ),
      ],
      'signers',
    ],
    ['64 instructions', Array.from({ length: 64 }, () => ix(program)), undefined],
    ['65 instructions', Array.from({ length: 65 }, () => ix(program)), 'instructions'],
    ['255 accounts in one instruction', [ix(program, Array(255).fill(meta(PAYER)))], undefined],
    [
      '256 accounts in one instruction',
      [ix(program, Array(256).fill(meta(PAYER)))],
      'accounts-per-ix',
    ],
    ['65,536 data bytes in one instruction', [ix(program, [], 65_536)], 'data-per-ix'],
  ];
  for (const [name, instructions, overflow] of cases) {
    const compiled = compile(instructions);
    assert.equal(compiled.overflow, overflow, name);
    assert.equal(compiled.fits, overflow === undefined, name);
  }
  // Bytes: grow the data until the transaction is 4096, then one more.
  const base = compile([ix(program, accounts(10))]).bytes;
  const at4096 = compile([ix(program, accounts(10), 4096 - base)]);
  assert.equal(at4096.bytes, 4096);
  assert.equal(at4096.fits, true);
  assert.equal(at4096.wire.length, 4096);
  const at4097 = compile([ix(program, accounts(10), 4097 - base)]);
  assert.deepEqual(
    [at4097.fits, at4097.overflow, at4097.bytes, at4097.wire],
    [false, 'bytes', 4097, undefined]
  );
});

test('U2: an instruction whose program is the fee payer throws: the runtime refuses that message', () => {
  const program = address('program-a');
  // web3.js compiles it, to program index 0, which Agave's sanitize refuses.
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: blockhash('test'),
    instructions: [ix(PAYER)],
  }).compileToV0Message();
  assert.equal(message.compiledInstructions[0].programIdIndex, 0);
  for (const [name, instructions] of [
    ['alone', [ix(PAYER)]],
    ['second, with accounts and data', [ix(program, accounts(2)), ix(PAYER, accounts(3), 8)]],
    // A malformed message, not a size: it throws even when over a limit.
    ['over 64 addresses', [ix(program, accounts(70)), ix(PAYER)]],
  ]) {
    assert.throws(
      () => compile(instructions),
      (e) => e instanceof TypeError && /instruction \d+'s program is the fee payer/.test(e.message),
      name
    );
  }
  // The fee payer as an account of an instruction is fine.
  assert.equal(compile([ix(program, [meta(PAYER, true, true)])]).fits, true);
});

test('U2: the first limit broken is reported, in a fixed order', () => {
  const program = address('program-a');
  // 70 addresses, 13 signers and over 4096 bytes: addresses comes first.
  const compiled = compile([
    ix(
      program,
      [...accounts(55), ...accounts(12, 100).map((m) => ({ ...m, isSigner: true }))],
      2000
    ),
  ]);
  assert.equal(compiled.overflow, 'addresses');
  assert.equal(compiled.addresses, 1 + 1 + 55 + 12);
  assert.equal(compiled.signers, 13);
});

test('U2: a config without both limits, or a limit out of range, throws', () => {
  const instructions = [ix(address('program-a'))];
  const bad = [
    {},
    { loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: 200_000 },
    { computeUnitLimit: 0, loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: 1_400_001, loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: 1.5, loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: Number.NaN, loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: '200000', loadedAccountsDataSizeLimit: 196_608 },
    { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 0 },
    { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 + 1 },
  ];
  for (const config of bad) {
    assert.throws(() => compile(instructions, { config }), RangeError, JSON.stringify(config));
  }
  assert.throws(() => compile(instructions, { config: undefined }), TypeError);
  // At the edges, it accepts.
  for (const config of [
    { computeUnitLimit: 1, loadedAccountsDataSizeLimit: 1 },
    { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 },
  ]) {
    assert.equal(compile(instructions, { config }).fits, true);
  }
});

test('U2: a heap request, an unknown config field, or a fee that is not a u64 throws', () => {
  const instructions = [ix(address('program-a'))];
  const config = (extra) => ({ config: { ...CONFIG, ...extra } });
  assert.throws(() => compile(instructions, config({ heapSize: 65_536 })), /heap/);
  assert.throws(() => compile(instructions, config({ configMask: 1 })), /unknown config field/);
  assert.throws(() => compile(instructions, config({ priorityFeeLamports: 1000 })), TypeError);
  assert.throws(() => compile(instructions, config({ priorityFeeLamports: -1n })), RangeError);
  assert.throws(
    () => compile(instructions, config({ priorityFeeLamports: 1n << 64n })),
    RangeError
  );
  // An undefined field is absent, as in kit.
  assert.equal(compile(instructions, config({ heapSize: undefined })).fits, true);
});

test('U2: the fee bits are both set or both clear, and the config is written in bit order', () => {
  const instructions = [ix(address('program-a'))];
  const view = (extra) => {
    const c = compile(instructions, { config: { ...CONFIG, ...extra } });
    const wire = Buffer.from(c.wire);
    return { mask: wire.readUInt32LE(4), values: wire.subarray(42 + 64, c.messageLength - 4) };
  };
  const none = view({});
  assert.equal(none.mask, 0b1100);
  assert.equal(none.values.readUInt32LE(0), 200_000);
  assert.equal(none.values.readUInt32LE(4), 196_608);
  const zero = view({ priorityFeeLamports: 0n });
  assert.equal(zero.mask, 0b1111);
  assert.equal(zero.values.readBigUInt64LE(0), 0n);
  assert.equal(zero.values.readUInt32LE(8), 200_000);
  const max = view({ priorityFeeLamports: (1n << 64n) - 1n });
  assert.equal(max.mask, 0b1111);
  assert.equal(max.values.readBigUInt64LE(0), (1n << 64n) - 1n);
  assert.equal(max.values.readUInt32LE(12), 196_608);
});

test('U2: a blockhash that is not 32 bytes of base58 throws', () => {
  const instructions = [ix(address('program-a'))];
  for (const bad of ['', 'abc', '0OIl', `${blockhash('x')}1`]) {
    assert.throws(() => compile(instructions, { blockhash: bad }), TypeError, bad);
  }
});

test('U2: assertV1Instructions refuses a ComputeBudget instruction and a Secp256r1 not followed by LazorKit', () => {
  const secp = ix(SECP256R1, [], 183);
  const execute = ix(LAZORKIT, [meta(PAYER, true, true)], 249);
  const register = ix(LAZORKIT, [meta(PAYER, true, true)], 9);
  const budget = ix(COMPUTE_BUDGET, [], 5);
  const other = ix(address('program-a'));
  T.assertV1Instructions([secp, execute], LAZORKIT);
  T.assertV1Instructions([register, secp, execute], LAZORKIT);
  T.assertV1Instructions([execute], LAZORKIT);
  T.assertV1Instructions([], LAZORKIT);
  for (const [name, list] of [
    ['ComputeBudget first', [budget, secp, execute]],
    ['ComputeBudget between', [secp, budget, execute]],
    ['ComputeBudget last', [secp, execute, budget]],
  ]) {
    assert.throws(() => T.assertV1Instructions(list, LAZORKIT), /ComputeBudget/, name);
  }
  for (const [name, list] of [
    ['Secp256r1 last', [execute, secp]],
    ['Secp256r1 then another program', [secp, other, execute]],
    ['Secp256r1 then another LazorKit id', [secp, ix(address('program-b'))]],
  ]) {
    assert.throws(() => T.assertV1Instructions(list, LAZORKIT), /Secp256r1/, name);
  }
});

// ─── U3: signing and read-back ──────────────────────────────────────────────

test('U3: each signature is in its signer’s slot and verifies; an absent signer’s slot stays empty', () => {
  const authority = key('authority');
  const compiled = compile([
    ix(
      LAZORKIT,
      [meta(PAYER, true, true), meta(authority.publicKey, true, false), ...accounts(3)],
      20
    ),
  ]);
  assert.equal(compiled.signers, 2);
  const message = compiled.wire.subarray(0, compiled.messageLength);
  const slot = (wire, i) =>
    wire.subarray(compiled.messageLength + 64 * i, compiled.messageLength + 64 * (i + 1));
  // The wallet signs the authority's slot; the paymaster's (fee payer, slot 0) stays empty.
  const walletSigned = T.signTransactionV1(compiled, [authority]);
  assert.ok(slot(walletSigned, 0).every((b) => b === 0));
  assert.ok(ed25519.verify(slot(walletSigned, 1), message, authority.publicKey.toBytes()));
  // The fee payer's signature goes in slot 0, over the same message.
  const signed = T.signTransactionV1({ ...compiled, wire: walletSigned }, [key('payer')]);
  assert.ok(ed25519.verify(slot(signed, 0), message, PAYER.toBytes()));
  assert.deepEqual(slot(signed, 1), slot(walletSigned, 1));
});

test('U3: web3.js 1.99 reads back version 1, the keys, the instructions and the config', () => {
  const signer = key('signer-1');
  const input = {
    payer: PAYER,
    blockhash: blockhash('read-back'),
    instructions: [
      ix(address('program-a'), [meta(signer.publicKey, true, false), ...accounts(4)], 33),
      ix(address('program-b'), [meta(address('account-0')), meta(PAYER)], 0),
    ],
    config: {
      computeUnitLimit: 61_194,
      loadedAccountsDataSizeLimit: 2_654_208,
      priorityFeeLamports: 5_000n,
    },
  };
  const compiled = T.compileTransactionV1(input);
  const wire = T.signTransactionV1(compiled, [key('payer'), signer]);
  const tx = VersionedTransaction.deserialize(wire);
  assert.equal(tx.version, 1);
  assert.equal(wire[0], 0x81);
  assert.deepEqual(
    tx.message.staticAccountKeys.map((k) => k.toBase58()),
    new TransactionMessage({
      payerKey: PAYER,
      recentBlockhash: input.blockhash,
      instructions: input.instructions,
    })
      .compileToV0Message()
      .staticAccountKeys.map((k) => k.toBase58())
  );
  assert.equal(web3Meaning(wire), inputMeaning(input));
  tx.signatures.forEach((signature, i) => {
    const signerKey = tx.message.staticAccountKeys[i];
    assert.ok(
      ed25519.verify(
        signature,
        compiled.wire.subarray(0, compiled.messageLength),
        signerKey.toBytes()
      )
    );
  });
});

test('U3: signing is deterministic and leaves the compiled bytes alone', () => {
  const compiled = compile([ix(address('program-a'), accounts(3), 10)]);
  const before = base64(compiled.wire);
  const a = T.signTransactionV1(compiled, [key('payer')]);
  const b = T.signTransactionV1(compiled, [key('payer')]);
  assert.equal(base64(a), base64(b));
  assert.equal(base64(compiled.wire), before);
  assert.notEqual(base64(a), before);
});

test('U3: signing refuses a key that is not a signer, a secret key that is not the key’s, and a transaction that does not fit', () => {
  const compiled = compile([ix(address('program-a'), accounts(3))]);
  assert.throws(() => T.signTransactionV1(compiled, [key('stranger')]), /not a signer/);
  const forged = { publicKey: PAYER, secretKey: key('stranger').secretKey };
  assert.throws(() => T.signTransactionV1(compiled, [forged]), /not its own/);
  // Another key's seed with this key's public half: the halves disagree.
  const spliced = new Uint8Array(64);
  spliced.set(key('stranger').secretKey.subarray(0, 32), 0);
  spliced.set(PAYER.toBytes(), 32);
  assert.throws(() => T.signTransactionV1(compiled, [{ publicKey: PAYER, secretKey: spliced }]), /not its own/);
  // The seed alone (32 bytes) is not a secret key.
  const seedOnly = { publicKey: PAYER, secretKey: key('payer').secretKey.slice(0, 32) };
  assert.throws(() => T.signTransactionV1(compiled, [seedOnly]), /not its own/);
  const tooBig = compile([ix(address('program-a'), accounts(63))]);
  assert.throws(() => T.signTransactionV1(tooBig, [key('payer')]), /does not fit/);
});

test('U3: the writer imports only @solana/web3.js and signs with its ed25519, so an app bundles one copy', () => {
  // An import of @noble/curves gave an app bundled with esbuild, which loads
  // web3.js's CommonJS build, a second, ESM copy of noble's ed25519.
  const source = readFileSync(writerSource(), 'utf8');
  const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
  assert.deepEqual(imports, ['@solana/web3.js']);
  assert.doesNotMatch(source, /\brequire\(|\bimport\(/, 'no other way in');
  // Standard RFC 8032 signatures: noble's, over the message, for every signer.
  const authority = key('authority');
  const compiled = compile([ix(LAZORKIT, [meta(authority.publicKey, true, false), ...accounts(2)], 9)]);
  const signed = T.signTransactionV1(compiled, [key('payer'), authority]);
  const message = compiled.wire.subarray(0, compiled.messageLength);
  [key('payer'), authority].forEach((signer, i) => {
    const at = compiled.messageLength + 64 * i;
    assert.deepEqual(
      signed.subarray(at, at + 64),
      ed25519.sign(message, signer.secretKey.subarray(0, 32)),
      `slot ${i}`
    );
  });
});

test('U3: signTransactionV1Async places what each key signs: on every vector, the bytes signTransactionV1 gives', async () => {
  // A key that signs the message itself (here noble, standing in for a
  // non-extractable WebCrypto key), and web3.js's signer behind the same
  // interface (keypairMessageSigner).
  const external = (keypair) => ({
    publicKey: keypair.publicKey,
    signMessage: async (message) => ed25519.sign(message, keypair.secretKey.subarray(0, 32)),
  });
  let signed = 0;
  for (const vector of VECTORS.vectors) {
    if (!vector.expected.fits) continue;
    const compiled = T.compileTransactionV1(decodeInput(vector.input));
    const keys = vector.sign.map(key);
    const expected = base64(T.signTransactionV1(compiled, keys));
    assert.equal(base64(await T.signTransactionV1Async(compiled, keys.map(external))), expected, vector.name);
    assert.equal(
      base64(await T.signTransactionV1Async(compiled, keys.map(T.keypairMessageSigner))),
      expected,
      vector.name
    );
    signed++;
  }
  assert.ok(signed >= 11);
  // The fee payer's slot stays empty, as with signTransactionV1.
  const authority = key('authority');
  const compiled = compile([ix(LAZORKIT, [meta(authority.publicKey, true, false), ...accounts(2)], 9)]);
  const wire = await T.signTransactionV1Async(compiled, [external(authority)]);
  assert.ok(wire.subarray(compiled.messageLength, compiled.messageLength + 64).every((b) => b === 0));
  assert.deepEqual(wire, T.signTransactionV1(compiled, [authority]));
});

test('U3: signTransactionV1Async asks no key to sign unless every key is a signer; each gets its own copy of the message', async () => {
  const authority = key('authority');
  const compiled = compile([ix(LAZORKIT, [meta(authority.publicKey, true, false), ...accounts(2)], 9)]);
  const message = compiled.wire.slice(0, compiled.messageLength);
  const before = base64(compiled.wire);
  const seen = [];
  const recording = (keypair, answer) => ({
    publicKey: keypair.publicKey,
    signMessage: async (bytes) => {
      seen.push(keypair.publicKey.toBase58());
      assert.deepEqual(bytes, message);
      const signature = answer ? answer(bytes) : ed25519.sign(bytes, keypair.secretKey.subarray(0, 32));
      bytes.fill(0xff); // a key that scribbles on what it was given changes nothing
      return signature;
    },
  });
  // A stranger anywhere in the list: nothing is signed, by anyone.
  await assert.rejects(
    T.signTransactionV1Async(compiled, [recording(authority), recording(key('stranger'))]),
    /not a signer/
  );
  assert.deepEqual(seen, []);
  // Both slots, one after the other, each from its own copy.
  const both = await T.signTransactionV1Async(compiled, [recording(key('payer')), recording(authority)]);
  assert.deepEqual(seen, [PAYER.toBase58(), authority.publicKey.toBase58()]);
  assert.deepEqual(both, T.signTransactionV1(compiled, [key('payer'), authority]));
  assert.equal(base64(compiled.wire), before);
  // An answer that is not a 64-byte signature is refused; the key's own error passes through.
  for (const answer of [() => new Uint8Array(63), () => new Uint8Array(65), () => Array(64).fill(1)]) {
    await assert.rejects(T.signTransactionV1Async(compiled, [recording(authority, answer)]), /is not 64 bytes/);
  }
  const refusing = { publicKey: authority.publicKey, signMessage: async () => { throw new Error('key refused'); } };
  await assert.rejects(T.signTransactionV1Async(compiled, [refusing]), /key refused/);
  // keypairMessageSigner checks the secret key as signTransactionV1 does.
  const forged = T.keypairMessageSigner({ publicKey: authority.publicKey, secretKey: key('stranger').secretKey });
  await assert.rejects(T.signTransactionV1Async(compiled, [forged]), /not its own/);
  const tooBig = compile([ix(address('program-a'), accounts(63))]);
  await assert.rejects(T.signTransactionV1Async(tooBig, [recording(key('payer'))]), /does not fit/);
});

// ─── U6: program ceilings ───────────────────────────────────────────────────

const inner = (...metaCounts) =>
  metaCounts.map((n) => ix(address('program-a'), Array(n).fill(meta(address('account-0')))));

test('U6: 16 inner instructions pass, 17 fail', () => {
  assert.deepEqual(T.checkProgramCeilings(inner(...Array(16).fill(1))), {
    innerInstructions: 16,
    maxMetas: 1,
    totalMetas: 32,
    heapBytes: 2_177,
  });
  assert.throws(
    () => T.checkProgramCeilings(inner(...Array(17).fill(1))),
    (e) => e instanceof T.PayloadExceedsProgramLimitsError && e.limit === 'inner-instructions'
  );
});

test('U6: the limit is the 32 KiB heap less its 8-byte cursor, with no margin kept', () => {
  assert.equal(T.LAZORKIT_HEAP_BYTES, 32_768);
  assert.equal(T.LAZORKIT_HEAP_USABLE_BYTES, 32_760);
  assert.equal(T.LAZORKIT_HEAP_MARGIN_BYTES, 0);
  assert.equal(T.LAZORKIT_HEAP_LIMIT_BYTES, 32_760);
  assert.equal(T.LAZORKIT_MAX_POLICY_ACTIONS, 16);
});

/**
 * A payload in the shorthand of the measurements below: "KxM" is K inner
 * instructions of M accounts, "A,B,…" one of A accounts, one of B, …; each
 * has `data` bytes of data (12, a System transfer's, unless given), and "+N"
 * adds N bytes to the last one's.
 */
function heapShape(text, data = 12) {
  const [shape, extra = '0'] = text.split('+');
  const counts = shape.includes('x')
    ? Array(Number(shape.split('x')[0])).fill(Number(shape.split('x')[1]))
    : shape.split(',').map(Number);
  return counts.map((m, i) =>
    ix(
      address('program-a'),
      Array(m).fill(meta(address('account-0'))),
      data + (i === counts.length - 1 ? Number(extra) : 0)
    )
  );
}

const fits = (shape, path, policy) =>
  T.lazorkitHeapBytes(shape, path, policy) <= T.LAZORKIT_HEAP_USABLE_BYTES;

function assertRefused(shape, path, policy, label) {
  assert.throws(
    () => T.checkProgramCeilings(shape, path, policy),
    (e) =>
      e instanceof T.PayloadExceedsProgramLimitsError &&
      e.limit === 'heap' &&
      e.heapBytes > T.LAZORKIT_HEAP_USABLE_BYTES &&
      e.heapBytes === T.lazorkitHeapBytes(shape, path, policy) &&
      e.innerInstructions === shape.length &&
      e.maxMetas === Math.max(...shape.map((i) => i.keys.length)) &&
      e.totalMetas === shape.reduce((n, i) => n + 1 + i.keys.length, 0) &&
      JSON.stringify(e.policy) === JSON.stringify(policy),
    label
  );
}

// lazorkit-protocol program/tests/heap_capacity_tests.rs (#42, develop
// 3979196), against the build with exact sizing: SPL Memo v1 instructions
// with 8 bytes of data ("lazorkit"), run in litesvm. Landed, or ran out of
// memory; and the sums its comments give for three of them.
const PROGRAM_MEMO_DATA = 8;
const HEAP_IN_THE_PROGRAM_TESTS = {
  secp256r1: {
    lands: [
      '127',
      '64,64',
      '128',
      '70,70',
      '100,30',
      '100,100',
      '128,64,32',
      '16x16',
      '8x32',
      '16x24',
      '8x64',
      '16x8',
    ],
    outOfMemory: ['16x64'],
    bytes: [
      ['128', 14_888],
      ['70,70', 11_310],
      ['100,30', 13_046],
    ],
  },
  deferred: { lands: ['128', '70,70', '16x16'], outOfMemory: [] },
  ed25519: { lands: ['2x128', '16x128'], outOfMemory: [] },
};

test('U6: what the program’s heap tests landed passes, and what ran out of memory is refused', () => {
  for (const [path, measured] of Object.entries(HEAP_IN_THE_PROGRAM_TESTS)) {
    for (const text of measured.lands) {
      const result = T.checkProgramCeilings(heapShape(text, PROGRAM_MEMO_DATA), path);
      assert.ok(result.heapBytes <= T.LAZORKIT_HEAP_USABLE_BYTES, `${path} ${text}`);
    }
    for (const text of measured.outOfMemory) {
      assertRefused(heapShape(text, PROGRAM_MEMO_DATA), path, undefined, `${path} ${text}`);
    }
    for (const [text, bytes] of measured.bytes ?? []) {
      const shape = heapShape(text, PROGRAM_MEMO_DATA);
      assert.equal(T.lazorkitHeapBytes(shape, path), bytes, `${path} ${text}`);
    }
  }
});

// docs/Architecture.md, "Transaction v1": for k equal inner instructions with
// 12 bytes of data each, the most accounts each can have on the exact build
// (255 is the format's maximum); and lazorkit-protocol#42's table at 8 bytes,
// where only the passkey path moves (data is part of what it signs).
const LARGEST_EQUAL = {
  12: {
    secp256r1: { 1: 255, 2: 205, 4: 132, 8: 76, 12: 53, 16: 40 },
    deferred: { 1: 255, 2: 208, 4: 135, 8: 78, 12: 55, 16: 42 },
    ed25519: { 1: 255, 2: 255, 4: 255, 8: 224, 12: 179, 16: 148 },
  },
  8: {
    secp256r1: { 1: 255, 2: 205, 4: 132, 8: 76, 16: 41 },
    deferred: { 1: 255, 2: 208, 4: 135, 8: 78, 16: 42 },
    ed25519: { 1: 255, 2: 255, 4: 255, 8: 224, 16: 148 },
  },
};

test('U6: the largest equal payloads on each path are the program’s tables, one account more is refused', () => {
  for (const [data, paths] of Object.entries(LARGEST_EQUAL)) {
    for (const [path, row] of Object.entries(paths)) {
      for (const [k, most] of Object.entries(row)) {
        const label = `${path}, ${k} × ${most}, ${data} B of data`;
        T.checkProgramCeilings(heapShape(`${k}x${most}`, Number(data)), path);
        if (most < 255) {
          assertRefused(heapShape(`${k}x${most + 1}`, Number(data)), path, undefined, label);
        }
      }
    }
  }
});

// The policy path (heap_capacity_tests.rs, "The policy path"): a signer whose
// policy holds sixteen actions, `t` vault token accounts, one listed SPL
// Transfer (3 accounts, 9 bytes) and then System transfers (12 bytes) of the
// given widths.
const SPL_TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
function policyShape(widths) {
  const vault = meta(address('vault'), false, true);
  const vaultToken = meta(address('vault-token-0'), false, true);
  const transfer = [vaultToken, meta(address('destination'), false, true), meta(address('vault'))];
  return [
    ix(SPL_TOKEN, transfer, 9),
    ...widths.map((n) => ix(SYSTEM, [vault, vault, ...Array(n - 2).fill(vaultToken)], 12)),
  ];
}
const sixteen = (t) => ({ actions: 16, vaultTokenAccounts: t });

test('U6: on the policy path, the program’s boundary shapes are accepted and refused where it ran and ran out', () => {
  // policy_session_at_the_v1_address_cap: 52 vault token accounts.
  T.checkProgramCeilings(policyShape(Array(15).fill(89)), 'ed25519', sixteen(52));
  assertRefused(policyShape(Array(15).fill(90)), 'ed25519', sixteen(52), 'session, 15 × 90');
  // policy_passkey_delegate_at_the_v1_address_cap: 51.
  T.checkProgramCeilings(policyShape(Array(15).fill(24)), 'secp256r1', sixteen(51));
  assertRefused(policyShape(Array(15).fill(25)), 'secp256r1', sixteen(51), 'Delegate, 15 × 25');
  // policy_passkey_delegate_past_a_check_without_the_policy_terms: 49, to the byte.
  const [twelveOf31, twelveOf32] = [31, 32].map((n) => policyShape(Array(12).fill(n)));
  assert.equal(T.lazorkitHeapBytes(twelveOf31, 'secp256r1', sixteen(49)), 32_392);
  assert.equal(T.lazorkitHeapBytes(twelveOf32, 'secp256r1', sixteen(49)), 32_968);
  assertRefused(twelveOf32, 'secp256r1', sixteen(49), 'passkey Delegate, 12 × 32');
  // ...which a check without the policy terms passes.
  assert.ok(T.checkProgramCeilings(twelveOf32, 'secp256r1').heapBytes < 32_760);
  // policy_session_at_the_legacy_size_cap: 19, the listed transfer alone.
  T.checkProgramCeilings(policyShape([]), 'ed25519', sixteen(19));
});

test('U6: on the policy path, the largest equal payloads at the v1 address cap are Architecture.md’s table', () => {
  const table = {
    session: { path: 'ed25519', t: 52, most: { 2: 236, 4: 192, 8: 139, 16: 89 } },
    delegate: { path: 'secp256r1', t: 51, most: { 2: 166, 4: 94, 8: 49, 16: 24 } },
  };
  for (const [signer, { path, t, most }] of Object.entries(table)) {
    for (const [k, n] of Object.entries(most)) {
      const widths = (m) => Array(Number(k) - 1).fill(m);
      T.checkProgramCeilings(policyShape(widths(n)), path, sixteen(t));
      assertRefused(policyShape(widths(n + 1)), path, sixteen(t), `${signer}, k = ${k}, ${n + 1}`);
    }
  }
  // What a legacy transaction can carry needs at most 24,848 bytes beside a
  // session (3 vault token accounts, two instructions of 255 after the
  // transfer) and 30,976 beside a passkey Delegate (1, one of 255).
  assert.equal(T.lazorkitHeapBytes(policyShape([255, 255]), 'ed25519', sixteen(3)), 24_848);
  assert.equal(T.lazorkitHeapBytes(policyShape([255]), 'secp256r1', sixteen(1)), 30_976);
});

test('U6: the policy adds 32 bytes per action twice, and 192 + 48 per vault token account', () => {
  // Shapes whose last allocation already ends on 8 bytes, so only the terms differ.
  for (const [shape, path] of [
    [heapShape('2x64'), 'ed25519'],
    [heapShape('3x40'), 'secp256r1'],
  ]) {
    const none = T.lazorkitHeapBytes(shape, path);
    for (const [a, t] of [[1, 0], [16, 0], [1, 1], [5, 7], [16, 52]]) {
      assert.equal(
        T.lazorkitHeapBytes(shape, path, { actions: a, vaultTokenAccounts: t }),
        none + 64 * a + 240 * t,
        `${path} a=${a} t=${t}`
      );
    }
  }
});

test('U6: a policy is 1 to 16 actions, and never on ExecuteDeferred', () => {
  const shape = heapShape('2x8');
  assert.throws(() => T.lazorkitHeapBytes(shape, 'deferred', sixteen(1)), TypeError);
  assert.throws(() => T.checkProgramCeilings(shape, 'deferred', sixteen(1)), TypeError);
  for (const policy of [
    { actions: 0, vaultTokenAccounts: 0 },
    { actions: 17, vaultTokenAccounts: 0 },
    { actions: 1.5, vaultTokenAccounts: 0 },
    { actions: 1, vaultTokenAccounts: -1 },
    { actions: 1 },
    null,
  ]) {
    assert.throws(
      () => T.checkProgramCeilings(shape, 'ed25519', policy),
      RangeError,
      JSON.stringify(policy)
    );
  }
  assert.deepEqual(T.checkProgramCeilings(shape, 'ed25519', sixteen(2)).policy, sixteen(2));
});

// What the devnet build before the exact sizing (3584aec7…, the same heap as
// efea949f…) did with these payloads on a local validator, for the shapes it
// ran out of memory on, and the route replays the old check measured.
const OUT_OF_MEMORY_BEFORE_THE_EXACT_SIZING = {
  secp256r1: ['16x16', '8x32', '16x24', '1x128', '2x70', '100,30', '80,80', '1x200'],
  ed25519: ['1x129', '1x200', '14x128', '16x120'],
  deferred: ['16x16', '14x17', '1x128', '2x70'],
};
const ROUTE_REPLAYS = {
  // [accounts, data bytes] per inner instruction, as docs/Architecture.md measured them.
  'SOL→USDC': [[[7, 1], [3, 12], [2, 1], [7, 1], [26, 36], [4, 1]], 4_596],
  'JUP→POPCAT': [[[7, 1], [57, 61]], 7_153],
  'BONK→WIF': [[[7, 1], [83, 71]], 10_155],
};

test('U6: what the old check refused for the build before the exact sizing now passes, as the program runs it', () => {
  for (const [path, shapes] of Object.entries(OUT_OF_MEMORY_BEFORE_THE_EXACT_SIZING)) {
    for (const text of shapes) {
      const { heapBytes } = T.checkProgramCeilings(heapShape(text), path);
      assert.ok(heapBytes <= 32_760, `${path} ${text}`);
    }
  }
  for (const [route, [shape, bytes]] of Object.entries(ROUTE_REPLAYS)) {
    const payload = shape.map(([m, d]) =>
      ix(address('program-a'), Array(m).fill(meta(address('account-0'))), d)
    );
    assert.equal(T.checkProgramCeilings(payload).heapBytes, bytes, route);
  }
});

test('U6: the passkey path allocates the most, and is the default', () => {
  for (const text of ['16x12', '1x127', '8x32', '13x29+102', '2x70']) {
    const shape = heapShape(text);
    const [secp256r1, deferred, ed25519] = ['secp256r1', 'deferred', 'ed25519'].map((path) =>
      T.lazorkitHeapBytes(shape, path)
    );
    assert.ok(secp256r1 > deferred && deferred > ed25519, text);
  }
  assert.deepEqual(
    ['secp256r1', 'deferred', 'ed25519'].map((path) =>
      T.lazorkitHeapBytes(heapShape('16x12'), path)
    ),
    [10_684, 10_156, 3_292]
  );
  assert.throws(
    () => T.checkProgramCeilings(heapShape('16x41')),
    T.PayloadExceedsProgramLimitsError
  );
  assert.equal(T.checkProgramCeilings(heapShape('16x41'), 'ed25519').heapBytes, 9_601);
});

// ─── U6: what a policy-bound signer brings ──────────────────────────────────

/** A v2 session or authority account: its fixed part, then `actions` as [type, data length]. */
function policyAccount(kind, actions) {
  const fixed = { session: [0x23, 0, 80], ed25519: [0x22, 0, 80], secp256r1: [0x22, 1, 145] }[kind];
  const parts = [Buffer.alloc(fixed[2])];
  parts[0][0] = fixed[0];
  parts[0][1] = fixed[1];
  for (const [type, length] of actions) {
    const header = Buffer.alloc(11);
    header[0] = type;
    header.writeUInt16LE(length, 1);
    header.writeBigUInt64LE(0n, 3);
    parts.push(header, Buffer.alloc(length, 0xab));
  }
  return new Uint8Array(Buffer.concat(parts));
}
// SolLimit 8, TokenLimit 40, TokenRecurringLimit 64, ProgramWhitelist 32 (state/action.rs).
const SOME_ACTIONS = [[1, 8], [4, 40], [5, 64], [10, 32]];

test('lazorkitPolicyActions: a session’s or authority’s actions, counted as the program counts them', () => {
  for (const kind of ['session', 'ed25519', 'secp256r1']) {
    assert.equal(T.lazorkitPolicyActions(policyAccount(kind, [])), 0, `${kind}, none`);
    assert.equal(T.lazorkitPolicyActions(policyAccount(kind, SOME_ACTIONS)), 4, kind);
    const sixteenActions = Array.from({ length: 16 }, (_, i) => SOME_ACTIONS[i % 4]);
    assert.equal(T.lazorkitPolicyActions(policyAccount(kind, sixteenActions)), 16, `${kind}, 16`);
    // The program counts one more and then refuses the policy; so does the check.
    const eighteen = policyAccount(kind, [...sixteenActions, [1, 8], [1, 8]]);
    const seventeen = T.lazorkitPolicyActions(eighteen);
    assert.equal(seventeen, 17, `${kind}, 18`);
    assert.throws(
      () => T.checkProgramCeilings([], 'ed25519', { actions: seventeen, vaultTokenAccounts: 0 }),
      RangeError
    );
  }
  // A passkey authority's key material is 145 bytes: an Ed25519 offset would read it as actions.
  assert.equal(T.lazorkitPolicyActions(policyAccount('secp256r1', [])), 0);
  assert.equal(T.lazorkitPolicyActions(policyAccount('ed25519', []).subarray(0, 48)), 0);
  // Another account kind, a v1 account, an unknown authority type, nothing: no policy.
  const other = policyAccount('session', SOME_ACTIONS);
  for (const disc of [0x21, 0x24, 0x02, 0x03]) {
    other[0] = disc;
    assert.equal(T.lazorkitPolicyActions(other), 0, `discriminator ${disc}`);
  }
  const unknownType = policyAccount('ed25519', SOME_ACTIONS);
  unknownType[1] = 9;
  assert.equal(T.lazorkitPolicyActions(unknownType), 0);
  assert.equal(T.lazorkitPolicyActions(new Uint8Array(0)), 0);
});

test('vaultTokenAccountsBound: the unique accounts the payload writes, less the vault and the fee payer', () => {
  const vault = address('vault');
  const feePayer = address('fee-payer');
  const [a, b, c] = ['token-a', 'token-b', 'token-c'].map(address);
  const payload = [
    ix(SPL_TOKEN, [meta(a, false, true), meta(b, false, true), meta(vault, true, false)], 9),
    ix(SYSTEM, [meta(vault, true, true), meta(feePayer, false, true)], 12),
    // token-a again, and token-c read-only here but writable below: each once.
    ix(address('program-a'), [meta(a, false, true), meta(c), meta(address('mint'))], 1),
    ix(address('program-b'), [meta(c, false, true)], 1),
  ];
  assert.equal(T.vaultTokenAccountsBound(payload, [vault, feePayer]), 3);
  assert.equal(T.vaultTokenAccountsBound(payload, [vault]), 4);
  assert.equal(T.vaultTokenAccountsBound(payload), 5);
  assert.equal(T.vaultTokenAccountsBound([], [vault]), 0);
});

test('signerPolicyHeap: nothing for a signer without actions, else its actions and the payload’s bound', () => {
  const vault = address('vault');
  const payload = policyShape([4, 4]);
  const policyOf = (signerAccountData) =>
    T.signerPolicyHeap({ signerAccountData, innerInstructions: payload, notTokenAccounts: [vault] });
  for (const kind of ['session', 'ed25519', 'secp256r1']) {
    assert.equal(policyOf(policyAccount(kind, [])), undefined, kind);
    assert.deepEqual(
      policyOf(policyAccount(kind, SOME_ACTIONS)),
      { actions: 4, vaultTokenAccounts: 2 },
      kind
    );
  }
});

// ─── Limits (the pure part of U7) ───────────────────────────────────────────

test('limits: the design’s examples, floors and caps', () => {
  const cu = T.computeUnitLimitFromSimulation;
  const lad = T.loadedAccountsDataSizeLimitFromSimulation;
  assert.equal(cu(13_011), 20_614);
  assert.equal(cu(46_828), 61_194);
  assert.equal(cu(107_163), 133_596);
  assert.equal(cu(0), 20_000);
  assert.equal(cu(12_500), 20_000);
  assert.equal(cu(10_000), 20_000);
  assert.equal(cu(50_000), 65_000); // exactly ×1.2: no float rounding up
  assert.equal(cu(1_200_000), 1_400_000);
  assert.equal(lad(161_320), 196_608);
  assert.equal(lad(414_796), 458_752);
  assert.equal(lad(2_407_845), 2_654_208);
  assert.equal(lad(0), 196_608);
  assert.equal(lad(70_000_000), 64 * 1024 * 1024);
});

test('limits: only a clean simulation is used; anything else gives the ceilings', () => {
  const ok = { err: null, unitsConsumed: 13_011, loadedAccountsDataSize: 161_320 };
  assert.deepEqual(T.limitsFromSimulation(ok), {
    config: { computeUnitLimit: 20_614, loadedAccountsDataSizeLimit: 196_608 },
    source: 'simulated',
  });
  const ceiling = {
    config: { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 },
    source: 'ceiling',
  };
  for (const sim of [
    undefined,
    null,
    { ...ok, err: { InstructionError: [1, { Custom: 3006 }] } },
    { ...ok, err: undefined },
    { ...ok, unitsConsumed: undefined },
    { ...ok, loadedAccountsDataSize: null },
    { ...ok, unitsConsumed: -1 },
    { ...ok, unitsConsumed: 1.5 },
    { ...ok, loadedAccountsDataSize: Number.NaN },
  ]) {
    assert.deepEqual(T.limitsFromSimulation(sim), ceiling, JSON.stringify(sim));
  }
  assert.deepEqual(T.TX_V1_CEILING_CONFIG, ceiling.config);
});

test('limits: a caller’s value wins; both mean no simulation is needed; out of range is a RangeError', () => {
  const ok = { err: null, unitsConsumed: 13_011, loadedAccountsDataSize: 161_320 };
  assert.deepEqual(
    T.limitsFromSimulation(undefined, {
      computeUnitLimit: 50_000,
      loadedAccountsDataSizeLimit: 262_144,
    }),
    { config: { computeUnitLimit: 50_000, loadedAccountsDataSizeLimit: 262_144 }, source: 'caller' }
  );
  assert.deepEqual(T.limitsFromSimulation(ok, { computeUnitLimit: 50_000 }).config, {
    computeUnitLimit: 50_000,
    loadedAccountsDataSizeLimit: 196_608,
  });
  assert.deepEqual(T.limitsFromSimulation(null, { loadedAccountsDataSizeLimit: 262_144 }).config, {
    computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 262_144,
  });
  for (const options of [
    { computeUnitLimit: 0 },
    { computeUnitLimit: 1_400_001 },
    { computeUnitLimit: 2.5 },
    { loadedAccountsDataSizeLimit: 196_607 },
    { loadedAccountsDataSizeLimit: 64 * 1024 * 1024 + 1 },
  ]) {
    assert.throws(() => T.assertTxV1LimitOptions(options), RangeError, JSON.stringify(options));
    assert.throws(() => T.limitsFromSimulation(ok, options), RangeError, JSON.stringify(options));
  }
  T.assertTxV1LimitOptions({ computeUnitLimit: 1, loadedAccountsDataSizeLimit: 196_608 });
  T.assertTxV1LimitOptions();
});

test('limits: a draft with the ceilings is as long as the final transaction', () => {
  const instructions = [ix(LAZORKIT, accounts(20), 900)];
  const draft = compile(instructions, { config: T.TX_V1_CEILING_CONFIG });
  const final = compile(instructions, {
    config: { computeUnitLimit: 20_614, loadedAccountsDataSizeLimit: 196_608 },
  });
  assert.equal(draft.bytes, final.bytes);
  assert.equal(draft.messageLength, final.messageLength);
});

// ─── v0 measurement ─────────────────────────────────────────────────────────

test('measureV0: a small transaction fits; bytes and accounts are explicit', () => {
  const measured = T.measureV0({
    payer: PAYER,
    blockhash: blockhash('v0'),
    instructions: [ix(address('program-a'), accounts(5), 100)],
  });
  assert.equal(measured.fits, true);
  assert.equal(measured.accounts, 7);
  assert.equal(measured.instructions, 1);
  const wire = new VersionedTransaction(
    new TransactionMessage({
      payerKey: PAYER,
      recentBlockhash: blockhash('v0'),
      instructions: [ix(address('program-a'), accounts(5), 100)],
    }).compileToV0Message()
  ).serialize();
  assert.equal(measured.bytes, wire.length);
});

test('measureV0: over 1232 bytes does not fit, whether or not web3.js can serialize it', () => {
  const measure = (dataLength) =>
    T.measureV0({
      payer: PAYER,
      blockhash: blockhash('v0'),
      instructions: [ix(address('program-a'), accounts(2), dataLength)],
    });
  // From 200 bytes of data on, the data's length prefix is 2 bytes, so size grows with data.
  const base = measure(200).bytes;
  const at1232 = measure(200 + 1232 - base);
  assert.deepEqual([at1232.bytes, at1232.fits], [1232, true]);
  // A message of at most 1232 bytes whose signature makes the transaction longer.
  const over = measure(200 + 1233 - base);
  assert.deepEqual([over.bytes, over.fits], [1233, false]);
  // A message over 1232 bytes: web3.js throws, so the size is unknown.
  const far = measure(2000);
  assert.deepEqual([far.fits, far.bytes, far.accounts], [false, null, 4]);
});

test('measureV0: lookup tables save bytes, not account locks', () => {
  const table = (n) =>
    new AddressLookupTableAccount({
      key: address('table'),
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: accounts(n).map((m) => m.pubkey),
      },
    });
  const measure = (n) =>
    T.measureV0({
      payer: PAYER,
      blockhash: blockhash('v0'),
      instructions: [ix(address('program-a'), accounts(n))],
      addressLookupTables: [table(n)],
    });
  const at64 = measure(62);
  assert.deepEqual([at64.fits, at64.accounts], [true, 64]);
  assert.ok(at64.bytes < 1232);
  const at65 = measure(63);
  assert.deepEqual([at65.fits, at65.accounts], [false, 65]);
  assert.ok(at65.bytes < 1232);
});

// ─── WebAuthn placeholder ───────────────────────────────────────────────────

test('placeholderWebAuthn: the worst-case lengths, never shorter than a padded Chrome response', () => {
  const portalOrigin = 'https://portal.lazor.sh';
  const topOrigin = 'https://app.example.com';
  const p = T.placeholderWebAuthn({ portalOrigin, topOrigin });
  assert.deepEqual(
    [p.signature.length, p.authenticatorData.length, p.clientDataJsonHash.length],
    [64, 37, 32]
  );
  const template =
    `{"type":"webauthn.get","challenge":"${'A'.repeat(43)}","origin":"${portalOrigin}",` +
    `"crossOrigin":true,"topOrigin":"${topOrigin}"}`;
  assert.equal(p.clientDataJson.length, template.length + 128);
  assert.equal(Buffer.from(p.clientDataJson).toString('utf8').trimEnd(), template);
  // Chrome adds a random field; it measured +109 bytes on devnet.
  const chrome =
    template.slice(0, -1) +
    ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}';
  assert.ok(p.clientDataJson.length >= Buffer.byteLength(chrome));
  // An unknown app origin is taken as 64 characters.
  const unknown = T.placeholderWebAuthn({ portalOrigin });
  assert.equal(unknown.clientDataJson.length, template.length - topOrigin.length + 64 + 128);
  // UTF-8, counted as the browser would encode it.
  const wide = T.placeholderWebAuthn({ portalOrigin, topOrigin: 'https://ví-dụ.example/😀' });
  const wideTemplate = template.replace(topOrigin, 'https://ví-dụ.example/😀');
  assert.equal(wide.clientDataJson.length, Buffer.byteLength(wideTemplate) + 128);
});

// ─── Errors ─────────────────────────────────────────────────────────────────

test('TransactionTooLargeError carries the measurement and its format’s limits', () => {
  const v1 = new T.TransactionTooLargeError({
    stage: 'before-signing',
    format: 'v1',
    transaction: 'single',
    bytes: 4200,
    addresses: 65,
    instructions: 2,
  });
  assert.ok(v1 instanceof Error);
  assert.equal(v1.name, 'TransactionTooLargeError');
  assert.deepEqual(
    [
      v1.stage,
      v1.format,
      v1.transaction,
      v1.bytes,
      v1.byteLimit,
      v1.addresses,
      v1.addressLimit,
      v1.instructions,
      v1.v1Unavailable,
    ],
    ['before-signing', 'v1', 'single', 4200, 4096, 65, 64, 2, undefined]
  );
  assert.match(v1.message, /4200 bytes \(limit 4096\) and 65 addresses \(limit 64\)/);
  assert.match(v1.message, /Nothing was signed or sent/);
  const v0 = new T.TransactionTooLargeError({
    stage: 'after-signing',
    format: 'v0',
    transaction: 'tx2',
    bytes: null,
    addresses: 70,
    instructions: 1,
    v1Unavailable: 'paymaster',
  });
  assert.deepEqual([v0.byteLimit, v0.addressLimit, v0.v1Unavailable], [1232, 64, 'paymaster']);
  assert.match(v0.message, /ExecuteDeferred transaction \(tx2\)/);
  assert.match(v0.message, /acceptsTxV1/);
  assert.match(v0.message, /nothing was sent and the approval was not used/);
  const signers = new T.TransactionTooLargeError({
    stage: 'before-signing',
    format: 'v1',
    transaction: 'single',
    bytes: 1000,
    addresses: 20,
    instructions: 1,
    overflow: 'signers',
  });
  assert.match(signers.message, /limit on signers/);
});

test('PayloadExceedsProgramLimitsError carries its counts', () => {
  const e = new T.PayloadExceedsProgramLimitsError({
    limit: 'heap',
    innerInstructions: 2,
    maxMetas: 70,
    totalMetas: 142,
    heapBytes: 34_358,
  });
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'PayloadExceedsProgramLimitsError');
  assert.deepEqual(
    [e.limit, e.innerInstructions, e.maxMetas, e.totalMetas, e.heapBytes],
    ['heap', 2, 70, 142, 34_358]
  );
  assert.match(
    e.message,
    /140 accounts in all, at most 70 in one\) needs 34358 bytes, and the program has 32760/
  );
  assert.match(e.message, /Nothing was signed or sent/);
  assert.equal(e.policy, undefined);

  const withPolicy = new T.PayloadExceedsProgramLimitsError({
    limit: 'heap',
    innerInstructions: 13,
    maxMetas: 32,
    totalMetas: 400,
    heapBytes: 32_968,
    policy: { actions: 16, vaultTokenAccounts: 49 },
  });
  assert.deepEqual(withPolicy.policy, { actions: 16, vaultTokenAccounts: 49 });
  assert.match(
    withPolicy.message,
    /at most 32 in one\) beside a policy of 16 actions and 49 vault token accounts needs 32968 bytes, and the program has 32760\./
  );
});
