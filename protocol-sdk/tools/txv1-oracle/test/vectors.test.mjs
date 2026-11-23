// U1 at generation, and the landed transactions: the committed vectors are
// exactly what the generator makes, which re-checks every vector against
// kit 8.4.0 and web3.js 1.99.0; and the writer re-encodes each v1
// transaction that landed on devnet with the same size and meaning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { VECTORS_PATH, loadWriter } from '../src/writer.mjs';
import { buildVectorFile, serialize, verifyLanded } from '../src/vectors.mjs';
import { EXPECTED_ORACLE_VERSIONS, ORACLE_VERSIONS, kitSemantics } from '../src/oracle.mjs';

const T = await loadWriter();
const committed = readFileSync(VECTORS_PATH, 'utf8');
const file = JSON.parse(committed);

test('the oracle runs exactly @solana/kit 8.4.0 and @solana/web3.js 1.99.0', () => {
  assert.deepEqual(ORACLE_VERSIONS, EXPECTED_ORACLE_VERSIONS);
});

test('test-vectors/txv1.json is exactly what scripts/txv1-vectors.mjs generates (every vector checked against kit and web3.js)', async () => {
  const generated = serialize(await buildVectorFile(T, file.landed));
  assert.ok(generated === committed, 'the vectors are stale: run `node scripts/txv1-vectors.mjs` and commit the result');
});

test('every landed transaction is authentic: v1, its id, and every signature', () => {
  assert.equal(file.landed.length, 8);
  for (const entry of file.landed) assert.deepEqual(verifyLanded(entry), [], entry.name);
});

test('the writer re-encodes each landed transaction: same size, addresses and meaning (kit decoder)', () => {
  let byteIdentical = 0;
  for (const entry of file.landed) {
    const wire = Buffer.from(entry.wire, 'base64');
    const tx = VersionedTransaction.deserialize(wire);
    const { payerKey, recentBlockhash, instructions } = TransactionMessage.decompile(tx.message);
    const c = tx.message.transactionConfig;
    const ours = T.compileTransactionV1({
      payer: payerKey,
      blockhash: recentBlockhash,
      instructions,
      config: {
        computeUnitLimit: c.computeUnitLimit,
        loadedAccountsDataSizeLimit: c.loadedAccountsDataSizeLimit,
        ...(c.priorityFee !== null ? { priorityFeeLamports: BigInt(c.priorityFee) } : {}),
      },
    });
    const landedMessage = wire.subarray(0, wire.length - 64 * tx.message.header.numRequiredSignatures);
    assert.equal(ours.fits, true, entry.name);
    assert.equal(ours.bytes, wire.length, `${entry.name}: size`);
    assert.equal(ours.addresses, tx.message.staticAccountKeys.length, `${entry.name}: addresses`);
    assert.equal(ours.signers, tx.message.header.numRequiredSignatures, `${entry.name}: signers`);
    const message = ours.wire.subarray(0, ours.messageLength);
    assert.equal(kitSemantics(message), kitSemantics(landedMessage), `${entry.name}: meaning`);
    if (Buffer.compare(Buffer.from(message), landedMessage) === 0) byteIdentical++;
  }
  // The landed ones were built by kit, which sorts accounts within a header
  // class; web3.js keeps first appearance. Same meaning, other byte order.
  console.log(`# landed: ${file.landed.length}/${file.landed.length} same size and meaning, ${byteIdentical} byte-identical`);
});

test('a vector made from a landed transaction keeps its shape', () => {
  const landed = new Map(file.landed.map((l) => [l.name, Buffer.from(l.wire, 'base64')]));
  for (const vector of file.vectors.filter((v) => v.from)) {
    const wire = landed.get(vector.from);
    const fee = VersionedTransaction.deserialize(wire).message.transactionConfig.priorityFee;
    const dropped = fee !== null && vector.input.config.priorityFeeLamports === undefined ? 8 : 0;
    assert.equal(vector.expected.bytes, wire.length - dropped, vector.name);
  }
});
