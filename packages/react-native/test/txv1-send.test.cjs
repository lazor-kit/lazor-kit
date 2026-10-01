// The v1 wiring of the mobile adapter (core/wallet/txv1-send.ts), offline,
// on Node 18 or later. Through the built package (`pnpm build` first), against
// the scripted cluster, paymaster and portal of ./support/txv1-cluster.cjs:
//
//   U5   which format a 'v1' request goes out in, and what is refused before
//        the portal opens (every gate reason, fits and does not fit, before and
//        after signing, the deferred pair), with no portal and no send when it
//        is refused before the prompt;
//   U7   the limits: simulated, the caller's, the maximums on any simulation
//        problem (an error, a failed simulation, a missing field, a 429, no
//        answer within 3 s), the lane's floor in the simulation;
//   U9   the ComputeBudget strip;
//   U10  the logs of a landed v1 transaction, read raw;
//   and the paymaster's -32051 refusal: one request, not retried, not resent
//   as v0, remembered for later requests.
//
// The gate and the strip are also tested on the source, with their imports
// stubbed. The flag-off identity (U4) is the packed-tarball comparison against
// the 2.2.1 goldens; here a request without 'v1' is only checked to take the
// v0 path.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { M, sdk, web3, world, use, captureConsole, REDIRECT, SECP256R1, COMPUTE_BUDGET, NOOP } = require('./support/txv1-cluster.cjs');

const { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction } = web3;
const LAZORKIT = sdk.PROGRAM_ID_DEVNET.toBase58();
const SIGN = { redirectUrl: REDIRECT };
const MAX_CU = 1_400_000;
const MAX_LAD = 67_108_864;
const RECORDED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'getTransaction-v1.json'), 'utf8')).result;

/**
 * A passkey Execute of `instructions` through the store, with the console
 * captured. `accepts`: the paymaster's `acceptsTxV1`, or null to leave it out.
 */
function execute(w, instructions, transactionOptions, accepts = true) {
  const S = use(w, { acceptsTxV1: accepts === null ? undefined : accepts });
  return captureConsole(() => S.signAndExecuteTransaction({ instructions, transactionOptions }, SIGN));
}
const programsOf = (send) => send.instructions.map((ix) => ix.program);
const simulations = (w) => w.rec.rpc.filter((r) => r.method === 'simulateTransaction');
const sends = (w) => w.rec.paymaster.filter((p) => p.method === 'signAndSendTransaction');

/** Nothing was asked of the user and nothing reached the paymaster's send. */
function assertNothingSent(w) {
  assert.equal(w.rec.portal.length, 0, 'the portal opened');
  assert.equal(sends(w).length, 0, 'the paymaster was asked to send');
  assert.equal(w.counter(), 41, 'the counter moved');
}

test('setup: the persisted store has hydrated', async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
});

// ─── The gate (U5) ──────────────────────────────────────────────────────────

test("each reason a 'v1' request goes out as v0 is logged once, the first time", async () => {
  const a = world();
  const first = await execute(a, [a.transfer()], { txVersion: 'v1' }, null);
  const second = await execute(a, [a.transfer()], { txVersion: 'v1' }, false);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.deepEqual(a.sent().map((s) => s.version), [0, 0]);
  const warned = [...first.lines.warn, ...second.lines.warn].filter((l) => l.includes('TxV1'));
  assert.equal(warned.length, 1, warned.join('\n'));
  assert.match(warned[0], /acceptsTxV1/);

  const b = world();
  const feeToken = new PublicKey(Buffer.alloc(32, 3)).toBase58();
  const f1 = await execute(b, [b.transfer()], { txVersion: 'v1', feeToken });
  const f2 = await execute(b, [b.transfer()], { txVersion: 'v1', feeToken });
  assert.deepEqual(b.sent().map((s) => s.version), [0, 0]);
  const feeWarned = [...f1.lines.warn, ...f2.lines.warn].filter((l) => l.includes('TxV1'));
  assert.equal(feeWarned.length, 1);
  assert.match(feeWarned[0], /fee token/);
});

test("'v1' with a paymaster that accepts it, on the devnet v2 program, goes out as v1", async () => {
  const w = world();
  const { value, error, lines } = await execute(w, [w.transfer()], { txVersion: 'v1' });
  assert.equal(error, undefined);
  assert.equal(lines.warn.length, 0, lines.warn.join('\n'));
  const [send] = w.sent();
  assert.equal(value, send.signature);
  assert.equal(send.version, 1);
  assert.equal(send.raw[0], 0x81);
  assert.ok(send.bytes > 900 && send.bytes < 1232, `${send.bytes} bytes`);
  // Secp256r1 directly before LazorKit's Execute, and no ComputeBudget.
  assert.deepEqual(programsOf(send), [SECP256R1, LAZORKIT]);
  // Sent with the fee payer's slot empty: the paymaster signs it.
  assert.equal(send.payerSlotEmpty, true);
  assert.equal(send.staticKeys[0], w.feePayer.publicKey.toBase58());
  // The limits from the simulation: 13,011 units -> 20,614; 161,320 bytes -> 196,608.
  assert.deepEqual(
    { cu: send.config.computeUnitLimit, lad: send.config.loadedAccountsDataSizeLimit, fee: send.config.priorityFee, heap: send.config.heapSize },
    { cu: 20_614, lad: 196_608, fee: null, heap: null },
  );
  assert.equal(w.counter(), 42);
  assert.equal(w.rec.portal.length, 1);
  // One more RPC call than v0: the simulation, between the blockhash and the send.
  assert.deepEqual(w.methods().slice(-4), ['getLatestBlockhash', 'getLatestBlockhash', 'simulateTransaction', 'getSignatureStatuses']);
  // Paymaster: the payer, then one send of base64 v1 bytes with no fee token.
  assert.deepEqual(w.rec.paymaster.map((p) => p.method), ['getPayerSigner', 'signAndSendTransaction']);
  const body = JSON.parse(sends(w)[0].body);
  assert.deepEqual(Object.keys(body.params).sort(), ['signer_key', 'transaction']);
  assert.equal(body.params.signer_key, w.feePayer.publicKey.toBase58());
});

