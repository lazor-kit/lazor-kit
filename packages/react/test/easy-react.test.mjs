// The Easy tier in React, through the built package rendered with react-dom
// in a jsdom page (virtual authenticator, scripted devnet): the provider
// throws for a missing mode; `useWallet()` has the Easy fields and a status
// that follows the store; the 3.x flags warn once when read; `ConnectButton`
// runs "Continue with passkey" through the SDK's own sheets (data-lk hooks),
// labels each step, and once connected offers Copy address and Sign out; a
// reload is connected on its first effect; in portal mode the same button
// opens the portal. Run with `pnpm test`.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshPage, freshPages } from './helpers/fresh-page.mjs';
import { APP_NAME, RP_ID, embeddedConfig, loadPackage, setUpPage, until } from './helpers/embedded-page.mjs';

console.debug = () => {};
const errors = [];
console.error = (...args) => errors.push(args.map(String).join(' '));
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

const { window, authenticator } = setUpPage();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let copied;
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (text) => void (copied = text) }, configurable: true });
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = React;
const h = React.createElement;
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

beforeEach(() => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
    document.querySelectorAll('dialog').forEach((d) => d.remove());
});

const embeddedProps = () => {
    const { mode, rpId, appName, rpcUrl, cluster, paymasterConfig } = embeddedConfig();
    return { mode, rpId, appName, rpcUrl, cluster, paymasterConfig };
};

async function mount(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(element));
    return {
        container,
        unmount: () => act(async () => root.unmount()),
    };
}

const click = (el) => act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));

class Boundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    render() {
        return this.state.error ? h('p', { id: 'caught' }, `${this.state.error.name}:${this.state.error.problem}`) : this.props.children;
    }
}

test('LazorkitProvider without mode throws LazorkitConfigError (no-mode) while rendering', async () => {
    const { container, unmount } = await mount(h(Boundary, null, h(W.LazorkitProvider, { rpcUrl: 'http://rpc.test/' }, h('span', null, 'app'))));
    assert.equal(container.querySelector('#caught').textContent, 'LazorkitConfigError:no-mode');
    await unmount();
});

test('ConnectButton: Continue with passkey through the SDK sheets, step labels, then Copy address and Sign out', async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    let seen;
    function Status() {
        const wallet = W.useWallet();
        seen = wallet;
        return h('output', { id: 'status' }, `${wallet.status}|${wallet.address ?? ''}`);
    }
    const { container, unmount } = await mount(
        h(W.LazorkitProvider, embeddedProps(), h(W.ConnectButton, null), h(Status)),
    );
    const status = () => container.querySelector('#status').textContent;
    assert.equal(status(), 'disconnected|');
    for (const key of ['status', 'address', 'wallet', 'connect', 'disconnect', 'signAndSend', 'signMessage', 'error']) {
        assert.ok(key in seen, `useWallet().${key}`);
    }
    const button = container.querySelector('[data-lk="connect"]');
    assert.equal(button.textContent, 'Continue with passkey');

    const labels = new Set();
    const observer = new window.MutationObserver(() => {
        const b = container.querySelector('[data-lk="connect"], [data-lk="menu"]');
        if (b) labels.add(b.textContent);
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });

    await click(button);
    const sheet = await until(() => document.querySelector('dialog[data-lk="no-passkey"]'), 'the no-passkey sheet');
    assert.equal(sheet.querySelector('h2').textContent, 'No passkey on this device?');
    const name = sheet.querySelector('[data-lk="passkey-name"]');
    assert.match(name.value, new RegExp(`^${APP_NAME} · \\w{4}…\\w{4}$`));
    assert.ok(sheet.querySelector('[data-lk="other-device"]'));
    assert.ok(sheet.querySelector('[data-lk="not-now"]'));
    await act(async () => sheet.querySelector('[data-lk="create"]').click());
    await until(() => status().startsWith('connected'), 'connected');
    await act(async () => {});
    observer.disconnect();
    assert.equal(document.querySelector('dialog[data-lk="no-passkey"]'), null, 'the sheet closed');
    const address = status().split('|')[1];
    assert.equal(address, W.useWalletStore.getState().wallet.vaultPda);
    assert.ok(labels.has('Creating your wallet…') || labels.has('Creating passkey…'), [...labels].join(' / '));

    const menu = container.querySelector('[data-lk="menu"]');
    assert.equal(menu.textContent, `${address.slice(0, 4)}…${address.slice(-4)} ▾`);
    await click(menu);
    await click(container.querySelector('[data-lk="copy"]'));
    assert.equal(copied, address);
    await click(container.querySelector('[data-lk="sign-out"]'));
    await until(() => status() === 'disconnected|', 'signed out');
    await unmount();
});

