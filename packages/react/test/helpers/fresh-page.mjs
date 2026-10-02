// A fresh copy of the built package, as after a reload: its own store, keys
// in memory, passkey lanes, everything module-level. The entries share
// chunks (dist/chunks), so a query string on the entry (`index.mjs?page=2`)
// would load a new entry over the same chunks; instead the whole dist is
// copied to test/.pages/<n>/ and imported from there. Bare imports still
// resolve through packages/react/node_modules.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const PAGES = fileURLToPath(new URL('../.pages/', import.meta.url));
const run = `${process.pid}-${Date.now()}`;
let pages = 0;
let cleanup = false;

/** Import `entry` (default the root) from a new copy of dist. */
export async function freshPage(entry = 'index.mjs') {
    const [module] = await freshPages(entry);
    return module;
}

/** Import several entries (`index.mjs`, `hooks.mjs`, `core.mjs`) from one new copy: one page. */
export async function freshPages(...entries) {
    const dir = `${PAGES}${run}/${++pages}/`;
    cpSync(DIST, dir, { recursive: true, filter: (source) => !source.endsWith('.map') });
    if (!cleanup) {
        cleanup = true;
        process.on('exit', () => rmSync(`${PAGES}${run}`, { recursive: true, force: true }));
    }
    return Promise.all(entries.map((entry) => import(pathToFileURL(`${dir}${entry}`).href)));
}