test("'v1' on the mainnet program goes out as v0 (not-devnet-v2)", async () => {
  const w = world({ cluster: 'mainnet' });
  const { error, lines } = await execute(w, [w.transfer()], { txVersion: 'v1' });
  assert.equal(error, undefined);
  const [send] = w.sent();
  assert.equal(send.version, 0);
  assert.ok(programsOf(send).includes(sdk.PROGRAM_ID_MAINNET.toBase58()));
  assert.equal(simulations(w).length, 0);
  assert.ok(lines.warn.some((l) => /devnet LazorKit v2/.test(l)), lines.warn.join('\n'));
});

test("a deferred pair on the mainnet program, as 'v1', reads what a 'v0' one does: TX2 is not built before the prompt", async () => {
  for (const flow of ['authorizeAndExecute', 'authorizeDeferred']) {
    const methods = {};
    for (const txVersion of ['v0', 'v1']) {
      const w = world({ cluster: 'mainnet' });
      const S = use(w, { acceptsTxV1: true });
      const { error } = await captureConsole(() => S[flow]({ instructions: [w.transfer()], transactionOptions: { txVersion } }, SIGN));
      assert.equal(error, undefined, `${flow} ${txVersion}: ${error?.message}`);
      assert.ok(w.sent().every((send) => send.version === 0));
      methods[txVersion] = w.methods();
    }
    assert.deepEqual(methods.v1, methods.v0, flow);
  }
});

test('a paymaster that refuses v1 (-32051) fails that operation once; later requests go out as v0', async () => {
  const w = world();
  w.script.send = (decoded, attempt) =>
    attempt === 0 ? { error: { code: -32051, message: 'transaction version 1 is not enabled on this paymaster' } } : undefined;
  const first = await execute(w, [w.transfer()], { txVersion: 'v1' });
  assert.equal(first.error?.name, 'PaymasterError');
  assert.equal(first.error.code, -32051);
  assert.equal(first.error.maybeSent, false);
  // One request, in v1, never retried and never resent in another format.
  assert.equal(sends(w).length, 1);
  assert.equal(w.sent()[0].version, 1);
  assert.equal(w.counter(), 41);

  const second = await execute(w, [w.transfer()], { txVersion: 'v1' });
  assert.equal(second.error, undefined);
  assert.deepEqual(w.sent().map((s) => s.version), [1, 0]);
  assert.equal(w.counter(), 42);
  assert.ok(second.lines.warn.some((l) => /refused a v1 transaction/.test(l)), second.lines.warn.join('\n'));

  // The memo is per paymaster URL: another paymaster still gets v1.
  const other = world();
  await execute(other, [other.transfer()], { txVersion: 'v1' });
  assert.equal(other.sent()[0].version, 1);
});

test("without 'v1' (omitted, or 'v0') the transaction is v0, and nothing is simulated", async () => {
  for (const txVersion of [undefined, 'v0']) {
    const w = world();
    const { error, lines } = await execute(w, [w.transfer()], txVersion ? { txVersion } : undefined);
    assert.equal(error, undefined);
    assert.equal(w.sent()[0].version, 0);
    assert.equal(simulations(w).length, 0);
    assert.equal(lines.warn.length, 0);
    assert.deepEqual(w.methods().slice(-3), ['getLatestBlockhash', 'getLatestBlockhash', 'getSignatureStatuses']);
  }
});

// ─── Sizes and ceilings, before and after the prompt (U5) ───────────────────

test('a 2.2 KB payload that v0 cannot carry goes out as v1', async () => {
  const w = world();
  const payload = [w.transfer(), w.noop(40, 900)];
  const v0 = world();
  const baseline = await execute(v0, [v0.transfer(), v0.noop(40, 900)], undefined);
  assert.ok(baseline.error, 'v0 carried it');
  assert.equal(sends(v0).length, 0);

  const { error } = await execute(w, payload, { txVersion: 'v1' });
  assert.equal(error, undefined);
  const [send] = w.sent();
  assert.equal(send.version, 1);
  assert.ok(send.bytes > 2100 && send.bytes <= 4096, `${send.bytes} bytes`);
  assert.ok(send.staticKeys.length <= 64);
});

test('over 64 addresses: TransactionTooLargeError before the portal opens, and nothing is sent', async () => {
  const w = world();
  const { error } = await execute(w, [w.noop(60, 8)], { txVersion: 'v1' });
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual(
    { stage: error.stage, format: error.format, transaction: error.transaction, addressLimit: error.addressLimit, byteLimit: error.byteLimit },
    { stage: 'before-signing', format: 'v1', transaction: 'single', addressLimit: 64, byteLimit: 4096 },
  );
  assert.ok(error.addresses > 64);
  assert.equal(error.v1Unavailable, undefined);
  assertNothingSent(w);
});

test('gate failed and too large for v0: TransactionTooLargeError (v0, with the reason) before the portal opens', async () => {
  const w = world();
  const { error } = await execute(w, [w.transfer(), w.noop(40, 900)], { txVersion: 'v1' }, null);
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual(
    { stage: error.stage, format: error.format, v1Unavailable: error.v1Unavailable, byteLimit: error.byteLimit },
    { stage: 'before-signing', format: 'v0', v1Unavailable: 'paymaster', byteLimit: 1232 },
  );
  assertNothingSent(w);
});

test('gate failed: the caller lookup tables carry v0 when they fit, and not past 64 account locks', async () => {
  const fits = world();
  const table = fits.lookupTable(32);
  const { error } = await execute(fits, [fits.transfer(), fits.noopFrom(table, 24)], { txVersion: 'v1', addressLookupTableAccounts: [table] }, null);
  assert.equal(error, undefined);
  const [send] = fits.sent();
  assert.equal(send.version, 0);
  assert.equal(send.tx.message.addressTableLookups.length, 1);

  // 60 table accounts: few bytes, but more than 64 locks once resolved.
  const locks = world();
  const big = locks.lookupTable(64, 'big');
  const refused = await execute(locks, [locks.noopFrom(big, 60)], { txVersion: 'v1', addressLookupTableAccounts: [big] }, null);
  assert.ok(refused.error instanceof M.TransactionTooLargeError, `${refused.error?.name}: ${refused.error?.message}`);
  assert.equal(refused.error.format, 'v0');
  assert.ok(refused.error.bytes !== null && refused.error.bytes <= 1232, `${refused.error.bytes} bytes`);
  assert.ok(refused.error.addresses > 64);
  assertNothingSent(locks);
});

