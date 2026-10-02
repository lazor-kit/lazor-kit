// Writes portal-storage-3.3.1.json: what localStorage holds after a portal
// session (test/helpers/portal-session.mjs) on @lazorkit/wallet 3.3.1, the
// bytes 4.0's portal mode must keep. Unpack the published 3.3.1 tarball
// under test/.pages (so its imports resolve through this package's
// node_modules) and run:
//
//   node test/fixtures/make-portal-storage.mjs test/.pages/v331/package
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalSession } from '../helpers/portal-session.mjs';

const dir = resolve(process.argv[2]);
const session = await portalSession(() => import(pathToFileURL(`${dir}/dist/index.mjs`).href));
const { mounted, connected, disconnected } = session;
writeFileSync(new URL('./portal-storage-3.3.1.json', import.meta.url), JSON.stringify({ mounted, connected, disconnected }, null, 2) + '\n');
console.log('wrote portal-storage-3.3.1.json:', Object.keys(connected).join(', '));
process.exit(0);
