// txVersion 'v1' through the built package (`pnpm build` first), against the
// mock cluster (test/support/cluster.mjs) with a scripted portal, no network:
//
//   U5  which format a 'v1' request goes out in, and what refuses it before
//       the prompt (or before a local key signs): every gate reason, fits and
//       does not fit, before and after signing, the deferred pair, and that a
//       refusal opens no portal and sends nothing;
//   U7  the compute-unit and loaded-accounts-data limits: the simulation's
//       request, the formula, the ceilings on any simulation problem, the
//       caller's values, the 3 s bound;
//   U8  Paymaster.signAndSendRaw: the retry and error table of
//       signAndSendVersionedTransaction on the same bytes (3037 / 3038 not
//       retried included), -32051 not retried, the page's memo of a
//       paymaster that refused v1, and a 'v1' session or authority send's
//       3037 / 3038 reported as a 'v0' one's;
//   U10 the logs of a landed v1 transaction, read with a raw getTransaction
//       (maxSupportedTransactionVersion 1) on a recorded devnet response, to
//       tell LazorKit's 3006 from an inner program's.
//
// The flag-off path (no 'v1') is test/flagoff.test.mjs (U4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_HEIGHT0, COUNTER0, NOOP_PROGRAM, h } from './support/corpus.mjs';
import { setHandlers } from './support/env.mjs';
import { compact, runCase } from './support/flagoff.mjs';
import { loadWallet, portal, router, sdk, setup, web3 } from './support/wallet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist', 'index.mjs');
const golden = JSON.parse(readFileSync(join(HERE, 'fixtures', 'flagoff.web.json'), 'utf8'));
const recorded = JSON.parse(readFileSync(join(HERE, 'fixtures', 'devnet-v1-transaction.json'), 'utf8'));

// The package logs retries, errors and its v1 fallbacks; keep them for the asserts.
const logged = { warn: [], other: [] };
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => (level === 'warn' ? logged.warn : logged.other).push(args.map(String).join(' '));
}

const W = await loadWallet(DIST);
const { VersionedTransaction, TransactionMessage, SystemProgram, Keypair } = web3;

const LAZORKIT = sdk.PROGRAM_ID_DEVNET.toBase58();
const SECP256R1 = 'Secp256r1SigVerify1111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const CEILINGS = { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 67_108_864 };
const V1 = { txVersion: 'v1' };
const ACCEPTS = { acceptsTxV1: true };

// ── helpers ─────────────────────────────────────────────────────────────

/** A send of corpus payload `name` (or a payload object) with `options`, and the payload's lookup tables. */
function request(c, name, options = {}) {
  const payload = typeof name === 'string' ? c.corpus.payloads[name] : name;
  return {
    instructions: payload.instructions(),
    transactionOptions: {
      ...options,
      ...(payload.lookupTables.length ? { addressLookupTableAccounts: payload.lookupTables } : {}),
    },
  };
}
/** The paymaster's signAndSendTransaction requests. */
const sendRequests = (c) => c.chain.rec.paymaster.filter((p) => p.method === 'signAndSendTransaction');
const wire = (p) => Buffer.from(JSON.parse(p.body).params.transaction, 'base64');
/** What landed, decoded. */
const landed = (c) => c.chain.rec.sends.filter((s) => s.sent);
const simulations = (c) => c.chain.rec.rpc.filter((r) => r.method === 'simulateTransaction');
const counter = (c) => c.chain.ledger.accounts.get(c.corpus.authorityPda.toBase58()).data.readUInt32LE(8);
const config = (tx) => ({
  computeUnitLimit: tx.transactionConfig.computeUnitLimit,
  loadedAccountsDataSizeLimit: tx.transactionConfig.loadedAccountsDataSizeLimit,
});

async function rejects(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
}

/** A test with a fresh ledger and store; the next one starts past this one's slots. */
async function withCase(options, fn) {
  const c = setup(W, options);
  try {
    await fn(c);
  } finally {
    c.done();
  }
}

/** Nothing reached the paymaster or the portal, and the store is idle with the error. */
function assertRefusedBeforeAnything(c, error) {
  assert.equal(portal.opens.length, 0, 'no portal opened');
  assert.equal(sendRequests(c).length, 0, 'nothing sent');
  assert.equal(landed(c).length, 0);
  assert.equal(c.S().isSigning, false);
  assert.equal(c.S().error, error);
}

/** The v1 transaction's shape: version, limits set, no ComputeBudget, every present signature valid. */
function assertV1(tx, programs) {
  assert.equal(tx.version, 1);
  assert.equal(tx.transactionConfig.priorityFee, null);
  assert.equal(tx.transactionConfig.heapSize, null);
  assert.ok(tx.transactionConfig.computeUnitLimit > 0 && tx.transactionConfig.loadedAccountsDataSizeLimit >= 196_608);
  assert.deepEqual(tx.instructions.map((ix) => ix.program), programs);
  assert.ok(!tx.instructions.some((ix) => ix.program === COMPUTE_BUDGET));
  for (const ix of tx.instructions) if (ix.program === SECP256R1) assert.equal(ix.precompileSignaturesValid, true);
  // As the wallet sent it: the fee payer's slot (first) empty, every local signer's signature valid.
  const [feePayer, ...local] = tx.signatures;
  assert.equal(feePayer.present, false);
  assert.ok(local.every((s) => s.present && s.valid), 'every local signer signed');
  assert.ok(tx.bytes <= 4096);
}

/**
 * The portal's preview: a v0 transaction with no lookup into a table, so that
 * every program and account of the caller's instructions is in its message.
 */
function assertPreviewShowsEveryAccount(previewBytes, instructions) {
  const preview = VersionedTransaction.deserialize(previewBytes);
  assert.equal(preview.version, 0);
  assert.deepEqual(preview.message.addressTableLookups, [], 'no account hidden in a lookup table');
  const shown = new Set(preview.message.staticAccountKeys.map((k) => k.toBase58()));
  for (const ix of instructions) {
    for (const address of [ix.programId, ...ix.keys.map((k) => k.pubkey)]) {
      assert.ok(shown.has(address.toBase58()), `${address.toBase58()} is in the preview`);
    }
  }
}

// ── U5: path selection ──────────────────────────────────────────────────