test("gate failed: refused before the prompt only when no WebAuthn response could fit v0; between, the real bytes decide", async () => {
  // 1,100-odd bytes as v0 with the portal's response, but over 1232 with the
  // worst-case estimate: a 'v1' request is no stricter than 'v0' here.
  const sent = world();
  const table = sent.lookupTable(32);
  const payload = (w, t) => [w.transfer(), w.noopFrom(t, 24)];
  const ok = await execute(sent, payload(sent, table), { txVersion: 'v1', addressLookupTableAccounts: [table] }, null);
  assert.equal(ok.error, undefined);
  assert.equal(sent.sent()[0].version, 0);
  assert.ok(sent.sent()[0].bytes > 1100, `${sent.sent()[0].bytes} bytes`);

  // The same payload, with a portal that pads clientDataJSON past 1232 bytes:
  // refused after signing, and nothing is sent.
  const padded = world();
  const table2 = padded.lookupTable(32);
  padded.script.cdjPadding = 300;
  const { error } = await execute(padded, payload(padded, table2), { txVersion: 'v1', addressLookupTableAccounts: [table2] }, null);
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual(
    { stage: error.stage, format: error.format, v1Unavailable: error.v1Unavailable },
    { stage: 'after-signing', format: 'v0', v1Unavailable: 'paymaster' },
  );
  assert.equal(padded.rec.portal.length, 1);
  assert.equal(sends(padded).length, 0);
  assert.equal(padded.counter(), 41);
});

test('over the program ceilings: PayloadExceedsProgramLimitsError before the portal opens', async () => {
  const w = world();
  const many = Array.from({ length: 17 }, (_, i) => w.transfer(1000 + i));
  const a = await execute(w, many, { txVersion: 'v1' });
  assert.ok(a.error instanceof M.PayloadExceedsProgramLimitsError, `${a.error?.name}: ${a.error?.message}`);
  assert.equal(a.error.limit, 'inner-instructions');
  assert.equal(a.error.innerInstructions, 17);
  // The heap rule counts account metas, not addresses: the same 65 accounts twice.
  const b = await execute(w, [w.noop(65, 0, 'x'), w.noop(64, 0, 'x')], { txVersion: 'v1' });
  assert.ok(b.error instanceof M.PayloadExceedsProgramLimitsError);
  assert.deepEqual({ limit: b.error.limit, maxMetas: b.error.maxMetas, totalMetas: b.error.totalMetas }, { limit: 'heap', maxMetas: 65, totalMetas: 131 });
  // The program rejects these in any format: also when the gate sends v0.
  const c = await execute(w, many, { txVersion: 'v1' }, null);
  assert.ok(c.error instanceof M.PayloadExceedsProgramLimitsError);
  assertNothingSent(w);
  // Sixteen are fine.
  const ok = world();
  const sixteen = await execute(ok, many.slice(0, 16).map((_, i) => ok.transfer(1000 + i)), { txVersion: 'v1' });
  assert.equal(sixteen.error, undefined);
  assert.equal(ok.sent()[0].version, 1);
});

test("limits out of range throw a RangeError before the portal opens, for 'v1' only", async () => {
  const w = world();
  for (const options of [
    { computeUnitLimit: 0 },
    { computeUnitLimit: 1_400_001 },
    { computeUnitLimit: 1.5 },
    { loadedAccountsDataSizeLimit: 100_000 },
    { loadedAccountsDataSizeLimit: MAX_LAD + 1 },
  ]) {
    const { error } = await execute(w, [w.transfer()], { txVersion: 'v1', ...options });
    assert.ok(error instanceof RangeError, `${JSON.stringify(options)}: ${error?.name}: ${error?.message}`);
  }
  assertNothingSent(w);
});

test('a WebAuthn response longer than the estimate: TransactionTooLargeError after signing, and nothing is sent', async () => {
  const w = world();
  // Fits with the worst-case estimate (template + 128 bytes) ...
  const payload = [w.noop(4, 2700)];
  const control = world();
  assert.equal((await execute(control, [control.noop(4, 2700)], { txVersion: 'v1' })).error, undefined);
  assert.ok(control.sent()[0].bytes > 3500, `${control.sent()[0].bytes} bytes`);
  // ... but not with the 600 bytes this portal pads clientDataJSON with.
  w.script.cdjPadding = 600;
  const { error } = await execute(w, payload, { txVersion: 'v1' });
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual({ stage: error.stage, format: error.format }, { stage: 'after-signing', format: 'v1' });
  assert.ok(error.bytes > 4096);
  assert.match(error.message, /nothing was sent/);
  assert.equal(w.rec.portal.length, 1);
  assert.equal(sends(w).length, 0);
  assert.equal(w.counter(), 41);
});

// ─── Limits (U7) and the ComputeBudget strip (U9) ───────────────────────────

test('computeUnitLimit becomes the config; no ComputeBudget instruction is sent in v1, and v0 keeps it', async () => {
  const w = world();
  const { error } = await execute(w, [w.transfer()], { txVersion: 'v1', computeUnitLimit: 50_000 });
  assert.equal(error, undefined);
  const [send] = w.sent();
  assert.equal(send.version, 1);
  assert.ok(!programsOf(send).includes(COMPUTE_BUDGET));
  assert.equal(send.config.computeUnitLimit, 50_000);
  // The other limit is still measured.
  assert.equal(simulations(w).length, 1);
  assert.equal(send.config.loadedAccountsDataSizeLimit, 196_608);

  const v0 = world();
  await execute(v0, [v0.transfer()], { computeUnitLimit: 50_000 });
  const [plain] = v0.sent();
  assert.equal(plain.version, 0);
  assert.equal(programsOf(plain)[0], COMPUTE_BUDGET);
  assert.deepEqual([...plain.instructions[0].data], [...ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }).data]);
});

test("both limits from the caller: no simulation, and they are the config", async () => {
  const w = world();
  const { error } = await execute(w, [w.transfer()], { txVersion: 'v1', computeUnitLimit: 60_000, loadedAccountsDataSizeLimit: 262_144 });
  assert.equal(error, undefined);
  assert.equal(simulations(w).length, 0);
  assert.deepEqual(
    [w.sent()[0].config.computeUnitLimit, w.sent()[0].config.loadedAccountsDataSizeLimit],
    [60_000, 262_144],
  );
});

