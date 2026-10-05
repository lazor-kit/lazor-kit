// U4 of the txv1 design: with no 'v1' request (txVersion omitted, 'v0' or
// 'legacy'), every send flow makes exactly the requests 3.4.1 makes, in the
// same order, with the same bytes, and ends the same way.
//
// Each case of the corpus matrix (test/support/corpus.mjs) runs through the
// built package (`pnpm build` first) in a fresh process, against the mock
// cluster, and is compared with test/fixtures/flagoff.web.json, recorded
// from 3.4.1's own dist/index.mjs (test/support/capture-flagoff.mjs); every
// case is as 3.4.0, 3.3.1 and 3.3.0 recorded it. It was 3.2.1's until this branch took main at
// 3.3.0: the two differ only in the 8 session cases, which since 3.3.0 first
// read the slot (getSlot) to delete an expired session's kept key before it
// signs. The golden compares:
// the paymaster request bodies byte for byte (SHA-256), every JSON-RPC
// request with its params, the portal pages opened, and each call's outcome.
// The cases cover execute, session, authority, the deferred pair and
// authorizeDeferred + executeDeferred, with and without lookup tables, a
// payload over 1232 bytes, RegisterPayer, two sends in a row, and the
// paymaster and chain faults whose handling the txv1 change touches
// (retries, 502, 3006 before and after landing, already processed).
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

test('U4: with no v1 request, every flow makes the requests 3.4.1 makes, and ends as it does', async (t) => {
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
