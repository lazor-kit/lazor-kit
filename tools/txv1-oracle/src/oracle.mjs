// The checks that hold the writer to @solana/kit 8.4.0 and @solana/web3.js
// 1.99.0. Each returns a list of failures (empty when everything agrees), so
// a test can report every disagreement of a case at once.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as kit from '@solana/kit';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';

const modules = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const versionOf = (name) => JSON.parse(readFileSync(join(modules, name, 'package.json'), 'utf8')).version;
/** The versions this oracle runs: exactly kit 8.4.0 and web3.js 1.99.0, or its claims mean nothing. */
export const ORACLE_VERSIONS = {
  '@solana/kit': versionOf('@solana/kit'),
  '@solana/web3.js': versionOf('@solana/web3.js'),
};
export const EXPECTED_ORACLE_VERSIONS = { '@solana/kit': '8.4.0', '@solana/web3.js': '1.99.0' };

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const text = (value) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? hex(v) : v));
const equalBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** The JSON form of an input, as test-vectors/txv1.json stores it. */
export function encodeInput({ payer, blockhash, instructions, config }) {
  return {
    payer: payer.toBase58(),
    blockhash,
    config: {
      computeUnitLimit: config.computeUnitLimit,
      loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit,
      ...(config.priorityFeeLamports !== undefined ? { priorityFeeLamports: config.priorityFeeLamports.toString() } : {}),
    },
    instructions: instructions.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data).toString('base64'),
    })),
  };
}

// ─── Semantics ──────────────────────────────────────────────────────────────

const role = (signer, writable) =>
  signer
    ? writable
      ? kit.AccountRole.WRITABLE_SIGNER
      : kit.AccountRole.READONLY_SIGNER
    : writable
      ? kit.AccountRole.WRITABLE
      : kit.AccountRole.READONLY;

/**
 * What an input means on chain: fee payer, lifetime, config, and each
 * instruction's program, accounts with their roles, and data. An account's
 * role is the one the whole transaction gives it (the wire format has one per
 * address): writable or signer anywhere makes it so everywhere, and the fee
 * payer is a writable signer.
 */
export function inputSemantics({ payer, blockhash, instructions, config }) {
  const merged = new Map([[payer.toBase58(), { signer: true, writable: true }]]);
  for (const ix of instructions) {
    for (const k of ix.keys) {
      const m = merged.get(k.pubkey.toBase58()) ?? { signer: false, writable: false };
      merged.set(k.pubkey.toBase58(), { signer: m.signer || k.isSigner, writable: m.writable || k.isWritable });
    }
  }
  return text({
    payer: payer.toBase58(),
    lifetime: blockhash,
    config: normalConfig(config),
    instructions: instructions.map((ix) => [
      ix.programId.toBase58(),
      ix.keys.map((k) => {
        const m = merged.get(k.pubkey.toBase58());
        return [k.pubkey.toBase58(), role(m.signer, m.writable)];
      }),
      hex(ix.data),
    ]),
  });
}

/** The same view of v1 message bytes, through kit's decoder and decompiler. */
export function kitSemantics(messageBytes) {
  const message = kit.decompileTransactionMessage(kit.getCompiledTransactionMessageDecoder().decode(messageBytes));
  return text({
    payer: message.feePayer.address,
    lifetime: message.lifetimeConstraint.blockhash,
    config: normalConfig(message.config ?? {}),
    instructions: message.instructions.map((ix) => [
      ix.programAddress,
      (ix.accounts ?? []).map((a) => [a.address, a.role]),
      hex(ix.data ?? new Uint8Array()),
    ]),
  });
}

function normalConfig(config) {
  return {
    computeUnitLimit: config.computeUnitLimit,
    loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit,
    priorityFeeLamports: config.priorityFeeLamports ?? null,
    heapSize: config.heapSize ?? null,
  };
}

// ─── kit's own compile ──────────────────────────────────────────────────────

const KIT_OVERFLOWS = [
  [kit.SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES, 'addresses'],
  [kit.SOLANA_ERROR__TRANSACTION__TOO_MANY_SIGNER_ADDRESSES, 'signers'],
  [kit.SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS, 'instructions'],
  [kit.SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNTS_IN_INSTRUCTION, 'accounts-per-ix'],
];

