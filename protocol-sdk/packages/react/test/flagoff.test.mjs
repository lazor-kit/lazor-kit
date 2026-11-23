// Compare each v0 or legacy request with the Protocol-only baseline.
// The golden commits to paymaster bytes, RPC methods and parameters, portal
// requests, and outcomes, including retries and errors. Each case runs in a
// fresh process against deterministic fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_VERSION, caseMatrix } from './support/corpus.mjs';
import { compact, pool, runCase } from './support/flagoff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist', 'index.mjs');
const golden = JSON.parse(readFileSync(join(HERE, 'fixtures', 'flagoff.web.json'), 'utf8'));

test('U4: with no v1 request, every flow matches its Protocol wire baseline', async (t) => {
  assert.equal(golden.corpusVersion, CORPUS_VERSION);
  const cases = caseMatrix();
  assert.deepEqual(cases.map((c) => c.id).sort(), Object.keys(golden.cases).sort(), 'the case matrix is the golden one');
  const records = await pool(cases, 6, (kase) => runCase(DIST, kase));
  for (const [i, kase] of cases.entries()) {
    await t.test(kase.id, () => {
      const record = records[i];
      assert.deepEqual(record.diagnostics.unexpectedRequests, [], 'no request left the process');
      const got = compact(record);
      const want = golden.cases[kase.id];
      for (const section of ['steps', 'paymaster', 'rpc', 'portal']) {
        assert.deepEqual(got[section], want[section], `${kase.id}: ${section}`);
      }
    });
  }
});
