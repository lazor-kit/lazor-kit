// Portal mode keeps 3.4.1's storage byte for byte: the same keys, the same
// values, after mounting the provider, after a connect, after a disconnect
// (test/fixtures/portal-storage-3.4.1.json, made from the published 3.4.1
// with test/fixtures/make-portal-storage.mjs; 3.3.1 wrote the same bytes).
// Through the built package (`pnpm build` first), with a scripted portal and
// chain. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshPage } from './helpers/fresh-page.mjs';
import { portalSession } from './helpers/portal-session.mjs';

console.debug = () => {};

const expected = JSON.parse(readFileSync(new URL('./fixtures/portal-storage-3.4.1.json', import.meta.url), 'utf8'));

test("portal mode writes 3.4.1's localStorage keys and bytes, mounted, connected and disconnected", async () => {
    const session = await portalSession(() => freshPage(), { mode: 'portal' });
    assert.deepEqual(session.mounted, expected.mounted);
    assert.deepEqual(session.connected, expected.connected);
    assert.deepEqual(session.disconnected, expected.disconnected);
    assert.equal(session.wallet.mode, undefined, 'a portal record carries none of the Embedded fields');
});
