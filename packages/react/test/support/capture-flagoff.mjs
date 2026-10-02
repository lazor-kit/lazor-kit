#!/usr/bin/env node
/**
 * Records the flag-off golden (test/fixtures/flagoff.web.json) from a
 * published build of this package. Not run by the tests; run it again only to
 * move the golden to a new published release.
 *
 *   npm pack @lazorkit/wallet@3.3.0 && tar xzf lazorkit-wallet-3.3.0.tgz
 *   mkdir -p node_modules/.cache/flagoff && cp package/dist/index.mjs node_modules/.cache/flagoff/
 *   node test/support/capture-flagoff.mjs node_modules/.cache/flagoff/index.mjs --from "<what it is>"
 *
 * (Run from packages/react. The copy must sit under this package, so its
 * imports resolve to this workspace's dependencies, as the build under test
 * does.) `--full <file>` also writes the uncompacted records, to see what a
 * difference is.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_VERSION, caseMatrix } from './corpus.mjs';
import { compact, pool, runCase } from './flagoff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dist = resolve(args[0]);
const out = resolve(opt('--out') ?? join(HERE, '..', 'fixtures', 'flagoff.web.json'));
const from = opt('--from') ?? dist;

const cases = caseMatrix();
const records = await pool(cases, 6, async (kase) => {
  const record = await runCase(dist, kase);
  if (record.diagnostics.unexpectedRequests.length) throw new Error(`${kase.id}: unexpected requests`);
  process.stderr.write(`${kase.id}: ${record.steps.map((s) => (s.ok ? 'ok' : `ERR ${s.error?.name}`)).join(' + ')}\n`);
  return record;
});
const header = {
  about:
    'Flag-off golden for test/flagoff.test.mjs (txv1 design U4): per case, the calls and their outcomes, ' +
    'the paymaster requests, the JSON-RPC requests in order and the portal pages opened, as test/support/flagoff.mjs compacts them.',
  recordedFrom: from,
  distSha256: createHash('sha256').update(readFileSync(dist)).digest('hex'),
  corpusVersion: CORPUS_VERSION,
};
// One line per case, so a change to a case is a one-line diff.
const lines = cases.map((kase, i) => `  ${JSON.stringify(kase.id)}: ${JSON.stringify(compact(records[i]))}`);
writeFileSync(out, `${JSON.stringify(header, null, 1).slice(0, -2)},\n "cases": {\n${lines.join(',\n')}\n }\n}\n`);
if (opt('--full')) writeFileSync(resolve(opt('--full')), JSON.stringify(Object.fromEntries(cases.map((k, i) => [k.id, records[i]])), null, 1));
process.stderr.write(`wrote ${out} (${cases.length} cases)\n`);