test('U5: with a paymaster that accepts v1, a passkey Execute goes out as v1 with both limits set, and lands', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const signature = await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    assert.equal(sendRequests(c).length, 1);
    const [sent] = sendRequests(c);
    assert.equal(wire(sent)[0], 0x81, 'v1 on the wire');
    assert.equal(JSON.parse(sent.body).params.signer_key, c.corpus.feePayer.publicKey.toBase58());
    const [tx] = landed(c);
    assert.equal(tx.signature, signature);
    assertV1(tx, [SECP256R1, LAZORKIT]);
    // 13,011 CU and 161,320 bytes simulated: ⌈13,011 × 1.2⌉ + 5,000, and the 196,608 floor.
    assert.deepEqual(config(tx), { computeUnitLimit: 20_614, loadedAccountsDataSizeLimit: 196_608 });
    assert.equal(counter(c), COUNTER0 + 1);
    // The portal still previews a v0 transaction of the caller's instructions.
    assert.equal(portal.opens.length, 1);
    assert.equal(VersionedTransaction.deserialize(Buffer.from(portal.opens[0].params.transaction, 'base64')).version, 0);
    assert.equal(c.S().error, null);
  });
});

test('U5: a 2.2 KB payload that no v0 form can carry goes out as v1; the caller\'s lookup tables are not used', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const sent = request(c, 'payload2k2', V1);
    await c.S().signAndSendTransaction(sent);
    const [tx] = landed(c);
    assertV1(tx, [SECP256R1, LAZORKIT]);
    assert.ok(tx.bytes > 1232, `${tx.bytes} bytes`);
    assert.equal(tx.lookups, undefined);
    // Nor by the preview: it is over 1232 bytes, and lists every account.
    const preview = Buffer.from(portal.opens[0].params.transaction, 'base64');
    assert.ok(preview.length > 1232, `${preview.length} bytes`);
    assertPreviewShowsEveryAccount(preview, sent.instructions);
  });
  // The same payload as v0 fails, as 3.4.1 (and 3.2.1) fails it.
  assert.equal(golden.cases['web/execute/payload2k2/v0'].steps[0].ok, false);
});

test("U5: when v1 is used, the passkey approves a preview of every account: the caller's lookup tables, which v1 does not use, are left out", async () => {
  // lut40's preview is over 1232 bytes without its lookup tables. Compiled
  // with them, it would show table indexes that the portal resolves on chain,
  // while the v1 transaction carries the caller's own addresses.
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const sent = request(c, 'lut40', V1);
    await c.S().signAndSendTransaction(sent);
    assert.equal(landed(c)[0].version, 1);
    const preview = Buffer.from(portal.opens[0].params.transaction, 'base64');
    assert.ok(preview.length > 1232, `${preview.length} bytes`);
    assertPreviewShowsEveryAccount(preview, sent.instructions);
  });
  // The caller's tables need not hold what the chain holds at their addresses, and the portal
  // resolves a preview's lookups on chain: with forged tables, a preview compiled with them would
  // pay an account the chain's table lists, while the v1 transaction pays the caller's own. The
  // preview names the accounts the passkey signs, the transfer's recipient included.
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const forged = (table, label) =>
      new web3.AddressLookupTableAccount({
        key: table.key,
        state: { ...table.state, addresses: Array.from({ length: 32 }, (_, i) => new web3.PublicKey(h(`forged/${label}/${i}`))) },
      });
    const [fA, fB] = Object.values(c.corpus.lookupTables).map((table, i) => forged(table, i));
    const recipient = fA.state.addresses[0];
    const metas = [...fA.state.addresses.slice(1, 25), ...fB.state.addresses.slice(0, 16)];
    const instructions = [
      SystemProgram.transfer({ fromPubkey: c.corpus.vaultPda, toPubkey: recipient, lamports: 1_000_000 }),
      new web3.TransactionInstruction({
        programId: new web3.PublicKey(NOOP_PROGRAM),
        keys: metas.map((pubkey, i) => ({ pubkey, isSigner: false, isWritable: i < 4 })),
        data: Buffer.alloc(8, 1),
      }),
    ];
    await c.S().signAndSendTransaction({ instructions, transactionOptions: { ...V1, addressLookupTableAccounts: [fA, fB] } });
    assert.equal(landed(c)[0].version, 1);
    const previewBytes = Buffer.from(portal.opens[0].params.transaction, 'base64');
    assertPreviewShowsEveryAccount(previewBytes, instructions);
    const { message } = VersionedTransaction.deserialize(previewBytes);
    const [transfer] = message.compiledInstructions;
    assert.equal(message.staticAccountKeys[transfer.accountKeyIndexes[1]].toBase58(), recipient.toBase58(), 'the preview pays whom the v1 transaction pays');
  });
  // A request that goes out as v0 is sent with the tables, and previewed with them, as a 'v0' request is.
  await withCase({}, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'lut40', V1));
    const [tx] = landed(c);
    assert.equal(tx.version, 0);
    assert.equal(tx.lookups.length, 2);
    const preview = VersionedTransaction.deserialize(Buffer.from(portal.opens[0].params.transaction, 'base64'));
    assert.equal(preview.message.addressTableLookups.length, 2);
  });
  await withCase({}, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'lut40', { txVersion: 'v0' }));
    const preview = VersionedTransaction.deserialize(Buffer.from(portal.opens[0].params.transaction, 'base64'));
    assert.equal(preview.message.addressTableLookups.length, 2);
  });
});

test('U5: 65 addresses fit no format: TransactionTooLargeError before the prompt, nothing sent', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const error = await rejects(c.S().signAndSendTransaction(request(c, 'addresses65', V1)));
    assert.ok(error instanceof W.TransactionTooLargeError, `${error.name}: ${error.message}`);
    assert.equal(error.name, 'TransactionTooLargeError');
    assert.equal(error.stage, 'before-signing');
    assert.equal(error.format, 'v1');
    assert.equal(error.transaction, 'single');
    assert.equal(error.addresses, 65);
    assert.equal(error.addressLimit, 64);
    assert.equal(error.byteLimit, 4096);
    assert.equal(error.v1Unavailable, undefined);
    assertRefusedBeforeAnything(c, error);
    assert.equal(c.chain.rec.rpc.filter((r) => r.method === 'getLatestBlockhash').length, 0, 'not even the preview was built');
  });
});

