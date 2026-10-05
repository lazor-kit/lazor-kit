#!/usr/bin/env node
// Regenerates test-vectors/txv1.json, the golden vectors of the wallets' v1
// writer, and checks every vector against @solana/kit 8.4.0 and
// @solana/web3.js 1.99.0 as it goes. Those are dependencies of the private
// workspace package tools/txv1-oracle, so run `pnpm install` first (Node 20.18
// or later, for kit 8).
//
//   node scripts/txv1-vectors.mjs                  rewrite test-vectors/txv1.json
//   node scripts/txv1-vectors.mjs --check          exit 1 if the file is not exactly what this generates
//   node scripts/txv1-vectors.mjs --landed <file>  take the landed devnet transactions from <file>
//                                                  (a JSON array shaped like the file's `landed`)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, VECTORS_PATH, loadWriter } from '../tools/txv1-oracle/src/writer.mjs';
import { buildVectorFile, serialize, verifyLanded } from '../tools/txv1-oracle/src/vectors.mjs';
import { EXPECTED_ORACLE_VERSIONS, ORACLE_VERSIONS } from '../tools/txv1-oracle/src/oracle.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const landedAt = args.indexOf('--landed');
const path = relative(ROOT, VECTORS_PATH);

for (const [name, version] of Object.entries(EXPECTED_ORACLE_VERSIONS)) {
  if (ORACLE_VERSIONS[name] !== version) {
    console.error(`The oracle needs ${name} ${version}, found ${ORACLE_VERSIONS[name]}.`);
    process.exit(1);
  }
}

const current = existsSync(VECTORS_PATH) ? readFileSync(VECTORS_PATH, 'utf8') : null;
const landed =
  landedAt >= 0 ? JSON.parse(readFileSync(args[landedAt + 1], 'utf8')) : current ? JSON.parse(current).landed : null;
if (!landed) {
  console.error(`No landed transactions: ${path} is missing, so pass --landed <file>.`);
  process.exit(1);
}
for (const entry of landed) {
  const problems = verifyLanded(entry);
  if (problems.length) {
    console.error(`landed ${entry.name}: ${problems.join('; ')}`);
    process.exit(1);
  }
}

const T = await loadWriter();
const file = await buildVectorFile(T, landed);
const text = serialize(file);
if (check) {
  if (text !== current) {
    console.error(`${path} is not what scripts/txv1-vectors.mjs generates. Run it and commit the result.`);
    process.exit(1);
  }
  console.log(`${path}: ${file.vectors.length} vectors, up to date and checked against kit ${ORACLE_VERSIONS['@solana/kit']}.`);
} else {
  writeFileSync(VECTORS_PATH, text);
  console.log(`${path}: wrote ${file.vectors.length} vectors, each checked against kit ${ORACLE_VERSIONS['@solana/kit']} and web3.js ${ORACLE_VERSIONS['@solana/web3.js']}.`);
}
for (const v of file.vectors) {
  const e = v.expected;
  console.log(`  ${v.name.padEnd(36)} ${e.fits ? 'fits' : `over (${e.overflow})`}  ${e.bytes} B  ${e.addresses} addresses  ${e.signers} signer(s)`);
}