test('the simulation: base64, no signature check, the blockhash replaced, the draft is the size sent', async () => {
  const w = world();
  await execute(w, [w.transfer()], { txVersion: 'v1' });
  const [sim] = simulations(w);
  assert.deepEqual(sim.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  const draft = Buffer.from(sim.params[0], 'base64');
  const [send] = w.sent();
  assert.equal(draft.length, send.bytes);
  // Only the config differs: the draft asks for the maximums.
  assert.equal(draft[0], 0x81);
  const decoded = web3.VersionedTransaction.deserialize(draft);
  assert.deepEqual(
    [decoded.message.transactionConfig.computeUnitLimit, decoded.message.transactionConfig.loadedAccountsDataSizeLimit],
    [MAX_CU, MAX_LAD],
  );
});

for (const [name, simulate, why] of [
  ['the simulation failed', () => ({ result: { context: { slot: 1 }, value: { err: { InstructionError: [1, { Custom: 1 }] }, logs: [], unitsConsumed: 9_000, loadedAccountsDataSize: 161_320 } } }), /simulation failed/],
  ['an RPC error (minimum context slot not reached)', () => ({ error: { code: -32016, message: 'Minimum context slot has not been reached' } }), /Minimum context slot/],
  ['no loadedAccountsDataSize in the answer', () => ({ result: { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 13_011 } } }), /did not report/],
  ['a 429', () => new Response('Too many requests', { status: 429 }), /429/],
]) {
  test(`the maximums when ${name}; the send goes ahead`, async () => {
    const w = world();
    w.script.simulate = simulate;
    const { error, lines } = await execute(w, [w.transfer()], { txVersion: 'v1' });
    assert.equal(error, undefined);
    const [send] = w.sent();
    assert.deepEqual([send.config.computeUnitLimit, send.config.loadedAccountsDataSizeLimit], [MAX_CU, MAX_LAD]);
    assert.equal(w.counter(), 42);
    const warned = lines.warn.filter((l) => /limits were not measured/.test(l));
    assert.equal(warned.length, 1, lines.warn.join('\n'));
    assert.match(warned[0], why);
  });
}

test('a simulation that does not answer is given up after 3 s; the send goes ahead with the maximums', async () => {
  const w = world();
  w.script.simulate = () => new Promise(() => {});
  const started = Date.now();
  const { error, lines } = await execute(w, [w.transfer()], { txVersion: 'v1' });
  const took = Date.now() - started;
  assert.equal(error, undefined);
  assert.ok(took >= 2_900 && took < 6_000, `${took} ms`);
  assert.deepEqual([w.sent()[0].config.computeUnitLimit, w.sent()[0].config.loadedAccountsDataSizeLimit], [MAX_CU, MAX_LAD]);
  assert.ok(lines.warn.some((l) => /no answer within 3 s/.test(l)), lines.warn.join('\n'));
});

test("back to back on one passkey: the second simulation reads at or past the first's slot", async () => {
  const w = world();
  assert.equal((await execute(w, [w.transfer()], { txVersion: 'v1' })).error, undefined);
  const landed = w.sent()[0].slot;
  assert.equal((await execute(w, [w.transfer(2)], { txVersion: 'v1' })).error, undefined);
  const [first, second] = simulations(w);
  assert.equal(first.params[1].minContextSlot, undefined);
  assert.equal(second.params[1].minContextSlot, landed);
  assert.deepEqual(w.sent().map((s) => [s.version, s.landed]), [[1, true], [1, true]]);
  assert.equal(w.counter(), 43);
});

// ─── Session, Authorize and ExecuteDeferred (U5) ────────────────────────────

test('a session send goes out as v1, signed by the session key over the final config', async () => {
  const w = world();
  const S = use(w, { acceptsTxV1: true });
  const { error } = await captureConsole(() =>
    S.signAndSendWithSession(
      { sessionKeypair: w.sessionKey, sessionPda: w.sessionPda, instructions: [w.transfer()], transactionOptions: { txVersion: 'v1', computeUnitLimit: 40_000 } },
      {},
    ),
  );
  assert.equal(error, undefined);
  const [send] = w.sent();
  assert.equal(send.version, 1);
  assert.equal(w.rec.portal.length, 0);
  assert.equal(send.payerSlotEmpty, true);
  const sessionIndex = send.staticKeys.indexOf(w.sessionKey.publicKey.toBase58());
  assert.ok(sessionIndex > 0 && sessionIndex < send.signers);
  assert.deepEqual(send.signaturesValid, [true]);
  assert.equal(send.config.computeUnitLimit, 40_000);
  assert.ok(!programsOf(send).includes(COMPUTE_BUDGET));
});

test('a session send too large for v1 is refused before the session key signs', async () => {
  const w = world();
  const S = use(w, { acceptsTxV1: true });
  const { error } = await captureConsole(() =>
    S.signAndSendWithSession(
      { sessionKeypair: w.sessionKey, sessionPda: w.sessionPda, instructions: [w.noop(60, 8)], transactionOptions: { txVersion: 'v1' } },
      {},
    ),
  );
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual({ stage: error.stage, format: error.format }, { stage: 'before-signing', format: 'v1' });
  assert.equal(sends(w).length, 0);
  assert.equal(w.methods().includes('getLatestBlockhash'), false);
});

test('authorizeAndExecute: TX1 and TX2 both go out as v1; the limits are TX2s', async () => {
  const w = world();
  const S = use(w, { acceptsTxV1: true });
  const { error } = await captureConsole(() =>
    S.authorizeAndExecute({ instructions: [w.transfer(), w.noop(30, 600)], transactionOptions: { txVersion: 'v1', computeUnitLimit: 90_000 } }, SIGN),
  );
  assert.equal(error, undefined);
  const [tx1, tx2] = w.sent();
  assert.deepEqual([tx1.version, tx2.version], [1, 1]);
  assert.deepEqual(programsOf(tx1), [SECP256R1, LAZORKIT]);
  assert.equal(tx1.instructions[1].data[0], sdk.DISC_AUTHORIZE);
  assert.deepEqual(programsOf(tx2), [LAZORKIT]);
  assert.equal(tx2.instructions[0].data[0], sdk.DISC_EXECUTE_DEFERRED);
  assert.equal(tx1.config.computeUnitLimit, 20_614);
  assert.equal(tx2.config.computeUnitLimit, 90_000);
  assert.ok(tx2.bytes > 1232, `${tx2.bytes} bytes`);
  // TX2's limits are simulated on a node that has TX1.
  const [sim1, sim2] = simulations(w);
  assert.equal(sim1.params[1].minContextSlot, undefined);
  assert.equal(sim2.params[1].minContextSlot, tx1.slot);
  assert.equal(w.counter(), 42);
  assert.equal(w.rec.portal.length, 1);
});