test('U5: the worst-case WebAuthn estimate: exactly 4096 bytes passes the prompt; longer real bytes are refused after signing, unsent', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    // Size a payload so the draft with the worst-case response is exactly 4096 bytes.
    const probe = await rejects(c.S().signAndSendTransaction(request(c, c.corpus.payloads.sized(3000), V1)));
    assert.equal(probe.stage, 'before-signing');
    const n = 3000 - (probe.bytes - 4096);
    const over = await rejects(c.S().signAndSendTransaction(request(c, c.corpus.payloads.sized(n + 1), V1)));
    assert.equal(over.bytes, 4097, 'one byte more is refused before the prompt');
    assert.equal(portal.opens.length, 0);

    // A real clientDataJSON longer than the template + 128 bytes of slack.
    portal.clientDataPadding = 300;
    const after = await rejects(c.S().signAndSendTransaction(request(c, c.corpus.payloads.sized(n), V1)));
    assert.ok(after instanceof W.TransactionTooLargeError, `${after.name}: ${after.message}`);
    assert.equal(after.stage, 'after-signing');
    assert.equal(after.format, 'v1');
    assert.ok(after.bytes > 4096);
    assert.match(after.message, /nothing was sent/);
    assert.equal(portal.opens.length, 1, 'the passkey was asked once');
    assert.equal(sendRequests(c).length, 0, 'nothing sent');
    assert.equal(counter(c), COUNTER0, 'the approval was not used');

    // Chrome's real response, no padding: 128 bytes under the estimate. It lands, on the counter still unused.
    portal.clientDataPadding = 0;
    await c.S().signAndSendTransaction(request(c, c.corpus.payloads.sized(n), V1));
    const [tx] = landed(c);
    assertV1(tx, [SECP256R1, LAZORKIT]);
    assert.equal(tx.bytes, 4096 - 128);
    assert.equal(counter(c), COUNTER0 + 1);
  });
});

test("U5: a paymaster that did not declare acceptsTxV1: a 'v1' request is exactly the 'v0' one (requests, bytes, outcome)", async () => {
  for (const [flow, payload] of [
    ['execute', 'lutFits'],
    ['execute', 'transfer1'],
    ['session', 'lutFits'],
    ['authority', 'transfer1'],
  ]) {
    const record = await runCase(DIST, { id: `v1-without-acceptsTxV1/${flow}/${payload}`, flow, payload, options: V1 });
    const got = compact(record);
    const want = golden.cases[`web/${flow}/${payload}/v0`];
    for (const section of ['steps', 'paymaster', 'rpc', 'portal']) assert.deepEqual(got[section], want[section], `${flow}/${payload}: ${section}`);
    const warnings = record.diagnostics.console.filter((line) => /TxV1/.test(line));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^warn: \[TxV1\] .*goes out as v0: paymaster/);
  }
});

test("U5: the deferred pair without acceptsTxV1: exactly the 'v0' requests, with no read of TX2's fee accounts before the prompt", async () => {
  for (const [flow, payload] of [
    ['authorizeAndExecute', 'lutFits'],
    ['authorizeAndExecute', 'transfer1'],
    ['deferred', 'lutFits'],
    ['deferred', 'transfer1'],
  ]) {
    const record = await runCase(DIST, { id: `v1-without-acceptsTxV1/${flow}/${payload}`, flow, payload, options: V1 });
    const got = compact(record);
    const want = golden.cases[`web/${flow}/${payload}/v0`];
    // TX2 is built before the prompt only for v1: that reads the protocol
    // config and the fee payer's FeeRecord, which a 'v0' request does not.
    for (const section of ['steps', 'paymaster', 'rpc', 'portal']) assert.deepEqual(got[section], want[section], `${flow}/${payload}: ${section}`);
  }
});

test('U5: without acceptsTxV1, a payload no v0 form can carry is refused before the prompt, naming why v1 was not used', async () => {
  await withCase({}, async (c) => {
    const error = await rejects(c.S().signAndSendTransaction(request(c, 'payload2k2', V1)));
    assert.ok(error instanceof W.TransactionTooLargeError, `${error.name}: ${error.message}`);
    assert.equal(error.stage, 'before-signing');
    assert.equal(error.format, 'v0');
    assert.equal(error.v1Unavailable, 'paymaster');
    assert.equal(error.byteLimit, 1232);
    assert.equal(error.addressLimit, 64);
    assert.ok(error.bytes === null || error.bytes > 1232);
    assertRefusedBeforeAnything(c, error);
  });
});

test('U5: the mainnet program never goes out as v1 (not-devnet-v2), even with a paymaster that accepts v1', async () => {
  await withCase({ programId: sdk.PROGRAM_ID_MAINNET, cluster: 'mainnet', paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    const [tx] = landed(c);
    assert.equal(tx.version, 0);
    assert.deepEqual(tx.instructions.map((ix) => ix.program), [SECP256R1, sdk.PROGRAM_ID_MAINNET.toBase58()]);
    assert.equal(simulations(c).length, 0);
    await c.S().signAndSendWithSession(request(c, 'transfer1', V1));
    assert.equal(landed(c)[1].version, 0);
  });
  assert.equal(logged.warn.filter((w) => /goes out as v0: not-devnet-v2/.test(w)).length, 1, 'logged once per reason');
});

test("U5: a deferred pair on the mainnet program, as 'v1', reads what a 'v0' one does: TX2 is not built before the prompt", async () => {
  for (const flow of ['authorizeAndExecute', 'authorizeDeferred']) {
    const methods = {};
    for (const txVersion of ['v0', 'v1']) {
      await withCase({ programId: sdk.PROGRAM_ID_MAINNET, cluster: 'mainnet', paymasterConfig: ACCEPTS }, async (c) => {
        await c.S()[flow](request(c, 'transfer1', { txVersion }));
        assert.equal(c.S().error, null, `${flow} ${txVersion}`);
        assert.ok(landed(c).every((tx) => tx.version === 0));
        methods[txVersion] = c.chain.rec.rpc.map((r) => r.method);
      });
    }
    assert.deepEqual(methods.v1, methods.v0, flow);
  }
});