/**
 * kit 8.4.0 compiling the same input: `{ transaction, bytes, fits }`, or
 * `{ overflow }` when kit refuses to compile it for a SIMD-0385 limit.
 */
export function kitCompile({ payer, blockhash, instructions, config }) {
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 1 }),
    (m) => kit.setTransactionMessageFeePayer(kit.address(payer.toBase58()), m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash({ blockhash: kit.blockhash(blockhash), lastValidBlockHeight: 0n }, m),
    (m) =>
      kit.appendTransactionMessageInstructions(
        instructions.map((ix) => ({
          programAddress: kit.address(ix.programId.toBase58()),
          accounts: ix.keys.map((k) => ({ address: kit.address(k.pubkey.toBase58()), role: role(k.isSigner, k.isWritable) })),
          data: new Uint8Array(ix.data),
        })),
        m,
      ),
    (m) => kit.setTransactionMessageConfig(config, m),
  );
  let transaction;
  try {
    transaction = kit.compileTransaction(message);
  } catch (error) {
    const known = KIT_OVERFLOWS.find(([code]) => kit.isSolanaError(error, code));
    if (known) return { overflow: known[1] };
    throw error;
  }
  const bytes = kit.getTransactionSize(transaction);
  return { transaction, bytes, fits: bytes <= kit.getTransactionSizeLimit(transaction) };
}

// ─── The cross-check ────────────────────────────────────────────────────────

const kitKeyPairs = new Map();
/** kit's CryptoKeyPair for a web3.js keypair, imported once. */
function kitKeyPair(signer) {
  const address = signer.publicKey.toBase58();
  if (!kitKeyPairs.has(address)) kitKeyPairs.set(address, kit.createKeyPairFromPrivateKeyBytes(signer.secretKey.slice(0, 32)));
  return kitKeyPairs.get(address);
}

/**
 * Everything the writer's output must agree on with kit and web3.js, for one
 * input. `signers` are the keypairs to sign with (any subset of the required
 * signers); the rest of the slots must stay empty. `legacyCompiler` also
 * checks that web3.js's legacy compiler gives the same header, keys and
 * indexes as the v0 compiler the writer uses (slow for kilobytes of data: it
 * base58-encodes every instruction's data).
 */