test("authorizeAndExecute: TX2 keeps the RegisterPayer it needs after TX2 was measured before the prompt", async () => {
  const w = world({ noFeeRecord: true });
  const S = use(w, { acceptsTxV1: true });
  const { error } = await captureConsole(() => S.authorizeAndExecute({ instructions: [w.transfer()], transactionOptions: { txVersion: 'v1' } }, SIGN));
  assert.equal(error, undefined);
  const [tx1, tx2] = w.sent();
  assert.deepEqual([tx1.version, tx2.version], [1, 1]);
  assert.deepEqual(tx2.instructions.map((ix) => ix.data[0]), [sdk.DISC_REGISTER_PAYER, sdk.DISC_EXECUTE_DEFERRED]);
  assert.ok(w.ledger.accounts.has(w.feeRecordPda.toBase58()));
});

test('authorizeAndExecute: a TX2 too large is refused before the portal opens, and TX1 is never sent', async () => {
  const w = world();
  const S = use(w, { acceptsTxV1: true });
  const { error } = await captureConsole(() => S.authorizeAndExecute({ instructions: [w.noop(8, 3900)], transactionOptions: { txVersion: 'v1' } }, SIGN));
  assert.ok(error instanceof M.TransactionTooLargeError, `${error?.name}: ${error?.message}`);
  assert.deepEqual(
    { stage: error.stage, format: error.format, transaction: error.transaction },
    { stage: 'before-signing', format: 'v1', transaction: 'tx2' },
  );
  assertNothingSent(w);
});

test("authorizeAndExecute with the gate failed: both v0, TX2 with the caller's lookup tables", async () => {
  const w = world();
  const table = w.lookupTable(32);
  const S = use(w, { acceptsTxV1: undefined });
  const { error } = await captureConsole(() =>
    S.authorizeAndExecute({ instructions: [w.transfer(), w.noopFrom(table, 24)], transactionOptions: { txVersion: 'v1', addressLookupTableAccounts: [table] } }, SIGN),
  );
  assert.equal(error, undefined);
  const [tx1, tx2] = w.sent();
  assert.deepEqual([tx1.version, tx2.version], [0, 0]);
  assert.equal(tx1.tx.message.addressTableLookups.length, 0);
  assert.equal(tx2.tx.message.addressTableLookups.length, 1);
});

test('authorizeDeferred, then executeDeferred: both v1', async () => {
  const w = world();
  const S = use(w, { acceptsTxV1: true });
  const authorized = await captureConsole(() => S.authorizeDeferred({ instructions: [w.transfer()], transactionOptions: { txVersion: 'v1' } }, SIGN));
  assert.equal(authorized.error, undefined);
  const executed = await captureConsole(() =>
    use(w, { acceptsTxV1: true }).executeDeferred({ deferredPayload: authorized.value.deferredPayload, transactionOptions: { txVersion: 'v1' } }),
  );
  assert.equal(executed.error, undefined);
  const [tx1, tx2] = w.sent();
  assert.deepEqual([tx1.version, tx2.version], [1, 1]);
  assert.equal(tx2.instructions[0].data[0], sdk.DISC_EXECUTE_DEFERRED);
  assert.equal(w.ledger.accounts.has(authorized.value.deferredExecPda.toBase58()), false);
});

// ─── The preview, the program ceilings, the limits of a v0 fallback ──────────

/**
 * The preview the portal was opened with (its `transaction` parameter): a v0
 * transaction with no lookup into a table, so that every program and account
 * of `instructions` is in its message.
 */
function assertPreviewShowsEveryAccount(portalParams, instructions) {
  const bytes = Buffer.from(portalParams.transaction, 'base64');
  const preview = web3.VersionedTransaction.deserialize(bytes);
  assert.equal(preview.version, 0);
  assert.deepEqual(preview.message.addressTableLookups, [], 'no account hidden in a lookup table');
  const shown = new Set(preview.message.staticAccountKeys.map((k) => k.toBase58()));
  for (const ix of instructions) {
    for (const address of [ix.programId, ...ix.keys.map((k) => k.pubkey)]) {
      assert.ok(shown.has(address.toBase58()), `${address.toBase58()} is in the preview`);
    }
  }
  return bytes;
}

