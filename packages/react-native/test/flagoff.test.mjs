// U4 of the txv1 design: with no 'v1' request (txVersion omitted or 'v0'),
// every send flow makes exactly the requests the published 2.2.1 made, in the
// same order, with the same bytes, and ends the same way.
//
// Each case of the corpus matrix (test/support/flagoff/corpus.mjs) runs
// through the built package (`pnpm build` first) in a fresh process, with the
// native modules stubbed, against the mock cluster, and is compared with
// test/fixtures/flagoff.mobile.json, recorded from 2.2.1's own dist/index.js
// (test/support/flagoff/capture.mjs): the paymaster request bodies byte for
// byte (SHA-256), every JSON-RPC request with its params, the portal pages
// opened, and each call's outcome. The cases cover execute, transferSol,
// session, the deferred pair and authorizeDeferred + executeDeferred, with
// and without lookup tables, computeUnitLimit and feeToken, a payload over
// 1232 bytes, RegisterPayer, two sends in a row, and the paymaster and chain
// faults whose handling the v1 change touches (refusals, a 502, 3006 before
// and after landing, already processed).
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

test('U4: with no v1 request, every flow makes the requests 2.2.1 made, and ends as it did', async (t) => {
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