test('the 3.x flags still work and warn once each when read', async () => {
    warnings.length = 0;
    let read;
    function Old() {
        const wallet = W.useWallet();
        read = [wallet.isConnecting, wallet.isConnecting, wallet.isSigning, wallet.isLoading];
        return null;
    }
    const { unmount } = await mount(h(W.LazorkitProvider, embeddedProps(), h(Old)));
    await act(async () => {});
    assert.deepEqual(read, [false, false, false, false]);
    const deprecations = warnings.filter((w) => /is deprecated/.test(w));
    assert.deepEqual(deprecations.map((w) => w.match(/useWallet\(\)\.(\w+)/)[1]).sort(), ['isConnecting', 'isLoading', 'isSigning']);
    await unmount();
});

test('a reload is connected on its first effect (no flash of "disconnected")', async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    // Connect on this page, through the client, with the built-in sheet answered.
    const client = W.createLazorkitClient(embeddedConfig(), { replace: true });
    const connecting = client.connect();
    const sheet = await until(() => document.querySelector('dialog[data-lk="no-passkey"]'), 'the sheet');
    sheet.querySelector('[data-lk="create"]').click();
    await connecting;

    const R = await freshPage();
    const firstEffect = [];
    function Probe() {
        const { status } = R.useWallet();
        React.useEffect(() => {
            firstEffect.push(status);
        }, []);
        return null;
    }
    const { unmount } = await mount(h(R.LazorkitProvider, embeddedProps(), h(Probe)));
    assert.deepEqual(firstEffect, ['connected']);
    await unmount();
    void RP_ID;
});

test('/hooks: the same useWallet and store as the root; useWalletStatus gives the step; useLazorkitClient is the page client', async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    const [R, H] = await freshPages('index.mjs', 'hooks.mjs');
    assert.equal(H.useWallet, R.useWallet, 'one useWallet');
    assert.equal(H.useWalletStore, R.useWalletStore, 'one store');
    const steps = [];
    let client;
    function Probe() {
        const { status, step } = H.useWalletStatus();
        client = H.useLazorkitClient();
        steps.push(`${status}:${step}`);
        return null;
    }
    const { unmount } = await mount(h(R.LazorkitProvider, embeddedProps(), h(Probe)));
    assert.equal(client, R.getLazorkitClient());
    let connecting;
    await act(async () => {
        connecting = client.connect().catch((e) => e);
    });
    const sheet = await until(() => document.querySelector('dialog[data-lk="no-passkey"]'), 'the sheet');
    await act(async () => sheet.querySelector('[data-lk="not-now"]').click());
    const error = await connecting;
    assert.ok(error instanceof R.UserRejectedError);
    assert.ok(steps.includes('connecting:checking-passkey'), steps.join(' '));
    assert.ok(steps.includes('connecting:no-passkey'), steps.join(' '));
    assert.equal(steps[steps.length - 1], 'disconnected:null');
    await unmount();
});

test('portal mode: the same button opens the portal connect', async () => {
    const { container, unmount } = await mount(
        h(W.LazorkitProvider, { mode: 'portal', portalUrl: 'http://portal.test', rpcUrl: 'http://rpc.test/', cluster: 'devnet' }, h(W.ConnectButton, null)),
    );
    await click(container.querySelector('[data-lk="connect"]'));
    const iframe = await until(() => document.getElementById('lazorkit-iframe'), 'the portal iframe');
    assert.equal(new URL(iframe.src).searchParams.get('action'), 'connect');
    assert.equal(container.querySelector('[data-lk="connect"]').textContent, 'Connecting…');
    await act(async () => W.useWalletStore.getState().disconnect());
    await unmount();
});
