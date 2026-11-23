// Compare each v0 or legacy request with the Protocol-only baseline.
// The golden commits to paymaster bytes, RPC methods and parameters, portal
// requests, and outcomes, including retries and errors. Each case runs in a
// fresh process against deterministic fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_VERSION, caseMatrix } from './support/flagoff/corpus.mjs';
import { compact, pool, runCase } from './support/flagoff/flagoff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist', 'index.js');
const golden = JSON.parse(readFileSync(join(HERE, 'fixtures', 'flagoff.mobile.json'), 'utf8'));

test('U4: with no v1 request, every flow matches its Protocol wire baseline', async (t) => {
  assert.equal(golden.corpusVersion, CORPUS_VERSION);
  const cases = caseMatrix();
  assert.deepEqual(cases.map((c) => c.id).sort(), Object.keys(golden.cases).sort(), 'the case matrix is the golden one');
  const records = await pool(cases, 6, (kase) => runCase(DIST, kase));
  for (const [i, kase] of cases.entries()) {
    await t.test(kase.id, () => {
      const record = records[i];
      assert.deepEqual(record.diagnostics.unexpectedRequests, [], 'no request left the process');
      assert.deepEqual(record.diagnostics.portalErrors, []);
      const got = compact(record);
      const want = golden.cases[kase.id];
      for (const section of ['steps', 'paymaster', 'rpc', 'portal']) {
        assert.deepEqual(got[section], want[section], `${kase.id}: ${section}`);
      }
    });
  }
});

test("D1: a 'v1' request to a paymaster without acceptsTxV1 makes exactly the 'v0' requests, and ends as 'v0' does", async (t) => {
  // The same cases as a 'v0' request, with txVersion 'v1': the gate fails
  // (reason 'paymaster') before anything is read, and the request goes out as
  // v0. The deferred path also uses its normal v0 requests. Left out: the
  // payloads no v0 form can carry, which a 'v1' request refuses before the
  // prompt (txv1-send.test.cjs), where 'v0' fails after it.
  const cases = caseMatrix()
    .filter((kase) => kase.variant === 'v0' && !kase.fault && !kase.payload.startsWith('payload2k2'))
    .map((kase) => ({ ...kase, id: kase.id.replace(/\/v0$/, '/v1-without-acceptsTxV1'), options: { txVersion: 'v1' }, golden: kase.id }));
  assert.ok(cases.some((kase) => kase.flow === 'authorizeAndExecute') && cases.some((kase) => kase.flow === 'deferred'));
  const records = await pool(cases, 6, (kase) => runCase(DIST, kase));
  for (const [i, kase] of cases.entries()) {
    await t.test(kase.id, () => {
      const record = records[i];
      assert.deepEqual(record.diagnostics.unexpectedRequests, [], 'no request left the process');
      const got = compact(record);
      const want = golden.cases[kase.golden];
      for (const section of ['steps', 'paymaster', 'rpc', 'portal']) {
        assert.deepEqual(got[section], want[section], `${kase.id}: ${section}`);
      }
    });
  }
});