test("when v1 is used, the portal previews every account: the caller's lookup tables, which v1 does not use, are left out", async () => {
  // 40 table accounts: over 1232 bytes as a preview without the table. With
  // it, the preview would show table indexes the portal resolves on chain,
  // while the v1 transactions carry the caller's own addresses.
  const payload = (w, table) => [w.transfer(), w.noopFrom(table, 40, 8)];
  const w = world();
  const table = w.lookupTable(48);
  const sent = payload(w, table);
  const { error } = await execute(w, sent, { txVersion: 'v1', addressLookupTableAccounts: [table] });
  assert.equal(error, undefined);
  assert.equal(w.sent()[0].version, 1);
  const bytes = assertPreviewShowsEveryAccount(w.rec.portal[0], sent);
  assert.ok(bytes.length > 1232, `${bytes.length} bytes`);

  // Forged tables: the caller's table at the chain's table address, with other accounts. The
  // portal resolves a preview's lookups on chain, so a preview compiled with it would pay the
  // chain's entry while the v1 transaction pays the caller's. The preview names the signed recipient.
  {
    const f = world();
    const real = f.lookupTable(48, 'real');
    const forged = new web3.AddressLookupTableAccount({
      key: real.key,
      state: { ...real.state, addresses: Array.from({ length: 48 }, (_, i) => Keypair.fromSeed(Buffer.alloc(32, 100 + i)).publicKey) },
    });
    const recipient = forged.state.addresses[47];
    const instructions = [
      web3.SystemProgram.transfer({ fromPubkey: f.vaultPda, toPubkey: recipient, lamports: 1_000_000 }),
      f.noopFrom(forged, 40, 8),
    ];
    const r = await execute(f, instructions, { txVersion: 'v1', addressLookupTableAccounts: [forged] });
    assert.equal(r.error, undefined, r.error?.message);
    assert.equal(f.sent()[0].version, 1);
    assertPreviewShowsEveryAccount(f.rec.portal[0], instructions);
    const { message } = web3.VersionedTransaction.deserialize(Buffer.from(f.rec.portal[0].transaction, 'base64'));
    const [transfer] = message.compiledInstructions;
    assert.equal(message.staticAccountKeys[transfer.accountKeyIndexes[1]].toBase58(), recipient.toBase58(), 'the preview pays whom the v1 transaction pays');
  }

  // The deferred pair previews the same instructions.
  for (const flow of ['authorizeAndExecute', 'authorizeDeferred']) {
    const d = world();
    const t = d.lookupTable(48);
    const instructions = payload(d, t);
    const S = use(d, { acceptsTxV1: true });
    const r = await captureConsole(() => S[flow]({ instructions, transactionOptions: { txVersion: 'v1', addressLookupTableAccounts: [t] } }, SIGN));
    assert.equal(r.error, undefined, `${flow}: ${r.error?.message}`);
    assert.equal(d.sent()[0].version, 1);
    assertPreviewShowsEveryAccount(d.rec.portal[0], instructions);
  }

  // A request that goes out as v0 is sent with the table and previewed with it, as a 'v0' request is.
  for (const options of [{ txVersion: 'v1' }, { txVersion: 'v0' }, {}]) {
    const g = world();
    const t = g.lookupTable(48);
    const r = await execute(g, payload(g, t), { ...options, addressLookupTableAccounts: [t] }, null);
    assert.equal(r.error, undefined);
    assert.equal(g.sent()[0].version, 0);
    assert.equal(g.sent()[0].tx.message.addressTableLookups.length, 1);
    const preview = web3.VersionedTransaction.deserialize(Buffer.from(g.rec.portal[0].transaction, 'base64'));
    assert.equal(preview.message.addressTableLookups.length, 1, JSON.stringify(options));
  }
});

/** A Noop instruction with `metas` account metas over 4 accounts (repeated), 8 bytes of data. */
const repeated = (metas) =>
  new TransactionInstruction({
    programId: NOOP,
    keys: Array.from({ length: metas }, (_, i) => ({ pubkey: new PublicKey(Buffer.alloc(32, 1 + (i % 4))), isSigner: false, isWritable: false })),
    data: Buffer.alloc(8, 7),
  });
const sixteenBySixteen = () => Array.from({ length: 16 }, () => repeated(16));

test("the program's heap: what the instruction that runs the payload allocates decides, before the portal opens", async () => {
  // A passkey Execute of 16 x 16: none wider than 64, yet out of memory on the deployed program.
  const w = world();
  const a = await execute(w, sixteenBySixteen(), { txVersion: 'v1' });
  assert.ok(a.error instanceof M.PayloadExceedsProgramLimitsError, `${a.error?.name}: ${a.error?.message}`);
  assert.equal(a.error.limit, 'heap');
  assert.ok(a.error.heapBytes > 32_760, String(a.error.heapBytes));
  // The deferred pair: TX2 (ExecuteDeferred) would run out, so TX1 is never sent.
  for (const flow of ['authorizeAndExecute', 'authorizeDeferred']) {
    const S = use(w, { acceptsTxV1: true });
    const b = await captureConsole(() => S[flow]({ instructions: sixteenBySixteen(), transactionOptions: { txVersion: 'v1' } }, SIGN));
    assert.ok(b.error instanceof M.PayloadExceedsProgramLimitsError, `${flow}: ${b.error?.name}: ${b.error?.message}`);
    assert.equal(b.error.limit, 'heap');
  }
  assertNothingSent(w);

  // A session's Execute allocates less (no accounts hash): it runs 16 x 16
  // and one instruction of 128, and not one of 129.
  for (const [instructions, runs] of [
    [sixteenBySixteen(), true],
    [[repeated(128)], true],
    [[repeated(129)], false],
  ]) {
    const s = world();
    const S = use(s, { acceptsTxV1: true });
    const r = await captureConsole(() =>
      S.signAndSendWithSession({ sessionKeypair: s.sessionKey, sessionPda: s.sessionPda, instructions, transactionOptions: { txVersion: 'v1' } }, {}),
    );
    if (runs) {
      assert.equal(r.error, undefined, r.error?.message);
      assert.equal(s.sent()[0].version, 1);
    } else {
      assert.ok(r.error instanceof M.PayloadExceedsProgramLimitsError, `${r.error?.name}: ${r.error?.message}`);
      assert.equal(r.error.limit, 'heap');
      assert.equal(sends(s).length, 0);
    }
  }
});

test("a 'v1' request that goes out as v0 does not check the v1 limits, nor the devnet program's ceilings off devnet", async () => {
  for (const [why, make, accepts] of [
    ['paymaster', () => world(), null],
    ['not-devnet-v2', () => world({ cluster: 'mainnet' }), true],
  ]) {
    for (const limits of [{ computeUnitLimit: 2_000_000 }, { loadedAccountsDataSizeLimit: 100_000 }]) {
      const w = make();
      const { error } = await execute(w, [w.transfer()], { txVersion: 'v1', ...limits }, accepts);
      assert.equal(error, undefined, `${why} ${JSON.stringify(limits)}: ${error?.name}: ${error?.message}`);
      assert.equal(w.sent()[0].version, 0);
    }
  }
  // Another LazorKit program decides what it can run, as for a 'v0' request.
  const m = world({ cluster: 'mainnet' });
  const r = await execute(m, [repeated(128)], { txVersion: 'v1' });
  assert.equal(r.error, undefined, `${r.error?.name}: ${r.error?.message}`);
  assert.equal(m.sent()[0].version, 0);
});

