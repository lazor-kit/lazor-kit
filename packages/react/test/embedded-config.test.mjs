// The provider's configuration, through the built package: D1 (no default
// mode), D3 (Embedded's rpId: a bare host or registrable suffix in canonical
// form, not an IP; localhost allowed), D11 (Embedded on mainnet needs the
// app's own paymaster, and never a localhost rpId), the page's own problems
// (an IP host, plain http, no WebAuthn) as availability rather than a crash,
// and one client per page that a second, different config cannot silently
// reconfigure. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshPage } from './helpers/fresh-page.mjs';
import { embeddedConfig, loadPackage, rejection, setUpPage, scriptedUi } from './helpers/embedded-page.mjs';
import { PAYMASTER, RPC } from './helpers/chain.mjs';

console.debug = () => {};
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

const { window } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

beforeEach(() => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    warnings.length = 0;
    globalThis.isSecureContext = true;
});

function configError(fn) {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof W.LazorkitConfigError, `a LazorkitConfigError, not ${error}`);
        return error;
    }
    assert.fail('did not throw');
}

test('D1: no mode, or an unknown one, throws no-mode with the 3.x upgrade hint', () => {
    for (const config of [{}, { rpcUrl: RPC }, { mode: 'popup' }, undefined]) {
        const error = configError(() => W.resolveConfig(config));
        assert.equal(error.problem, 'no-mode');
        assert.match(error.message, /mode="portal" to keep existing wallets/);
    }
    assert.equal(W.resolveConfig({ mode: 'portal' }).mode, 'portal');
});

test('Embedded needs rpId and appName', () => {
    assert.equal(configError(() => W.resolveConfig({ mode: 'embedded', appName: 'X', cluster: 'devnet' })).problem, 'no-rp-id');
    assert.equal(configError(() => W.resolveConfig({ mode: 'embedded', rpId: 'app.test', cluster: 'devnet' })).problem, 'no-app-name');
});

test('D3: rpId is a bare host name in canonical form, not an IP', () => {
    const ok = ['app.example.com', 'example.com', 'localhost', 'dev.localhost', 'xn--mnchen-3ya.de'];
    for (const rpId of ok) assert.deepEqual(W.validateRpId(rpId), { ok: true }, rpId);
    const bad = {
        'https://app.example.com': 'bad-rp-id',
        'app.example.com:443': 'bad-rp-id',
        'app.example.com/login': 'bad-rp-id',
        'user@app.example.com': 'bad-rp-id',
        'app example.com': 'bad-rp-id',
        'App.Example.com': 'bad-rp-id',
        'example.com.': 'bad-rp-id',
        'münchen.de': 'bad-rp-id',
        '192.168.1.10': 'ip-rp-id',
        '::1': 'ip-rp-id',
        '[::1]': 'ip-rp-id',
        '': 'bad-rp-id',
    };
    for (const [rpId, problem] of Object.entries(bad)) {
        const check = W.validateRpId(rpId);
        assert.equal(check.ok, false, rpId);
        assert.equal(check.problem, problem, rpId);
        if (rpId) assert.equal(configError(() => W.resolveConfig(embeddedConfig({ rpId }))).problem, problem);
    }
    assert.match(W.validateRpId('App.Example.com').message, /Use "app\.example\.com"/);
    assert.match(W.validateRpId('münchen.de').message, /xn--mnchen-3ya\.de/);
});

test("D3: the page's host decides: equal is fine; a parent warns about subdomains; anything else needs Related Origins", () => {
    assert.deepEqual(W.validateRpId('app.example.com', 'app.example.com'), { ok: true });
    assert.match(W.validateRpId('example.com', 'app.example.com').warning, /every subdomain of example\.com can sign for every wallet/);
    assert.match(W.validateRpId('other.com', 'app.example.com').warning, /Related Origins/);
});

test('D11: Embedded on mainnet without its own paymaster throws; a LazorKit paymaster there warns', () => {
    const mainnet = { mode: 'embedded', rpId: 'app.example.com', appName: 'X', cluster: 'mainnet' };
    assert.equal(configError(() => W.resolveConfig(mainnet)).problem, 'mainnet-paymaster');
    // An RPC URL that does not say its cluster is taken as mainnet, as every release did.
    assert.equal(configError(() => W.resolveConfig({ ...mainnet, cluster: undefined, rpcUrl: 'https://rpc.example.com' })).problem, 'mainnet-paymaster');
    W.resolveConfig({ ...mainnet, paymasterConfig: { paymasterUrl: 'https://relay.example.com' } });
    assert.equal(warnings.length, 0);
    W.resolveConfig({ ...mainnet, paymasterConfig: { paymasterUrl: 'https://kora.mainnet.lazorkit.com' } });
    assert.match(warnings.join('\n'), /LazorKit relayer on mainnet/);
    // Devnet: LazorKit's relayer is the default.
    assert.equal(W.resolveConfig({ ...mainnet, cluster: 'devnet' }).paymasterConfig.paymasterUrl, 'https://kora.devnet.lazorkit.com');
});

