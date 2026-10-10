// Silent reconnect and what Embedded mode keeps, through the built package:
// a reload (a fresh copy of the package, storage as it was) is connected as
// soon as the client is configured, before any await and with no passkey
// prompt; a stored record from another rpId, mode or cluster is not
// restored; storage that is blocked leaves the page connected for itself;
// disconnect forgets the wallet and the session key (unless kept) but not
// the credential ids `excludeCredentials` needs; Embedded mode never writes
// the portal's keys. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshPage } from './helpers/fresh-page.mjs';
import { RP_ID, embeddedConfig, loadPackage, scriptedUi, setUpPage } from './helpers/embedded-page.mjs';
import { PAYMASTER } from './helpers/chain.mjs';

console.debug = () => {};
console.error = () => {};
console.warn = () => {};

const { window, authenticator } = setUpPage();
const first = await loadPackage(() => freshPage());
const chain = first.chain;
after(() => window.close());

const PORTAL_KEYS = ['lazorkit-wallet', 'lazorkit-wallet-store', 'CREDENTIAL_ID', 'SMART_WALLET_ADDRESS', 'PUBLIC_KEY'];
const STORE = `lazorkit:embedded:${RP_ID}:store`;
const RECORD = `lazorkit:embedded:${RP_ID}:wallet`;
const KNOWN = `lazorkit:embedded:${RP_ID}:known`;

/** A new user connected on a fresh page; returns the page's package and wallet. */
async function connectedPage(overrides = {}) {
    const W = await freshPage();
    W.createLazorkitClient(embeddedConfig({ ui: scriptedUi([(ctx) => ({ action: 'create', name: ctx.suggestedName })]), ...overrides }), { replace: true });
    const wallet = await W.getLazorkitClient().connect();
    return { W, wallet };
}

beforeEach(() => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
});

test('a reload is connected the moment the client is configured: no await, no passkey prompt, a "restored" event', async () => {
    const { wallet } = await connectedPage();
    authenticator.clear();
    const reloaded = await freshPage();
    assert.equal(reloaded.getLazorkitClient().getState().status, 'disconnected', 'nothing read before configure');
    const events = [];
    const client = reloaded.createLazorkitClient(embeddedConfig({ ui: scriptedUi(), onEvent: (e) => events.push(e) }));
    // Synchronously, on the line after configure:
    const state = client.getState();
    assert.equal(state.status, 'connected');
    assert.equal(state.address, wallet.vaultPda);
    assert.deepEqual(state.wallet, wallet);
    assert.deepEqual(events, [{ type: 'connected', how: 'restored', signatures: [] }]);
    assert.equal(authenticator.calls.length, 0);
    // And connect() returns it with no prompt either.
    assert.deepEqual(await client.connect(), wallet);
    assert.equal(authenticator.calls.length, 0);
});

test('a record from another rpId, another cluster, or not written by Embedded mode is not restored', async () => {
    const { wallet } = await connectedPage();
    const stored = JSON.parse(localStorage.getItem(STORE));

    // Another rpId's namespace holds it: this rpId has nothing.
    const other = await freshPage();
    other.createLazorkitClient(embeddedConfig({ rpId: 'other.app.test', ui: scriptedUi() }));
    assert.equal(other.getLazorkitClient().getState().wallet, null);

    // The record says another rpId (copied over by hand, or a bug).
    localStorage.setItem(STORE, JSON.stringify({ ...stored, state: { wallet: { ...wallet, rpId: 'evil.test' } } }));
    const wrongRp = await freshPage();
    wrongRp.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }));
    assert.equal(wrongRp.getLazorkitClient().getState().wallet, null);

    // The wallet's program is not this cluster's.
    localStorage.setItem(STORE, JSON.stringify(stored));
    const mainnet = await freshPage();
    mainnet.createLazorkitClient(embeddedConfig({ cluster: 'mainnet', paymasterConfig: { paymasterUrl: PAYMASTER }, ui: scriptedUi() }));
    assert.equal(mainnet.getLazorkitClient().getState().wallet, null);

    // A record without mode (portal-written) in the Embedded key.
    const { mode, rpId, programId, how, connectedAt, ...portalShaped } = wallet;
    void [mode, rpId, programId, how, connectedAt];
    localStorage.setItem(STORE, JSON.stringify({ state: { wallet: portalShaped }, version: 0 }));
    const noMode = await freshPage();
    noMode.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }));
    assert.equal(noMode.getLazorkitClient().getState().wallet, null);
});

test("portal mode never restores an Embedded record, even in the portal's own key", async () => {
    const { wallet } = await connectedPage();
    localStorage.setItem('lazorkit-wallet-store', JSON.stringify({ state: { wallet }, version: 0 }));
    const portal = await freshPage();
    portal.createLazorkitClient({ mode: 'portal' });
    assert.equal(portal.getLazorkitClient().getState().wallet, null);
});

test('storage blocked: connect works and the page stays connected for itself; nothing throws', async () => {
    const real = globalThis.localStorage;
    const blocked = {
        getItem() {
            throw new Error('SecurityError: storage is blocked');
        },
        setItem() {
            throw new Error('SecurityError: storage is blocked');
        },
        removeItem() {
            throw new Error('SecurityError: storage is blocked');
        },
        key: () => null,
        length: 0,
    };
    globalThis.localStorage = blocked;
    try {
        const { W, wallet } = await connectedPage();
        assert.equal(W.getLazorkitClient().getState().status, 'connected');
        assert.equal(W.getLazorkitClient().getState().wallet.smartWallet, wallet.smartWallet);
        const reloaded = await freshPage();
        reloaded.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }));
        assert.equal(reloaded.getLazorkitClient().getState().wallet, null, 'nothing was kept');
    } finally {
        globalThis.localStorage = real;
    }
});

test('disconnect forgets the wallet and the session key, keeps the known credential ids; keepSessionKeys keeps the key', async () => {
    const { W } = await connectedPage({ keyStorage: 'memory' });
    await W.useWalletStore.getState().createSession({ spendingLimits: { solPerTxMax: 1000n } });
    assert.ok(localStorage.getItem(RECORD));
    await W.getLazorkitClient().disconnect({ keepSessionKeys: true });
    assert.equal(localStorage.getItem(RECORD), null);
    assert.equal(JSON.parse(localStorage.getItem(STORE)).state.wallet, null);
    assert.equal(JSON.parse(localStorage.getItem(KNOWN)).length, 1, 'the credential id stays, for excludeCredentials');
    // Kept: refused while disconnected, by the wallet binding, not missing.
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: [] }), /signs only for wallet/);

    await W.getLazorkitClient().disconnect();
    await assert.rejects(W.useWalletStore.getState().signAndSendWithSession({ instructions: [] }), /No session key found/);
    W.forgetEmbeddedDevice(RP_ID);
    assert.equal(localStorage.getItem(KNOWN), null);
});

test("Embedded mode never writes the portal's keys", async () => {
    const { W } = await connectedPage();
    await W.getLazorkitClient().signAndSend({ instructions: [], confirm: false }).catch(() => {});
    await W.getLazorkitClient().disconnect();
    const keys = Object.keys(localStorage);
    for (const key of PORTAL_KEYS) assert.ok(!keys.includes(key), `${key} was written`);
    assert.ok(keys.every((k) => k.startsWith('lazorkit:')), keys.join(', '));
});