test("acceptsTxV1 is this run's: last run's storage, read after the app set its config, does not turn v1 back on", async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  for (const thisRun of [undefined, false, true]) {
    const w = world();
    // This run's config, as the provider sets it on mount.
    use(w, { acceptsTxV1: thisRun });
    // Storage then answers with last run's: the same paymaster, declared v1-capable,
    // and a v1 paymaster declared so too.
    const stored = JSON.parse(await AsyncStorage.getItem('lazor-wallet-store'));
    stored.state.config.configPaymaster = { ...stored.state.config.configPaymaster, acceptsTxV1: true };
    stored.state.config.v1ConfigPaymaster = { paymasterUrl: 'http://v1-paymaster.test/', acceptsTxV1: true };
    await AsyncStorage.setItem('lazor-wallet-store', JSON.stringify(stored));
    await M.useWalletStore.persist.rehydrate();
    const { config } = M.useWalletStore.getState();
    assert.equal(config.configPaymaster.acceptsTxV1, thisRun, `this run: ${thisRun}`);
    assert.equal(config.v1ConfigPaymaster?.acceptsTxV1, undefined);
    const { error } = await captureConsole(() =>
      M.useWalletStore.getState().signAndExecuteTransaction({ instructions: [w.transfer()], transactionOptions: { txVersion: 'v1' } }, SIGN),
    );
    assert.equal(error, undefined, error?.message);
    assert.equal(w.sent()[0].version, thisRun === true ? 1 : 0, `this run: ${thisRun}`);
  }
  // A paymaster other than this run's does not take this run's declaration.
  const o = world();
  use(o, { acceptsTxV1: true });
  const stored = JSON.parse(await AsyncStorage.getItem('lazor-wallet-store'));
  stored.state.config.configPaymaster = { paymasterUrl: 'http://another-paymaster.test/' };
  await AsyncStorage.setItem('lazor-wallet-store', JSON.stringify(stored));
  await M.useWalletStore.persist.rehydrate();
  assert.deepEqual(M.useWalletStore.getState().config.configPaymaster, { paymasterUrl: 'http://another-paymaster.test/' });
});

// ─── Logs of a landed v1 transaction (U10) ──────────────────────────────────

const lazorkitFirst = [
  `Program ${LAZORKIT} invoke [1]`,
  `Program ${LAZORKIT} consumed 9000 of 20614 compute units`,
  `Program ${LAZORKIT} failed: custom program error: 0xbbe`,
];
const innerFirst = [
  `Program ${LAZORKIT} invoke [1]`,
  `Program ${NOOP.toBase58()} invoke [2]`,
  `Program ${NOOP.toBase58()} failed: custom program error: 0xbbe`,
  `Program ${LAZORKIT} failed: custom program error: 0xbbe`,
];
const landed3006 = { InstructionError: [1, { Custom: 3006 }] };
/** The recorded devnet response of a v1 transaction, as one that failed with `logs`. */
const recordedWith = (logs) => ({
  result: { ...RECORDED, meta: { ...RECORDED.meta, err: landed3006, status: { Err: landed3006 }, logMessages: logs } },
});

for (const [who, logs, expected] of [
  ['LazorKit', lazorkitFirst, 'SignatureReusedError'],
  ['an inner program', innerFirst, 'TransactionFailedError'],
]) {
  test(`a landed v1 3006 whose logs name ${who} first is reported as ${expected}, from a raw v1 getTransaction`, async () => {
    const w = world();
    w.script.send = () => ({ land: landed3006 });
    w.script.getTransaction = () => recordedWith(logs);
    const { error } = await execute(w, [w.transfer()], { txVersion: 'v1' });
    assert.equal(error?.name, expected, `${error?.name}: ${error?.message}`);
    const reads = w.rec.rpc.filter((r) => r.method === 'getTransaction');
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].params, [w.sent()[0].signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
    if (expected === 'TransactionFailedError') assert.deepEqual(error.logs, logs);
  });
}

test('a landed v0 3006 still reads its logs with maxSupportedTransactionVersion 0', async () => {
  const w = world();
  w.script.send = () => ({ land: landed3006 });
  const { error } = await execute(w, [w.transfer()], undefined);
  assert.equal(error?.name, 'SignatureReusedError');
  const reads = w.rec.rpc.filter((r) => r.method === 'getTransaction');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].params[1].maxSupportedTransactionVersion, 0);
  assert.notEqual(reads[0].params[1].encoding, 'base64');
});

test("a paymaster's 3006 without logs is told apart by simulating the v1 bytes raw", async () => {
  for (const [logs, expected] of [
    [innerFirst, 'PaymasterError'],
    [lazorkitFirst, 'SignatureReusedError'],
  ]) {
    const w = world();
    w.script.send = () => ({ error: { code: -32602, message: 'Invalid transaction: Transaction simulation failed: InstructionError(1, Custom(3006))' } });
    let calls = 0;
    w.script.simulate = () =>
      calls++ === 0 ? undefined : { result: { context: { slot: 1 }, value: { err: landed3006, logs, unitsConsumed: 9_000 } } };
    const { error } = await execute(w, [w.transfer()], { txVersion: 'v1' });
    assert.equal(error?.name, expected, `${error?.name}: ${error?.message}`);
    const [, logsRead] = simulations(w);
    assert.equal(logsRead.params[0], JSON.parse(sends(w)[0].body).params.transaction);
    assert.deepEqual(logsRead.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    if (expected === 'PaymasterError') assert.deepEqual(error.logs, logs);
  }
});

// ─── The gate and the strip, on the source ──────────────────────────────────

/**
 * src/core/wallet/txv1-send.ts, transpiled, with `../paymaster`, `../logger`
 * and `./sequence` stubbed; `./txv1` is the real writer.
 */
function loadSend() {
  const warnings = [];
  const paymaster = { calls: [], answer: async () => '5'.repeat(88) };
  class PaymasterError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'PaymasterError';
      this.code = details.code;
      this.maybeSent = false;
    }
  }
  const stubs = {
    '../../program': sdk,
    '../logger': { logger: { log() {}, info() {}, warn: (message) => warnings.push(message), error() {} } },
    '../paymaster': {
      PaymasterError,
      signAndExecuteTransaction: (...args) => {
        paymaster.calls.push(args);
        return paymaster.answer(...args);
      },
    },
    './sequence': { sendAndConfirm: async (params) => params.send() },
  };
  const cache = new Map();
  const loadTs = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    cache.set(file, module);
    const nodeRequire = Module.createRequire(file);
    const local = (spec) => {
      if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
      if (spec.startsWith('.')) return loadTs(`${path.resolve(path.dirname(file), spec)}.ts`);
      return nodeRequire(spec);
    };
    new Function('require', 'module', 'exports', code)(local, module, module.exports);
    return module.exports;
  };
  const send = loadTs(path.join(__dirname, '..', 'src', 'core', 'wallet', 'txv1-send.ts'));
  return { send, warnings, paymaster, PaymasterError };
}