test("U5: limits out of range are a RangeError before the prompt, for 'v1' only", async () => {
  for (const bad of [
    { computeUnitLimit: 0 },
    { computeUnitLimit: 1_400_001 },
    { computeUnitLimit: 1.5 },
    { loadedAccountsDataSizeLimit: 196_607 },
    { loadedAccountsDataSizeLimit: 67_108_865 },
  ]) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      const error = await rejects(c.S().signAndSendTransaction(request(c, 'transfer1', { ...V1, ...bad })));
      assert.ok(error instanceof RangeError, `${JSON.stringify(bad)}: ${error.name}: ${error.message}`);
      assertRefusedBeforeAnything(c, error);
    });
  }
  // Ignored by a v0 send, as before.
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', { txVersion: 'v0', computeUnitLimit: 0 }));
    assert.equal(landed(c)[0].version, 0);
  });
});

test("U5: a 'v1' request that goes out as v0 does not check the v1 limits: they are the v1 config's, and v0 ignores them", async () => {
  for (const [why, options] of [
    ['paymaster', {}],
    ['not-devnet-v2', { programId: sdk.PROGRAM_ID_MAINNET, cluster: 'mainnet', paymasterConfig: ACCEPTS }],
  ]) {
    for (const limits of [{ computeUnitLimit: 2_000_000 }, { computeUnitLimit: 0 }, { loadedAccountsDataSizeLimit: 100_000 }]) {
      await withCase(options, async (c) => {
        await c.S().signAndSendTransaction(request(c, 'transfer1', { ...V1, ...limits }));
        assert.equal(landed(c)[0].version, 0, `${why} ${JSON.stringify(limits)}`);
        assert.equal(c.S().error, null);
      });
    }
  }
});

test("U5: the program ceilings are the devnet v2 program's: a 'v1' request for another LazorKit program is sent as a 'v0' one would be", async () => {
  await withCase({ programId: sdk.PROGRAM_ID_MAINNET, cluster: 'mainnet', paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'inner17', V1));
    assert.equal(landed(c)[0].version, 0);
  });
  // On devnet v2 they hold whether or not v1 is available: that program cannot run it in any format.
  for (const heap of [null, [16, 42]]) {
    await withCase({}, async (c) => {
      const payload = heap ? c.corpus.payloads.heap(...heap) : 'inner17';
      const error = await rejects(c.S().signAndSendTransaction(request(c, payload, V1)));
      assert.ok(error instanceof W.PayloadExceedsProgramLimitsError, `${error.name}: ${error.message}`);
      assertRefusedBeforeAnything(c, error);
    });
  }
});

test('U5: payloads over the program ceilings (17 instructions; its heap) are refused before the prompt or the local signature', async () => {
  // The most each instruction runs on #42's exact sizing, plus one meta: 16 × 41 on a
  // passkey Execute, 16 × 42 on ExecuteDeferred, 16 × 148 on a session's Execute.
  for (const [flow, name, limit] of [
    ['signAndSendTransaction', 'inner17', 'inner-instructions'],
    ['signAndSendTransaction', [16, 42], 'heap'],
    ['signAndSendWithSession', 'inner17', 'inner-instructions'],
    ['signAndSendWithSession', [16, 149], 'heap'],
    ['signAndSendWithAuthority', [16, 149], 'heap'],
    // TX2 (ExecuteDeferred) would run out: the pair is refused, TX1 never sent.
    ['authorizeAndExecute', [16, 43], 'heap'],
    ['authorizeDeferred', [16, 43], 'heap'],
  ]) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      const payload = typeof name === 'string' ? name : c.corpus.payloads.heap(...name);
      const error = await rejects(c.S()[flow](request(c, payload, V1)));
      assert.ok(error instanceof W.PayloadExceedsProgramLimitsError, `${name} ${flow}: ${error.name}: ${error.message}`);
      assert.equal(error.limit, limit);
      if (name === 'inner17') assert.equal(error.innerInstructions, 17);
      else {
        assert.ok(error.heapBytes > 32_760, `${name} ${flow}: ${error.heapBytes}`);
        assert.deepEqual([error.maxMetas, error.totalMetas], [name[1], name[0] * (name[1] + 1)]);
        assert.equal(error.policy, undefined, 'none of these signers carries a policy');
      }
      assertRefusedBeforeAnything(c, error);
    });
  }
  // One meta fewer runs, as v1.
  for (const [flow, [k, n], programs] of [
    ['signAndSendTransaction', [16, 41], [SECP256R1, LAZORKIT]],
    ['signAndSendWithSession', [16, 148], [LAZORKIT]],
    ['signAndSendWithAuthority', [16, 148], [LAZORKIT]],
    ['authorizeAndExecute', [16, 42], [LAZORKIT]],
  ]) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      await c.S()[flow](request(c, c.corpus.payloads.heap(k, n), V1));
      assertV1(landed(c).at(-1), programs);
    });
  }
});

test('U5: what the check refused for the program before its exact sizing (#42) now goes out as v1 on every path', async () => {
  for (const flow of ['signAndSendTransaction', 'signAndSendWithSession', 'authorizeAndExecute']) {
    for (const name of ['heap128', 'heap129', 'heap16x16']) {
      await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
        await c.S()[flow](request(c, name, V1));
        assert.ok(landed(c).length > 0 && landed(c).every((tx) => tx.version === 1), `${flow} ${name}`);
      });
    }
  }
});

/** A v2 session's or authority's policy: `actions` SolLimit actions (11-byte header, 8 bytes of data). */
const solLimits = (actions) =>
  Buffer.concat(Array.from({ length: actions }, () => Buffer.concat([Buffer.from([1, 8, 0]), Buffer.alloc(8), Buffer.alloc(8, 1)])));
/** Give the ledger's session `actions`, or make an authority a Delegate carrying them. */
function withPolicy(c, account, actions) {
  const entry = c.chain.ledger.accounts.get(account.toBase58());
  const data = Buffer.concat([entry.data, solLimits(actions)]);
  if (data[0] === sdk.ACCOUNT_DISCRIMINATOR.AUTHORITY) {
    data[2] = 2; // Delegate: the only rank that carries a policy
    data.writeUInt16LE(data.length - entry.data.length, 12);
  }
  entry.data = data;
}
const accountReads = (c, account) =>
  c.chain.rec.rpc.filter((r) => r.method === 'getAccountInfo' && r.params[0] === account.toBase58()).length;

