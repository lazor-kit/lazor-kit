// U11: 10,000 seeded random messages through the v1 writer, each held to
// @solana/kit 8.4.0 and @solana/web3.js 1.99.0 by crossCheck (src/oracle.mjs):
// - `fits`, the first limit broken, and the size agree with kit's compile
//   limits and size (one case in twenty is moved onto 4095, 4096 or 4097
//   bytes);
// - kit's decoders give exactly the components web3.js compiled, and kit
//   re-encodes them to the same bytes;
// - the decompiled meaning (fee payer, lifetime, config, each instruction's
//   program, accounts, roles and data) is the input's;
// - web3.js reads back version 1 with the same keys, instructions and config;
// - the signatures verify, sit in their signers' slots, leave the other slots
//   empty, and equal kit's own partiallySignTransaction.
//
// Reproduce a run with TXV1_SEED=<seed> (and TXV1_CASES=<n>); the seed is
// printed. Every failing case is reported with its index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { loadWriter } from '../src/writer.mjs';
import { seededRandom, testKey } from '../src/keys.mjs';
import { crossCheck } from '../src/oracle.mjs';

const SEED = Number(process.env.TXV1_SEED ?? 0x5eed_7c01) >>> 0;
const CASES = Number(process.env.TXV1_CASES ?? 10_000);
const T = await loadWriter();

// 72 accounts and 8 programs, so a case can go over 64 addresses.
const accounts = Array.from({ length: 72 }, (_, i) => testKey(`differential-account-${i}`));
const programs = Array.from({ length: 8 }, (_, i) => testKey(`differential-program-${i}`).publicKey);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** One random message. Most fit; about one in eight goes over a limit. */
function randomCase(r) {
  const over = r.chance(0.125) ? r.pick(['addresses', 'signers', 'instructions', 'accounts-per-ix', 'bytes']) : null;
  const shuffled = [...accounts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const payer = shuffled[0];
  const signerCount = over === 'signers' ? 13 : r.range(1, 12);
  const signers = shuffled.slice(0, signerCount);
  const programCount = r.range(1, programs.length);
  const usable = programs.slice(0, programCount);
  // Within 64 addresses unless the case is meant to go over.
  const universeSize = over === 'addresses' ? 64 : r.range(0, Math.max(0, 64 - signerCount - programCount));
  const universe = shuffled.slice(signerCount, signerCount + universeSize);

  const instructionCount =
    over === 'instructions' ? 65 : signerCount > 1 ? r.range(1, 20) : r.range(0, 20);
  const dataBudget =
    over === 'bytes' ? r.range(4_100, 4_400) : r.chance(0.25) ? r.range(0, 3_584) : r.range(0, 1_200);
  const instructions = [];
  for (let i = 0; i < instructionCount; i++) {
    const keys = [];
    const metaCount = over === 'accounts-per-ix' && i === 0 ? 256 : r.range(0, over === 'instructions' ? 2 : 12);
    for (let m = 0; m < metaCount; m++) {
      const pick = r.int(100);
      if (pick < 6) {
        // A program as an account: kit refuses an invoked program that is writable.
        keys.push({ pubkey: r.pick(usable), isSigner: false, isWritable: false });
      } else if (pick < 12) {
        keys.push({ pubkey: payer.publicKey, isSigner: r.chance(0.5), isWritable: r.chance(0.5) });
      } else if (universe.length && pick < 80) {
        keys.push({ pubkey: r.pick(universe).publicKey, isSigner: false, isWritable: r.chance(0.5) });
      } else {
        keys.push({ pubkey: r.pick(signers).publicKey, isSigner: r.chance(0.7), isWritable: r.chance(0.5) });
      }
    }
    instructions.push({ programId: r.pick(usable), keys, data: 0 });
  }
  // Sometimes one wide instruction touches every account in the universe.
  if (instructions.length && universe.length && (over === 'addresses' || r.chance(0.25))) {
    r.pick(instructions).keys.push(
      ...universe.map((a) => ({ pubkey: a.publicKey, isSigner: false, isWritable: r.chance(0.5) })),
    );
  }
  // Every signer signs somewhere, so the case has exactly `signerCount` signers.
  for (const signer of signers.slice(1)) {
    r.pick(instructions).keys.push({ pubkey: signer.publicKey, isSigner: true, isWritable: r.chance(0.5) });
  }
  // Spread the data over the instructions.
  let left = instructionCount ? dataBudget : 0;
  for (let i = 0; i < instructionCount && left > 0; i++) {
    const take = i === instructionCount - 1 ? left : r.int(left + 1);
    instructions[i].data = take;
    left -= take;
  }

  const fee = r.int(100);
  return {
    over,
    signers,
    input: {
      payer: payer.publicKey,
      blockhash: new PublicKey(r.bytes(32)).toBase58(),
      instructions: instructions.map(
        (ix) => new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: Buffer.from(r.bytes(ix.data)) }),
      ),
      config: {
        computeUnitLimit: r.range(1, 1_400_000),
        loadedAccountsDataSizeLimit: r.range(1, 64 * 1024 * 1024),
        ...(fee < 50
          ? {}
          : fee < 65
            ? { priorityFeeLamports: 0n }
            : fee < 95
              ? { priorityFeeLamports: r.u64() % MAX_SAFE }
              : { priorityFeeLamports: r.u64() }),
      },
    },
  };
}