export async function crossCheck(T, input, signers = [], { legacyCompiler = false } = {}) {
  const failures = [];
  const fail = (what, detail) => failures.push(detail === undefined ? what : `${what}: ${detail}`);
  const ours = T.compileTransactionV1(input);
  const theirs = kitCompile(input);

  // Size and limits agree with kit.
  if (theirs.overflow) {
    if (ours.fits || ours.overflow !== theirs.overflow) fail('overflow', `ours ${ours.overflow ?? 'fits'}, kit ${theirs.overflow}`);
    return { ours, failures };
  }
  if (ours.bytes !== theirs.bytes) fail('size', `ours ${ours.bytes}, kit ${theirs.bytes}`);
  if (ours.fits !== theirs.fits) fail('fits', `ours ${ours.fits} (${ours.overflow}), kit ${theirs.fits}`);
  if (kitSemantics(theirs.transaction.messageBytes) !== inputSemantics(input)) fail('kit compile semantics');
  if (!ours.fits) {
    if (ours.overflow !== 'bytes' && ours.overflow !== 'data-per-ix') fail('overflow kind', ours.overflow);
    return { ours, failures };
  }

  const message = ours.wire.subarray(0, ours.messageLength);
  if (ours.messageLength !== theirs.transaction.messageBytes.length) fail('message length');

  // kit decodes exactly the components web3.js compiled.
  const decoded = kit.getTransactionDecoder().decode(ours.wire);
  if (!equalBytes(decoded.messageBytes, message)) fail('kit transaction decode: message bytes');
  if (Object.values(decoded.signatures).some((s) => s !== null)) fail('unsigned wire has a signature');
  const compiled = kit.getCompiledTransactionMessageDecoder().decode(message);
  const web3 = new TransactionMessage({
    payerKey: input.payer,
    recentBlockhash: input.blockhash,
    instructions: [...input.instructions],
  }).compileToV0Message();
  const components = (header, keys, ixs) =>
    text({
      header: [header.numRequiredSignatures, header.numReadonlySignedAccounts, header.numReadonlyUnsignedAccounts],
      keys: keys.map((k) => k.toBase58()),
      ixs: ixs.map((ix) => [ix.programIdIndex, [...ix.accountKeyIndexes], hex(ix.data)]),
    });
  const web3Components = components(web3.header, web3.staticAccountKeys, web3.compiledInstructions);
  if (legacyCompiler) {
    const legacy = new TransactionMessage({
      payerKey: input.payer,
      recentBlockhash: input.blockhash,
      instructions: [...input.instructions],
    }).compileToLegacyMessage();
    if (components(legacy.header, legacy.accountKeys, legacy.compiledInstructions) !== web3Components) {
      fail('web3.js legacy and v0 compilers disagree');
    }
  }
  const kitComponents = text({
    header: [
      compiled.header.numSignerAccounts,
      compiled.header.numReadonlySignerAccounts,
      compiled.header.numReadonlyNonSignerAccounts,
    ],
    keys: compiled.staticAccounts,
    ixs: compiled.instructionHeaders.map((h, i) => [
      h.programAccountIndex,
      [...compiled.instructionPayloads[i].instructionAccountIndices],
      hex(compiled.instructionPayloads[i].instructionData),
    ]),
  });
  if (kitComponents !== web3Components) fail('kit-decoded components differ from web3.js compile');
  if (compiled.lifetimeToken !== input.blockhash) fail('lifetime');
  const expectedMask = (input.config.priorityFeeLamports !== undefined ? 0b11 : 0) | 0b1100;
  if (compiled.configMask !== expectedMask) fail('config mask', compiled.configMask);

  // kit re-encodes the decoded message to the same bytes.
  if (!equalBytes(kit.getCompiledTransactionMessageEncoder().encode(compiled), message)) fail('kit re-encode');

  // The decompiled meaning is the input's.
  if (kitSemantics(message) !== inputSemantics(input)) fail('decompiled semantics');

  // web3.js 1.99 reads it back. Its u64 reader stops at 2^53 - 1.
  const fee = input.config.priorityFeeLamports;
  if (fee === undefined || fee <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const read = VersionedTransaction.deserialize(ours.wire);
    const m = read.message;
    if (read.version !== 1) fail('web3 version', read.version);
    if (components(m.header, m.staticAccountKeys, m.compiledInstructions) !== web3Components) fail('web3 read-back components');
    if (m.recentBlockhash !== input.blockhash) fail('web3 read-back blockhash');
    const config = m.transactionConfig;
    if (
      config.computeUnitLimit !== input.config.computeUnitLimit ||
      config.loadedAccountsDataSizeLimit !== input.config.loadedAccountsDataSizeLimit ||
      config.priorityFee !== (fee === undefined ? null : Number(fee)) ||
      config.heapSize !== null
    ) {
      fail('web3 read-back config', text(config));
    }
    if (read.signatures.length !== ours.signers || read.signatures.some((s) => s.some((b) => b !== 0))) {
      fail('web3 read-back signatures');
    }
  }

  // Signatures: in the right slots, verified, and equal to kit's own signer.
  const signed = T.signTransactionV1(ours, signers);
  const signedDecoded = kit.getTransactionDecoder().decode(signed);
  const signerAddresses = new Set(signers.map((s) => s.publicKey.toBase58()));
  for (const [address, signature] of Object.entries(signedDecoded.signatures)) {
    if (signerAddresses.has(address)) {
      if (!signature || !ed25519.verify(signature, message, new PublicKey(address).toBytes())) {
        fail('signature does not verify', address);
      }
    } else if (signature !== null) {
      fail('slot of an absent signer is not empty', address);
    }
  }
  const kitKeys = await Promise.all(signers.map(kitKeyPair));
  const kitSigned = kit.getTransactionEncoder().encode(await kit.partiallySignTransaction(kitKeys, decoded));
  if (!equalBytes(kitSigned, signed)) fail("signed bytes differ from kit's partiallySignTransaction");
  const sameBytesAsKit = equalBytes(theirs.transaction.messageBytes, message);
  return { ours, failures, signed, sameBytesAsKit };
}
