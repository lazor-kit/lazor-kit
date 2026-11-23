#!/usr/bin/env node
// The v1 writer exists twice, once per wallet package, and the two copies must
// be byte-identical: both are tested on the same vectors, by the same test
// file, and only the web one is run against the kit 8.4.0 oracle. Exits 1 when
// a pair differs. No dependencies.
//
//   node scripts/check-txv1-identical.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Each pair must be byte-identical: the writer, and the unit tests that run it in each package.
const PAIRS = [
    ['packages/react/core/wallet/txv1.ts', 'packages/react-native/src/core/wallet/txv1.ts'],
    ['packages/react/test/txv1.test.mjs', 'packages/react-native/test/txv1.test.mjs'],
];

let differ = 0;
for (const pair of PAIRS) {
    const files = pair.map((path) => {
        const bytes = readFileSync(join(root, path));
        return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    for (const { path, bytes, sha256 } of files) console.log(`${sha256}  ${bytes.length} B  ${path}`);
    const [a, b] = files;
    if (a.bytes.equals(b.bytes)) continue;
    differ++;
    const lines = [a, b].map(({ bytes }) => bytes.toString('utf8').split('\n'));
    let line = 0;
    while (line < lines[0].length && lines[0][line] === lines[1][line]) line++;
    console.error(
        `The two copies differ, first at line ${line + 1}. Edit one and copy it over the other:\n` +
            `  cp ${a.path} ${b.path}\n`,
    );
}
if (differ) process.exit(1);
console.log('txv1: the web and mobile copies are byte-identical.');