test("U5: a policy-bound signer's policy is counted: what its payload runs without one is refused before the signature", async () => {
  // 16 × 148 runs on a session's or an Ed25519 authority's Execute without a
  // policy (32,668 bytes); two actions and the one account the payload writes
  // add 64 × 2 + 240, and the last flags' alignment 4: 33,040.
  for (const [flow, account] of [
    ['signAndSendWithSession', (c) => c.corpus.sessionPda],
    ['signAndSendWithAuthority', (c) => c.corpus.edAuthorityPda],
  ]) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      withPolicy(c, account(c), 2);
      const error = await rejects(c.S()[flow](request(c, c.corpus.payloads.heap(16, 148), V1)));
      assert.ok(error instanceof W.PayloadExceedsProgramLimitsError, `${flow}: ${error.name}: ${error.message}`);
      assert.equal(error.limit, 'heap');
      assert.deepEqual(error.policy, { actions: 2, vaultTokenAccounts: 1 });
      assert.equal(error.heapBytes, 33_040);
      assert.match(error.message, /beside a policy of 2 actions and 1 vault token accounts needs 33040 bytes/);
      assertRefusedBeforeAnything(c, error);
    });
    // A payload the policy leaves room for goes out, after one read of the signer's account.
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      withPolicy(c, account(c), 2);
      const before = accountReads(c, account(c));
      await c.S()[flow](request(c, c.corpus.payloads.heap(16, 146), V1));
      assertV1(landed(c)[0], [LAZORKIT]);
      assert.equal(accountReads(c, account(c)) - before, 2, 'the flow\'s own read, and the policy\'s');
    });
  }
  // A passkey Delegate: 16 × 41 runs on an Owner's passkey Execute, not beside a policy.
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    withPolicy(c, c.corpus.authorityPda, 1);
    const error = await rejects(c.S().signAndSendTransaction(request(c, c.corpus.payloads.heap(16, 41), V1)));
    assert.ok(error instanceof W.PayloadExceedsProgramLimitsError, `${error.name}: ${error.message}`);
    assert.deepEqual(error.policy, { actions: 1, vaultTokenAccounts: 1 });
    assertRefusedBeforeAnything(c, error);
  });
});

test('U5: authorizeAndExecute: TX1 and TX2 both go out as v1; TX2 runs the authorization and closes it', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const signature = await c.S().authorizeAndExecute(request(c, 'lutFits', V1));
    const [tx1, tx2] = landed(c);
    assertV1(tx1, [SECP256R1, LAZORKIT]);
    assertV1(tx2, [LAZORKIT]);
    assert.equal(tx1.instructions[1].discriminator, sdk.DISC_AUTHORIZE);
    assert.equal(tx2.instructions[0].discriminator, sdk.DISC_EXECUTE_DEFERRED);
    assert.equal(tx2.signature, signature);
    assert.ok(tx2.effects.some((e) => /DeferredExec .* closed/.test(e)));
    assert.equal(counter(c), COUNTER0 + 1, 'only TX1 uses the counter');
  });
});

test('U5: a fee payer with no FeeRecord yet: RegisterPayer goes first in v1 too, and TX2 of a pair still carries it', async () => {
  await withCase({ paymasterConfig: ACCEPTS, noFeeRecord: true }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    const [tx] = landed(c);
    assertV1(tx, [LAZORKIT, SECP256R1, LAZORKIT]);
    assert.equal(tx.instructions[0].discriminator, sdk.DISC_REGISTER_PAYER);
  });
  // TX2 is measured before the prompt by a client of its own: the flow's
  // client, which builds the real TX2 after TX1, must still add RegisterPayer.
  await withCase({ paymasterConfig: ACCEPTS, noFeeRecord: true }, async (c) => {
    await c.S().authorizeAndExecute(request(c, 'transfer1', V1));
    const [tx1, tx2] = landed(c);
    assertV1(tx1, [SECP256R1, LAZORKIT]);
    assertV1(tx2, [LAZORKIT, LAZORKIT]);
    assert.deepEqual(tx2.instructions.map((ix) => ix.discriminator), [sdk.DISC_REGISTER_PAYER, sdk.DISC_EXECUTE_DEFERRED]);
  });
});

test('U5: a TX2 that cannot be carried refuses the pair before the prompt: TX1 is never sent', async () => {
  for (const flow of ['authorizeAndExecute', 'authorizeDeferred']) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      const error = await rejects(c.S()[flow](request(c, c.corpus.payloads.sized(3500), V1)));
      assert.ok(error instanceof W.TransactionTooLargeError, `${flow}: ${error.name}: ${error.message}`);
      assert.equal(error.transaction, 'tx2');
      assert.equal(error.stage, 'before-signing');
      assert.equal(error.format, 'v1');
      assertRefusedBeforeAnything(c, error);
    });
  }
});

test('U5: authorizeDeferred, then executeDeferred with its payload: both v1', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    const { deferredPayload } = await c.S().authorizeDeferred(request(c, 'transfer1', V1));
    const signature = await c.S().executeDeferred({ deferredPayload, transactionOptions: V1 });
    const [tx1, tx2] = landed(c);
    assertV1(tx1, [SECP256R1, LAZORKIT]);
    assertV1(tx2, [LAZORKIT]);
    assert.equal(tx2.signature, signature);
  });
});

test('U5: session and Ed25519 authority sends go out as v1, the local key signed after the limits were set', async () => {
  for (const flow of ['signAndSendWithSession', 'signAndSendWithAuthority']) {
    await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
      const signature = await c.S()[flow](request(c, 'lutFits', V1));
      const [tx] = landed(c);
      assertV1(tx, [LAZORKIT]);
      assert.equal(tx.signature, signature);
      assert.equal(tx.numRequiredSignatures, 2);
      const key = flow === 'signAndSendWithSession' ? c.corpus.sessionKey : c.corpus.edAuthority;
      assert.equal(tx.signatures[1].signer, key.publicKey.toBase58());
      // No passkey lane: the simulation is not tied to a slot.
      const [simulation] = simulations(c);
      assert.equal(simulation.params[1].minContextSlot, undefined);
    });
  }
});