test('a localhost rpId on mainnet throws: every local dev server shares it', () => {
    const error = configError(() =>
        W.resolveConfig({ mode: 'embedded', rpId: 'localhost', appName: 'X', cluster: 'mainnet', paymasterConfig: { paymasterUrl: 'https://relay.example.com' } }),
    );
    assert.equal(error.problem, 'localhost-mainnet');
    assert.equal(W.resolveConfig({ mode: 'embedded', rpId: 'localhost', appName: 'X', cluster: 'devnet' }).rpId, 'localhost');
});

test('the session prop is reserved: it warns and does nothing', () => {
    W.resolveConfig(embeddedConfig({ session: { preset: '24h' } }));
    assert.match(warnings.join('\n'), /reserved for "remember this device"/);
});

test("Embedded's defaults: confirm on; portal mode takes no rpId and keeps 3.x's defaults", () => {
    const embedded = W.resolveConfig(embeddedConfig());
    assert.equal(embedded.confirm, true);
    assert.equal(embedded.keyStorage, 'auto');
    const portal = W.resolveConfig({ mode: 'portal' });
    assert.equal(portal.portalUrl, 'https://portal.lazor.sh');
    assert.equal(portal.rpId, undefined);
    assert.equal(portal.confirm, undefined);
});

test('a page on plain http (not a secure context): misconfigured, and connect says why', async () => {
    globalThis.isSecureContext = false;
    const client = W.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }), { replace: true });
    assert.equal(client.getState().availability, 'misconfigured');
    const error = await rejection(client.connect());
    assert.equal(error.problem, 'insecure-context');
    assert.equal(W.errorKind(error), 'config');
    globalThis.isSecureContext = true;
    W.createLazorkitClient(embeddedConfig({ ui: scriptedUi(), appName: 'Again' }), { replace: true });
});

test('no WebAuthn here (an in-app browser view): unavailable, and connect rejects with PasskeyUnavailableError', async () => {
    const saved = window.PublicKeyCredential;
    delete globalThis.PublicKeyCredential;
    try {
        const client = W.createLazorkitClient(embeddedConfig({ ui: scriptedUi(), appName: 'No WebAuthn' }), { replace: true });
        assert.equal(client.getState().availability, 'unavailable');
        const error = await rejection(client.connect());
        assert.ok(error instanceof W.PasskeyUnavailableError);
        assert.equal(W.userMessage(error), "Passkeys don't work in this browser view. Open this page in Safari or Chrome.");
    } finally {
        globalThis.PublicKeyCredential = saved;
        W.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }), { replace: true });
    }
});

test('one client per page: the same config returns it; one that changes the relayer, rpId or review throws unless replace', () => {
    const ui = scriptedUi();
    const first = W.createLazorkitClient(embeddedConfig({ ui }), { replace: true });
    assert.equal(W.createLazorkitClient(embeddedConfig({ ui })), first);
    for (const change of [
        { paymasterConfig: { paymasterUrl: 'https://other.example.com' } },
        { rpId: 'other.app.test' },
        { confirm: false },
        { trustedAuthorities: ['11111111111111111111111111111111'] },
        { mode: 'portal', rpId: undefined, appName: undefined },
    ]) {
        const error = configError(() => W.createLazorkitClient(embeddedConfig({ ui, ...change })));
        assert.equal(error.problem, 'reconfigured', JSON.stringify(change));
    }
    // A change that guards nothing (the app's name) reconfigures quietly.
    assert.equal(W.createLazorkitClient(embeddedConfig({ ui, appName: 'Renamed' })), first);
    assert.equal(W.useWalletStore.getState().config.appName, 'Renamed');
    assert.equal(W.createLazorkitClient(embeddedConfig({ ui, confirm: false }), { replace: true }), first);
});

test('errorKind and userMessage read errors from another copy of the package by name', async () => {
    const other = await freshPage('core.mjs');
    const rejected = new other.UserRejectedError('not-now');
    assert.equal(rejected instanceof W.UserRejectedError, false, 'another copy');
    assert.equal(W.isUserRejection(rejected), true);
    assert.equal(W.errorKind(rejected), 'rejected');
    assert.equal(W.errorKind(new other.NetworkError('down')), 'network');
    assert.equal(W.errorKind(Object.assign(new Error('x'), { cause: new other.PasskeyMismatchError() })), 'other-passkey');
    assert.equal(W.errorKind(new W.PortalCancelledError()), 'rejected');
    assert.ok(new W.PortalCancelledError() instanceof W.UserRejectedError);
    assert.equal(new W.PortalCancelledError().name, 'PortalCancelledError');
    assert.ok(new W.WalletConfirmationDeclinedError() instanceof W.UserRejectedError);
    assert.equal(W.userMessage(new W.TransactionExpiredError('sig')), "It didn't go through. It's safe to try again.");
    assert.equal(W.userMessage(new W.V1WalletRetiredError()), "This wallet's old version is retired. Move it to the new version to continue.");
});

void PAYMASTER;
