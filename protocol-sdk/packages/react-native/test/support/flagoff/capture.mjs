#!/usr/bin/env node
/**
 * Record the Protocol-only flag-off golden from a reviewed local build.
 * Run from packages/react-native; recording is separate from the test command.
 *
 *   node test/support/flagoff/capture.mjs dist/index.js --from "<baseline revision>"
 *
 * `--full <file>` writes uncompacted records for reviewing differences.
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
const out = resolve(opt('--out') ?? join(HERE, '..', '..', 'fixtures', 'flagoff.mobile.json'));
const from = opt('--from') ?? dist;

const cases = caseMatrix();
const records = await pool(cases, 6, async (kase) => {
  const record = await runCase(dist, kase);
  if (record.diagnostics.unexpectedRequests.length) throw new Error(`${kase.id}: unexpected requests`);
  if (record.diagnostics.portalErrors.length) throw new Error(`${kase.id}: ${record.diagnostics.portalErrors.join('; ')}`);
  process.stderr.write(`${kase.id}: ${record.steps.map((s) => (s.ok ? 'ok' : `ERR ${s.error?.name}`)).join(' + ')}\n`);
  return record;
});
const header = {
  about:
    'Flag-off golden for test/flagoff.test.mjs (txv1 design U4): per case, the calls and their outcomes, ' +
    'the paymaster requests, the JSON-RPC requests in order and the portal pages opened, as test/support/flagoff/flagoff.mjs compacts them.',
  recordedFrom: from,
  distSha256: createHash('sha256').update(readFileSync(dist)).digest('hex'),
  corpusVersion: CORPUS_VERSION,
};
// One line per case, so a change to a case is a one-line diff.
const lines = cases.map((kase, i) => `  ${JSON.stringify(kase.id)}: ${JSON.stringify(compact(records[i]))}`);
writeFileSync(out, `${JSON.stringify(header, null, 1).slice(0, -2)},\n "cases": {\n${lines.join(',\n')}\n }\n}\n`);
if (opt('--full')) writeFileSync(resolve(opt('--full')), JSON.stringify(Object.fromEntries(cases.map((k, i) => [k.id, records[i]])), null, 1));
process.stderr.write(`wrote ${out} (${cases.length} cases)\n`);