test('U5 / U7: two passkey sends in a row: the second simulates from a node past the first one', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    const [first, second] = landed(c);
    assert.equal(counter(c), COUNTER0 + 2);
    assert.equal(simulations(c)[1].params[1].minContextSlot, first.landedSlot);
    assert.ok(second.landedSlot > first.landedSlot);
  });
});

test("U5 / U8: a paymaster that refuses v1 (-32051): one request, nothing sent; the page's next 'v1' requests to it go out as v0", async () => {
  const paymasterUrl = 'http://paymaster-refuses-v1.invalid/';
  await withCase({ paymasterUrl, paymasterConfig: ACCEPTS, txV1: { refuse: true } }, async (c) => {
    const error = await rejects(c.S().signAndSendTransaction(request(c, 'transfer1', V1)));
    assert.equal(error.name, 'PaymasterError');
    assert.equal(error.code, -32051);
    assert.equal(error.maybeSent, false);
    assert.equal(sendRequests(c).length, 1, 'not retried');
    assert.equal(landed(c).length, 0);
    assert.equal(counter(c), COUNTER0);

    const before = logged.warn.length;
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    await c.S().signAndSendWithSession(request(c, 'transfer1', V1));
    assert.deepEqual(landed(c).map((tx) => tx.version), [0, 0]);
    assert.ok(sendRequests(c).slice(1).every((p) => wire(p)[0] !== 0x81));
    const refusals = logged.warn.slice(before).filter((w) => /goes out as v0: refused/.test(w));
    assert.equal(refusals.length, 1, 'logged once');
  });
  // Another paymaster is not affected.
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    assert.equal(landed(c)[0].version, 1);
  });
});

// ── U7: limits ──────────────────────────────────────────────────────────

const simulated = (unitsConsumed, loadedAccountsDataSize) => () => ({
  value: { err: null, logs: [], accounts: null, unitsConsumed, loadedAccountsDataSize, returnData: null },
});

test('U7: one simulation of the unsigned draft, with the ceilings; CU × 1.2 + 5,000 and loaded data × 1.1 in 32 KiB pages', async () => {
  await withCase({ paymasterConfig: ACCEPTS, txV1: { simulate: simulated(46_828, 2_407_845) } }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    const [simulation] = simulations(c);
    assert.equal(simulations(c).length, 1);
    const [encoded, options] = simulation.params;
    assert.deepEqual(
      { ...options, minContextSlot: undefined },
      { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', minContextSlot: undefined },
    );
    const draft = VersionedTransaction.deserialize(Buffer.from(encoded, 'base64'));
    assert.equal(draft.version, 1);
    assert.equal(draft.message.transactionConfig.computeUnitLimit, CEILINGS.computeUnitLimit);
    assert.equal(draft.message.transactionConfig.loadedAccountsDataSizeLimit, CEILINGS.loadedAccountsDataSizeLimit);
    assert.ok(draft.signatures.every((s) => s.every((b) => b === 0)), 'nothing signed yet');
    const [tx] = landed(c);
    assert.deepEqual(config(tx), { computeUnitLimit: 61_194, loadedAccountsDataSizeLimit: 2_654_208 });
    assert.equal(tx.bytes, Buffer.from(encoded, 'base64').length, 'the draft is as long as the final transaction');
  });
});

test('U7: any problem with the simulation gives the ceilings, and the transaction still goes out', async () => {
  const problems = {
    'a simulation error': () => ({ value: { err: { InstructionError: [1, { Custom: 1 }] }, logs: [], unitsConsumed: 5_000, loadedAccountsDataSize: 161_320 } }),
    'an RPC error': () => ({ error: { code: -32005, message: 'Node is behind by 42 slots' } }),
    'minimum context slot not reached': () => ({ error: { code: -32016, message: 'Minimum context slot has not been reached' } }),
    'no loaded-data measurement': () => ({ value: { err: null, logs: [], unitsConsumed: 13_011 } }),
    'no answer within 3 s': () => ({ delayMs: 3_500, value: { err: null, logs: [], unitsConsumed: 13_011, loadedAccountsDataSize: 161_320 } }),
    'HTTP 429 (web3.js backs off past 3 s)': () => ({ http: 429, text: 'Too many requests' }),
  };
  let bytes;
  for (const [problem, simulate] of Object.entries(problems)) {
    await withCase({ paymasterConfig: ACCEPTS, txV1: { simulate } }, async (c) => {
      const before = logged.warn.length;
      const started = Date.now();
      await c.S().signAndSendWithSession(request(c, 'transfer1', V1));
      const [tx] = landed(c);
      assert.deepEqual(config(tx), CEILINGS, problem);
      assert.ok(Date.now() - started < 3_000 + 2_000, `${problem}: bounded`);
      assert.ok(logged.warn.slice(before).some((w) => /using the ceilings/.test(w)), problem);
      bytes ??= tx.bytes;
      assert.equal(tx.bytes, bytes, 'the limits never change the size');
    });
  }
});

test('U7: the 3 s bound covers reading the lane floor too: a send another tab left unsettled does not hold the simulation', async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    // While the user approves, another tab of the app records a send for this
    // passkey whose outcome it does not know (no signature, not expired).
    portal.whileOpen = () =>
      localStorage.setItem(
        `lazorkit:passkey-lane:${c.corpus.authorityPda.toBase58()}`,
        JSON.stringify({ unsettled: { blockhash: c.corpus.blockhash, lastValidBlockHeight: BLOCK_HEIGHT0 + 10_000, since: Date.now() - 115_000 } }),
      );
    const before = logged.warn.length;
    const started = Date.now();
    await c.S().signAndSendTransaction(request(c, 'transfer1', V1));
    assert.ok(Date.now() - started < 3_000 + 2_000, `${Date.now() - started} ms`);
    assert.equal(simulations(c).length, 0, 'the lane read did not finish within the bound');
    assert.deepEqual(config(landed(c)[0]), CEILINGS);
    assert.ok(logged.warn.slice(before).some((w) => /using the ceilings/.test(w)));
  });
});