const lazorkitIx = (programId = sdk.PROGRAM_ID_DEVNET) =>
  new TransactionInstruction({ programId, keys: [{ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }], data: Buffer.from([4, 1, 2, 3]) });
const loadedDataLimitIx = (bytes) => {
  const data = Buffer.alloc(5);
  data[0] = 4;
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET), keys: [], data });
};

test('the gate: the first rule that fails is the reason', () => {
  const { send } = loadSend();
  const url = 'http://gate.test/';
  const devnet = [lazorkitIx()];
  const gate = (paymaster, instructions = devnet, feeToken) => send.gateTxV1({ paymaster: { paymasterUrl: url, ...paymaster }, instructions, feeToken });
  assert.deepEqual(gate({}), { v1: false, reason: 'paymaster' });
  assert.deepEqual(gate({ acceptsTxV1: false }), { v1: false, reason: 'paymaster' });
  assert.deepEqual(gate({ acceptsTxV1: 'true' }), { v1: false, reason: 'paymaster' });
  assert.deepEqual(gate({}, devnet, 'mint'), { v1: false, reason: 'paymaster' });
  assert.deepEqual(gate({ acceptsTxV1: true }, devnet, 'mint'), { v1: false, reason: 'fee-token' });
  assert.deepEqual(gate({ acceptsTxV1: true }, [new TransactionInstruction({ programId: NOOP, keys: [], data: Buffer.alloc(0) })]), {
    v1: false,
    reason: 'not-devnet-v2',
  });
  for (const other of [sdk.PROGRAM_ID_MAINNET, sdk.PROGRAM_ID_MAINNET_V1, sdk.PROGRAM_ID_DEVNET_V1]) {
    assert.deepEqual(gate({ acceptsTxV1: true }, [lazorkitIx(other)]), { v1: false, reason: 'not-devnet-v2' });
    assert.deepEqual(gate({ acceptsTxV1: true }, [lazorkitIx(), lazorkitIx(other)]), { v1: false, reason: 'not-devnet-v2' });
  }
  assert.deepEqual(gate({ acceptsTxV1: true }), { v1: true });
});

test('the gate: a -32051 is remembered for that paymaster URL only, and comes before the fee token', async () => {
  const { send, paymaster, PaymasterError } = loadSend();
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
    _rpcRequest: async () => ({ result: { value: { err: null, unitsConsumed: 1, loadedAccountsDataSize: 1 } } }),
  };
  paymaster.answer = async () => {
    throw new PaymasterError('refused', { code: -32051 });
  };
  const params = { instructions: [lazorkitIx()], connection, feePayer: Keypair.generate().publicKey, paymaster: { paymasterUrl: 'http://a.test/', acceptsTxV1: true } };
  await assert.rejects(send.sendViaPaymasterTxV1(params, async () => assert.fail('sent as v0')), { code: -32051 });
  assert.equal(paymaster.calls.length, 1);
  assert.deepEqual(send.gateTxV1({ paymaster: params.paymaster, instructions: params.instructions, feeToken: 'mint' }), { v1: false, reason: 'refused' });
  assert.deepEqual(send.gateTxV1({ paymaster: { ...params.paymaster, paymasterUrl: 'http://b.test/' }, instructions: params.instructions }), { v1: true });
  // A refusal with another code is not remembered.
  paymaster.answer = async () => {
    throw new PaymasterError('other', { code: -32002 });
  };
  const c = { ...params, paymaster: { paymasterUrl: 'http://c.test/', acceptsTxV1: true } };
  await assert.rejects(send.sendViaPaymasterTxV1(c, async () => assert.fail('sent as v0')), { code: -32002 });
  assert.deepEqual(send.gateTxV1({ paymaster: c.paymaster, instructions: c.instructions }), { v1: true });
});

test('the strip: SetComputeUnitLimit and SetLoadedAccountsDataSizeLimit become limits, the others are dropped', () => {
  const { send } = loadSend();
  const keep = [lazorkitIx(), lazorkitIx()];
  const strip = send.stripComputeBudget([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    keep[0],
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    loadedDataLimitIx(300_000),
    ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
    keep[1],
    new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET), keys: [], data: Buffer.from([2, 1]) }),
  ]);
  assert.deepEqual(strip.instructions, keep);
  assert.equal(strip.computeUnitLimit, 50_000);
  assert.equal(strip.loadedAccountsDataSizeLimit, 300_000);
  assert.deepEqual(strip.dropped, ['SetComputeUnitPrice', 'RequestHeapFrame', 'a malformed SetComputeUnitLimit']);
  assert.deepEqual(send.stripComputeBudget(keep), { instructions: keep, computeUnitLimit: undefined, loadedAccountsDataSizeLimit: undefined, dropped: [] });
});

test("the strip: the caller's limits win over the stripped ones, and what was dropped is warned about", async () => {
  const { send, warnings, paymaster } = loadSend();
  const sent = [];
  paymaster.answer = async (base64) => {
    sent.push(web3.VersionedTransaction.deserialize(Buffer.from(base64, 'base64')));
    return '5'.repeat(88);
  };
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
    _rpcRequest: async () => ({ result: { value: { err: null, unitsConsumed: 100_000, loadedAccountsDataSize: 500_000 } } }),
  };
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5 }),
    lazorkitIx(),
  ];
  const base = { instructions, connection, feePayer: Keypair.generate().publicKey, paymaster: { paymasterUrl: 'http://strip.test/', acceptsTxV1: true } };
  await send.sendViaPaymasterTxV1({ ...base, v1: { computeUnitLimit: 70_000 } }, async () => assert.fail('sent as v0'));
  await send.sendViaPaymasterTxV1(base, async () => assert.fail('sent as v0'));
  const configs = sent.map((tx) => [tx.message.transactionConfig.computeUnitLimit, tx.message.transactionConfig.loadedAccountsDataSizeLimit]);
  // 500,000 loaded bytes -> 557,056 (x1.1, in 32 KiB pages).
  assert.deepEqual(configs, [
    [70_000, 557_056],
    [50_000, 557_056],
  ]);
  for (const tx of sent) assert.equal(tx.message.compiledInstructions.length, 1);
  assert.equal(warnings.filter((w) => /SetComputeUnitPrice was left out/.test(w)).length, 2);
});