test(`U11: ${CASES} seeded random messages agree with kit 8.4.0 and web3.js 1.99.0`, { timeout: 30 * 60_000 }, async () => {
  console.log(`# seed ${SEED} (0x${SEED.toString(16)}), ${CASES} cases; reproduce with TXV1_SEED=${SEED}`);
  const r = seededRandom(SEED);
  const tally = { cases: 0, agree: 0, fits: 0, sameBytesAsKit: 0, signed: 0, atByteLimit: [0, 0, 0], overflow: {} };
  const failures = [];
  for (let i = 0; i < CASES; i++) {
    const { input, signers, over } = randomCase(r);
    // One case in twenty is moved onto the byte limit: 4095, 4096 or 4097 bytes.
    if (!over && input.instructions.length && r.chance(0.05)) {
      const target = 4096 + r.range(-1, 1);
      const last = input.instructions[input.instructions.length - 1];
      const length = last.data.length + target - T.compileTransactionV1(input).bytes;
      if (length >= 0 && length <= 0xffff) {
        input.instructions[input.instructions.length - 1] = new TransactionInstruction({
          programId: last.programId,
          keys: last.keys,
          data: Buffer.from(r.bytes(length)),
        });
        tally.atByteLimit[target - 4095]++;
      }
    }
    // Sign with a random subset of the signers, so some slots stay empty.
    const signWith = signers.filter(() => r.chance(0.6));
    const result = await crossCheck(T, input, fitsV1(input) ? signWith : [], {
      legacyCompiler: i % 100 === 0,
    });
    tally.cases++;
    if (result.failures.length) {
      failures.push(`case ${i}: ${result.failures.join('; ')}`);
      continue;
    }
    tally.agree++;
    if (result.ours.fits) {
      tally.fits++;
      if (result.sameBytesAsKit) tally.sameBytesAsKit++;
      if (signWith.length) tally.signed++;
    } else {
      tally.overflow[result.ours.overflow] = (tally.overflow[result.ours.overflow] ?? 0) + 1;
    }
  }
  console.log(`# ${JSON.stringify(tally)}`);
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} of ${CASES} cases disagree (seed ${SEED})`);
  assert.equal(tally.agree, CASES);
  // The run must exercise both sides of every limit, or it proves less than it says.
  assert.ok(tally.fits > CASES * 0.75, 'most cases fit');
  for (const kind of ['addresses', 'signers', 'instructions', 'accounts-per-ix', 'bytes']) {
    assert.ok(tally.overflow[kind] > 0, `some case goes over ${kind}`);
  }
  assert.ok(tally.atByteLimit.every((n) => n > 0), 'some cases are 4095, 4096 and 4097 bytes');
});

/** Only a transaction that fits can be signed. */
function fitsV1(input) {
  return T.compileTransactionV1(input).fits;
}
