// Builds test-vectors/txv1.json: golden inputs and outputs for the v1 writer,
// each checked against kit 8.4.0 and web3.js 1.99.0 as it is made.
//
// Most shapes come from v1 transactions that landed on devnet (kept in the
// file's `landed` list, as getTransaction returned them): their instructions,
// with the fee payer and any other signer replaced by test keys so the
// vectors can be signed, and a test blockhash. A few synthetic shapes cover
// what no landed transaction does (12 signers, merged roles, the smallest
// transaction), and two shapes one step over a limit cover `fits: false`.
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { getBase58Decoder } from '@solana/kit';
import { TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { KEY_PREFIX, testBlockhash, testKey } from './keys.mjs';
import { ORACLE_VERSIONS, crossCheck, encodeInput } from './oracle.mjs';

const SIGNER_LABELS = ['payer', 'authority'];

/** The landed transactions a vector is made from, in the order they appear. */
const FROM_LANDED = [
  {
    name: 'passkey-execute-1-transfer',
    landed: 'passkey-execute',
    about: 'Passkey Execute with a one-transfer payload, [Secp256r1, Execute], with the Phase 1 config: compute-unit and loaded-data limits, no priority fee.',
  },
  {
    name: 'passkey-execute-priority-fee',
    landed: 'passkey-execute-priority-fee',
    keepFee: true,
    about: 'The same shape with a priority fee, which sets both fee bits. The writer supports it for tests; the wallets never set one.',
  },
  {
    name: 'ed25519-execute-2-signers',
    landed: 'ed25519-execute',
    about: 'Ed25519-authority Execute: two signers, the fee payer and the readonly authority.',
  },
  {
    name: 'authorize-tx1',
    landed: 'authorize-tx1',
    about: 'Passkey Authorize, the first transaction of a deferred pair.',
  },
  {
    name: 'execute-deferred-tx2-1-transfer',
    landed: 'execute-deferred-tx2',
    about: 'ExecuteDeferred (the second transaction of a pair) with a one-transfer payload.',
  },
  {
    name: 'execute-deferred-tx2-58-addresses',
    landed: 'execute-deferred-tx2-bonk-wif',
    about: 'ExecuteDeferred carrying a BONK→WIF Jupiter route (replayed through Noop): 58 addresses.',
  },
  {
    name: 'execute-64-addresses',
    landed: 'execute-64-addresses',
    about: 'Passkey Execute at the address limit: 64 addresses, 52 of them in one inner instruction.',
  },
  {
    name: 'execute-4096-bytes',
    landed: 'execute-4096-bytes',
    keepFee: true,
    about: 'Passkey Execute at both limits: 64 addresses and exactly 4096 bytes (with the landed priority fee; 4088 without it).',
  },
];

function fromLanded(landed, { name, about, keepFee }) {
  const wire = Buffer.from(landed.wire, 'base64');
  const tx = VersionedTransaction.deserialize(wire);
  const { header, staticAccountKeys, transactionConfig } = tx.message;
  const labels = SIGNER_LABELS.slice(0, header.numRequiredSignatures);
  if (labels.length !== header.numRequiredSignatures) throw new Error(`${landed.name}: too many signers to relabel`);
  const swap = new Map(staticAccountKeys.slice(0, labels.length).map((k, i) => [k.toBase58(), testKey(labels[i]).publicKey]));
  const sub = (key) => swap.get(key.toBase58()) ?? key;
  const instructions = TransactionMessage.decompile(tx.message).instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: sub(ix.programId),
        keys: ix.keys.map((k) => ({ pubkey: sub(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data),
      }),
  );
  return {
    name,
    about,
    from: landed.name,
    input: {
      payer: testKey('payer').publicKey,
      blockhash: testBlockhash(name),
      instructions,
      config: {
        computeUnitLimit: transactionConfig.computeUnitLimit,
        loadedAccountsDataSizeLimit: transactionConfig.loadedAccountsDataSizeLimit,
        ...(keepFee && transactionConfig.priorityFee !== null
          ? { priorityFeeLamports: BigInt(transactionConfig.priorityFee) }
          : {}),
      },
    },
    sign: labels,
  };
}

const data = (label, length) => {
  const out = Buffer.alloc(length);
  for (let i = 0, block = 0; i < length; i += 32, block++) {
    createHash('sha256').update(`${KEY_PREFIX}data:${label}:${block}`).digest().copy(out, i);
  }
  return out;
};
const key = (label) => testKey(label).publicKey;
const meta = (label, isSigner, isWritable) => ({ pubkey: key(label), isSigner, isWritable });

function synthetic() {
  const payer = key('payer');
  return [
    {
      name: 'smallest',
      about: 'The smallest transaction: the fee payer and one instruction with no accounts and no data; both limits at their minimum, 1.',
      input: {
        payer,
        blockhash: testBlockhash('smallest'),
        instructions: [new TransactionInstruction({ programId: key('program-a'), keys: [], data: Buffer.alloc(0) })],
        config: { computeUnitLimit: 1, loadedAccountsDataSizeLimit: 1 },
      },
      sign: ['payer'],
    },
    {
      name: 'twelve-signers',
      about: 'The signer limit: the fee payer and 11 more signers, 6 writable and 5 readonly, all signing; both limits at their maximum.',
      input: {
        payer,
        blockhash: testBlockhash('twelve-signers'),
        instructions: [
          new TransactionInstruction({
            programId: key('program-a'),
            keys: [
              ...[1, 2, 3, 4, 5, 6].map((i) => meta(`signer-${i}`, true, true)),
              ...[7, 8, 9, 10, 11].map((i) => meta(`signer-${i}`, true, false)),
              meta('account-1', false, true),
              meta('account-2', false, false),
            ],
            data: data('twelve-signers', 40),
          }),
        ],
        config: { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 },
      },
      sign: ['payer', ...Array.from({ length: 11 }, (_, i) => `signer-${i + 1}`)],
    },
    {
      name: 'merged-roles',
      about:
        'Roles merged across instructions, as the wire format has one role per address: an account readonly in one instruction and writable in another, a signer readonly then writable, the fee payer passed as a readonly non-signer, a repeated account, and a program passed as a readonly account. A zero priority fee still sets both fee bits.',
      input: {
        payer,
        blockhash: testBlockhash('merged-roles'),
        instructions: [
          new TransactionInstruction({
            programId: key('program-a'),
            keys: [
              meta('account-1', false, true),
              meta('account-2', false, false),
              meta('signer-1', true, false),
              meta('account-1', false, false),
              meta('program-b', false, false),
            ],
            data: data('merged-roles-0', 7),
          }),
          new TransactionInstruction({
            programId: key('program-b'),
            keys: [
              meta('account-2', false, true),
              meta('signer-1', true, true),
              { pubkey: payer, isSigner: false, isWritable: false },
              meta('account-3', false, false),
            ],
            data: data('merged-roles-1', 64),
          }),
          new TransactionInstruction({ programId: key('program-a'), keys: [], data: data('merged-roles-2', 300) }),
        ],
        config: { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 196_608, priorityFeeLamports: 0n },
      },
      sign: ['payer', 'signer-1'],
    },
  ];
}

/** One step over a limit from a landed shape: `fits: false`, never signed. */
function overflows(byName) {
  const at64 = byName.get('execute-64-addresses');
  const at4096 = byName.get('execute-4096-bytes');
  const lastIx = (vector, change) => {
    const ixs = vector.input.instructions;
    const last = ixs[ixs.length - 1];
    return [...ixs.slice(0, -1), new TransactionInstruction({ programId: last.programId, ...change(last) })];
  };
  return [
    {
      name: 'over-65-addresses',
      about: 'execute-64-addresses with one more account in the LazorKit instruction.',
      input: {
        ...at64.input,
        blockhash: testBlockhash('over-65-addresses'),
        instructions: lastIx(at64, (ix) => ({ keys: [...ix.keys, meta('account-65', false, false)], data: ix.data })),
      },
      sign: [],
    },
    {
      name: 'over-4097-bytes',
      about: 'execute-4096-bytes with one more byte of instruction data.',
      input: {
        ...at4096.input,
        blockhash: testBlockhash('over-4097-bytes'),
        instructions: lastIx(at4096, (ix) => ({ keys: ix.keys, data: Buffer.concat([ix.data, Buffer.from([0])]) })),
      },
      sign: [],
    },
  ];
}

/**
 * The whole vector file. `landed` is the list of landed transactions, as
 * stored in the file. Throws if the writer disagrees with kit or web3.js on
 * any vector.
 */
export async function buildVectorFile(T, landed) {
  const landedByName = new Map(landed.map((l) => [l.name, l]));
  const fromChain = FROM_LANDED.map((spec) => {
    const entry = landedByName.get(spec.landed);
    if (!entry) throw new Error(`no landed transaction named ${spec.landed}`);
    return fromLanded(entry, spec);
  });
  const byName = new Map(fromChain.map((v) => [v.name, v]));
  const all = [...fromChain, ...synthetic(), ...overflows(byName)];

  const labels = new Set(['payer']);
  const vectors = [];
  for (const vector of all) {
    const signers = vector.sign.map((label) => testKey(label));
    vector.sign.forEach((label) => labels.add(label));
    const { ours, failures, signed } = await crossCheck(T, vector.input, signers, { legacyCompiler: true });
    if (failures.length) throw new Error(`${vector.name}: ${failures.join('; ')}`);
    const expected = {
      fits: ours.fits,
      ...(ours.overflow ? { overflow: ours.overflow } : {}),
      bytes: ours.bytes,
      addresses: ours.addresses,
      instructions: ours.instructions,
      signers: ours.signers,
    };
    if (ours.fits) {
      expected.messageLength = ours.messageLength;
      expected.unsigned = Buffer.from(ours.wire).toString('base64');
      expected.signatures = Array.from({ length: ours.signers }, (_, i) => {
        const at = ours.messageLength + 64 * i;
        const slot = signed.subarray(at, at + 64);
        return slot.some((b) => b !== 0) ? Buffer.from(slot).toString('base64') : null;
      });
    }
    vectors.push({
      name: vector.name,
      about: vector.about,
      ...(vector.from ? { from: vector.from } : {}),
      input: encodeInput(vector.input),
      sign: vector.sign,
      expected,
    });
  }
  for (const label of ['program-a', 'program-b']) labels.add(label);

  return {
    about: [
      'Golden vectors for the SIMD-0385 v1 writer, packages/react/core/wallet/txv1.ts (byte-identical: packages/react-native/src/core/wallet/txv1.ts).',
      'Generated by `node scripts/txv1-vectors.mjs`, which checks every vector against the oracle versions below; do not edit by hand.',
      '`expected.unsigned` is compileTransactionV1(input).wire: the message, then one zeroed 64-byte slot per signer. `expected.signatures[i]` is what signTransactionV1 with the keys in `sign` writes into slot i (null: left empty). Slot i belongs to address i; the fee payer is address 0.',
      '`landed` lists v1 transactions that landed on devnet, as getTransaction(signature, {encoding: "base64", maxSupportedTransactionVersion: 1}) returned them. A vector with `from` uses that transaction\'s instructions, with its signers replaced by test keys.',
    ],
    keyDerivation: `Key label L is the ed25519 keypair whose 32-byte seed is sha256("${KEY_PREFIX}" + L). Test keys only; they hold nothing.`,
    oracle: ORACLE_VERSIONS,
    keys: Object.fromEntries([...labels].sort().map((label) => [label, testKey(label).publicKey.toBase58()])),
    landed,
    vectors,
  };
}

/** Pretty JSON, with each account meta on one line. */
export function serialize(file) {
  return `${JSON.stringify(file, null, 2)}\n`.replace(
    /\{\n\s+"pubkey": ("\w+"),\n\s+"isSigner": (true|false),\n\s+"isWritable": (true|false)\n\s+\}/g,
    '{ "pubkey": $1, "isSigner": $2, "isWritable": $3 }',
  );
}

/** Confirms a landed transaction is what it says: v1, its id, and every signature over its message. */
export function verifyLanded(entry) {
  const wire = Buffer.from(entry.wire, 'base64');
  const tx = VersionedTransaction.deserialize(wire);
  const message = wire.subarray(0, wire.length - 64 * tx.message.header.numRequiredSignatures);
  const problems = [];
  if (tx.version !== 1 || wire[0] !== 0x81) problems.push('not a v1 transaction');
  if (getBase58Decoder().decode(tx.signatures[0]) !== entry.signature) problems.push('its id is not its first signature');
  tx.signatures.forEach((signature, i) => {
    if (!ed25519.verify(signature, message, tx.message.staticAccountKeys[i].toBytes())) {
      problems.push(`signature ${i} does not verify`);
    }
  });
  return problems;
}