test("U7: the caller's limits: both skip the simulation; one is kept and the other simulated", async () => {
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendTransaction(request(c, 'transfer1', { ...V1, computeUnitLimit: 30_000, loadedAccountsDataSizeLimit: 300_000 }));
    assert.equal(simulations(c).length, 0);
    assert.deepEqual(config(landed(c)[0]), { computeUnitLimit: 30_000, loadedAccountsDataSizeLimit: 300_000 });
  });
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendWithSession(request(c, 'transfer1', { ...V1, computeUnitLimit: 50_000 }));
    assert.equal(simulations(c).length, 1);
    assert.deepEqual(config(landed(c)[0]), { computeUnitLimit: 50_000, loadedAccountsDataSizeLimit: 196_608 });
  });
  await withCase({ paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendWithSession(request(c, 'transfer1', { ...V1, loadedAccountsDataSizeLimit: 1_048_576 }));
    assert.deepEqual(config(landed(c)[0]), { computeUnitLimit: 20_614, loadedAccountsDataSizeLimit: 1_048_576 });
  });
});

// ── U8: Paymaster.signAndSendRaw ────────────────────────────────────────

const KORA_3006 = { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(1, Custom(3006))' };
const KORA_3014 = { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(3014))' };
const KORA_3037 = { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(3037))' };
const KORA_3038 = { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(3038))' };
const INTERNAL = { code: -32603, message: 'Internal error: upstream RPC unavailable' };
const REFUSED_V1 = { code: -32051, message: 'transaction version 1 is not enabled on this paymaster' };
const SIGNATURE = '5'.repeat(88);

/** A scripted paymaster: the i-th signAndSendTransaction gets `answers[i]` (the last repeats). */
function scriptPaymaster(answers) {
  const bodies = [];
  setHandlers({
    rpc: async () => ({ status: 500, json: 'no RPC in this test' }),
    paymaster: async (body) => {
      const { id, method } = JSON.parse(body);
      if (method !== 'signAndSendTransaction') throw new Error(`unscripted ${method}`);
      const answer = answers[Math.min(bodies.length, answers.length - 1)];
      bodies.push(body);
      if (answer.http) return { status: answer.http, json: 'Bad Gateway' };
      if (answer.error) return { json: { jsonrpc: '2.0', id, error: answer.error } };
      return { json: { jsonrpc: '2.0', id, result: { signature: answer.signature } } };
    },
  });
  return bodies;
}

async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (e) {
    return { error: { name: e.name, code: e.code ?? e.cause?.code, maybeSent: e.maybeSent, signature: e.signature } };
  }
}

test("U8: signAndSendRaw has signAndSendVersionedTransaction's retries and error mapping, on the same bytes", async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: Keypair.fromSeed(Buffer.alloc(32, 8)).publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.fromSeed(Buffer.alloc(32, 9)).publicKey, lamports: 1 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const raw = tx.serialize();
  const table = {
    'answered at once': [{ signature: SIGNATURE }],
    '3006 (SignatureReused)': [{ error: KORA_3006 }],
    '3014 (DeferredAuthorizationExpired)': [{ error: KORA_3014 }],
    '3037 (ActionUnlistedSolOutflow)': [{ error: KORA_3037 }],
    '3038 (ActionUnlistedTokenOutflow)': [{ error: KORA_3038 }],
    'a 502 then 3037 (the 502 may have been sent)': [{ http: 502 }, { error: KORA_3037 }],
    'already processed': [{ error: { code: -32002, message: 'Transaction simulation failed: This transaction has already been processed' } }],
    'sent, then failed (signature in the error)': [{ error: { code: -32002, message: 'Transaction failed', data: { signature: SIGNATURE } } }],
    'internal error every time': [{ error: INTERNAL }],
    'a 502 then internal errors': [{ http: 502 }, { error: INTERNAL }],
    'a 502 then an answer': [{ http: 502 }, { signature: SIGNATURE }],
  };
  for (const [row, answers] of Object.entries(table)) {
    const viaVersioned = scriptPaymaster(answers);
    const a = await outcome(new W.Paymaster({ paymasterUrl: 'http://paymaster-u8.invalid/' }).signAndSendVersionedTransaction(tx, 3, 1));
    const viaRaw = scriptPaymaster(answers);
    const b = await outcome(new W.Paymaster({ paymasterUrl: 'http://paymaster-u8.invalid/' }).signAndSendRaw(raw, payer, 3, 1));
    assert.deepEqual(b, a, row);
    assert.deepEqual(viaRaw, viaVersioned, `${row}: the same requests`);
    assert.ok(viaRaw.every((body) => body === viaRaw[0]), `${row}: a retry resends the same bytes`);
    // 3037 / 3038 with nothing sent before: the same bytes move the same assets, so no retry.
    if (/^303[78] /.test(row)) {
      assert.equal(viaRaw.length, 1, `${row}: not retried`);
      assert.deepEqual(b.error, { name: 'PaymasterError', code: -32602, maybeSent: false, signature: undefined }, row);
    }
  }
});

test('U8: -32051 is not retried by signAndSendRaw (and still is by the other sends); maybeSent is kept', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
  const raw = new Uint8Array(200).fill(1);
  raw[0] = 0x81;
  let bodies = scriptPaymaster([{ error: REFUSED_V1 }]);
  let result = await outcome(new W.Paymaster({ paymasterUrl: 'http://paymaster-u8a.invalid/' }).signAndSendRaw(raw, payer, 3, 1));
  assert.deepEqual(result.error, { name: 'PaymasterError', code: -32051, maybeSent: false, signature: undefined });
  assert.equal(bodies.length, 1);

  bodies = scriptPaymaster([{ http: 502 }, { error: REFUSED_V1 }]);
  result = await outcome(new W.Paymaster({ paymasterUrl: 'http://paymaster-u8b.invalid/' }).signAndSendRaw(raw, payer, 3, 1));
  assert.deepEqual(result.error, { name: 'PaymasterError', code: -32051, maybeSent: true, signature: undefined }, 'the 502 may have been sent');
  assert.equal(bodies.length, 2);

  // sendWithRetries without stopIf: as before, three attempts.
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: payer.toBase58(), instructions: [] }).compileToV0Message();
  bodies = scriptPaymaster([{ error: REFUSED_V1 }]);
  result = await outcome(new W.Paymaster({ paymasterUrl: 'http://paymaster-u8c.invalid/' }).signAndSendVersionedTransaction(new VersionedTransaction(message), 3, 1));
  assert.equal(result.error.code, -32051);
  assert.equal(bodies.length, 3);
});

test("U8: a -32051 from signAndSendRaw moves that paymaster's later 'v1' requests to v0", async () => {
  const paymasterUrl = 'http://paymaster-u8a.invalid/'; // refused v1 in the test above
  await withCase({ paymasterUrl, paymasterConfig: ACCEPTS }, async (c) => {
    await c.S().signAndSendWithSession(request(c, 'transfer1', V1));
    assert.equal(landed(c)[0].version, 0);
  });
});

// ── 3037 / 3038 on a 'v1' session or authority send ─────────────────────

test("U8: a 'v1' session or authority send refused with 3037 / 3038 rejects as the same send in 'v0' does, after one request", async () => {
  // Kora's text has no logs: a session's (or a record with no role's) is
  // the typed error; an Admin key's (the corpus authority, role 1) has no
  // policy, so it is LazorKit's only when the logs say so, and stays the
  // PaymasterError.
  const rows = [
    ['signAndSendWithSession', KORA_3037, 'UnlistedSolOutflowError', 'session'],
    ['signAndSendWithSession', KORA_3038, 'UnlistedTokenOutflowError', 'session'],
    ['signAndSendWithAuthority', KORA_3037, 'PaymasterError'],
    ['signAndSendWithAuthority', KORA_3038, 'PaymasterError'],
  ];
  for (const [flow, answer, expected, signer] of rows) {
    const seen = {};
    for (const txVersion of ['v0', 'v1']) {
      await withCase({ paymasterConfig: ACCEPTS, fault: { always: { error: answer } } }, async (c) => {
        const error = await rejects(c.S()[flow](request(c, 'transfer1', { txVersion })));
        const requests = sendRequests(c);
        assert.equal(requests.length, 1, `${flow} ${txVersion} ${answer.message}: not retried`);
        assert.equal(wire(requests[0])[0] === 0x81, txVersion === 'v1', `${flow} ${txVersion}: sent in its format`);
        assert.equal(landed(c).length, 0);
        assert.equal(c.S().error, error);
        seen[txVersion] = { name: error.name, signer: error.signer, code: error.code ?? error.cause?.code, maybeSent: error.maybeSent ?? error.cause?.maybeSent };
      });
    }
    assert.equal(seen.v1.name, expected, `${flow}: ${answer.message}`);
    if (signer) assert.equal(seen.v1.signer, signer);
    assert.deepEqual(seen.v1, seen.v0, `${flow}: 'v1' rejects as 'v0' does`);
  }
});

// ── U10: logs of a landed v1 transaction ────────────────────────────────

const LANDED_3006 = { InstructionError: [1, { Custom: 3006 }] };
/** The recorded devnet getTransaction answer, failed with 3006 and `logs`. */
function recordedWith(logs) {
  return () => {
    const result = structuredClone(recorded.maxSupportedTransactionVersion1);
    result.meta.err = LANDED_3006;
    result.meta.status = { Err: LANDED_3006 };
    result.meta.logMessages = logs;
    return result;
  };
}
const lazorkitFails = [`Program ${LAZORKIT} invoke [1]`, `Program ${LAZORKIT} failed: custom program error: 0xbbe`];
const innerFails = [
  `Program ${LAZORKIT} invoke [1]`,
  `Program ${NOOP_PROGRAM} invoke [2]`,
  `Program ${NOOP_PROGRAM} failed: custom program error: 0xbbe`,
  `Program ${LAZORKIT} failed: custom program error: 0xbbe`,
];

test('U10: the recorded devnet answer: a v1 signature needs maxSupportedTransactionVersion 1', () => {
  assert.equal(recorded.maxSupportedTransactionVersion1.version, 1);
  assert.equal(recorded.maxSupportedTransactionVersion0.error.code, -32015);
  const tx = VersionedTransaction.deserialize(Buffer.from(recorded.maxSupportedTransactionVersion1.transaction[0], 'base64'));
  assert.equal(tx.version, 1);
});

test("U10: a landed v1 transaction's 3006 is read from its logs with a raw getTransaction: LazorKit's, or an inner program's", async () => {
  for (const [logs, expected] of [
    [lazorkitFails, 'SignatureReusedError'],
    [innerFails, 'TransactionFailedError'],
  ]) {
    await withCase(
      { paymasterConfig: ACCEPTS, fault: { landedErr: LANDED_3006 }, txV1: { transaction: recordedWith(logs) } },
      async (c) => {
        const error = await rejects(c.S().signAndSendTransaction(request(c, 'transfer1', V1)));
        assert.equal(error.name, expected, error.message);
        const reads = c.chain.rec.rpc.filter((r) => r.method === 'getTransaction');
        assert.equal(reads.length, 1);
        assert.deepEqual(reads[0].params, [landed(c)[0].signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
        const failed = expected === 'TransactionFailedError' ? error : error.cause;
        assert.deepEqual(failed.logs, logs);
      },
    );
  }
});

test("U10: a paymaster's 3006 without logs, for v1 bytes: the signed transaction is simulated raw for them", async () => {
  for (const [logs, expected] of [
    [lazorkitFails, 'SignatureReusedError'],
    [innerFails, 'PaymasterError'],
  ]) {
    let calls = 0;
    const simulate = () =>
      calls++ === 0
        ? { value: { err: null, logs: [], unitsConsumed: 13_011, loadedAccountsDataSize: 161_320 } }
        : { value: { err: LANDED_3006, logs, unitsConsumed: 9_000, loadedAccountsDataSize: 161_320 } };
    await withCase({ paymasterConfig: ACCEPTS, fault: { always: { error: KORA_3006 } }, txV1: { simulate } }, async (c) => {
      const error = await rejects(c.S().signAndSendTransaction(request(c, 'transfer1', V1)));
      assert.equal(error.name, expected, error.message);
      assert.equal(sendRequests(c).length, 1);
      const [, logsRead] = simulations(c);
      assert.equal(logsRead.params[0], JSON.parse(sendRequests(c)[0].body).params.transaction, 'the bytes that were sent');
      assert.deepEqual(logsRead.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
      if (expected === 'PaymasterError') assert.deepEqual(error.logs, logs);
    });
  }
});

test('nothing left the process', () => {
  assert.deepEqual(router.unexpected, []);
});
