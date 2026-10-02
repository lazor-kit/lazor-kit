// One portal-mode session, the same for any build of the package: mount
// LazorkitProvider in a jsdom page, connect through a scripted portal (a
// fixed passkey whose wallet is on a scripted chain), then disconnect.
// Returns what localStorage held after each step, key by key. With fixed
// inputs the bytes are fixed, so 4.0's can be compared with 3.3.1's
// (test/fixtures/portal-storage-3.3.1.json; see make-portal-storage.mjs).
import { createHash, createPrivateKey, createECDH, sign } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Connection, Keypair } from '@solana/web3.js';
import { RPC, PAYMASTER, scriptedChain } from './chain.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const PORTAL = 'http://portal.test';
const RP_ID = 'portal.test';
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

/** A fixed P-256 passkey. */
function fixedPasskey() {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.alloc(32, 3));
    const point = ecdh.getPublicKey();
    const x = point.subarray(1, 33);
    const y = point.subarray(33, 65);
    const privateKey = createPrivateKey({
        format: 'jwk',
        key: { kty: 'EC', crv: 'P-256', d: Buffer.alloc(32, 3).toString('base64url'), x: x.toString('base64url'), y: y.toString('base64url') },
    });
    return { privateKey, compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]), rawId: Buffer.from('a fixed passkey credential') };
}

function assertion(key, challenge) {
    const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: PORTAL, crossOrigin: false }),
    );
    const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    // As the portal sends it: a sign reply's field names.
    return {
        normalized: signature.toString('base64'),
        clientDataJSONReturn: clientDataJSON.toString('base64'),
        authenticatorDataReturn: authenticatorData.toString('base64'),
    };
}

const snapshot = () => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));

/**
 * `load(window)` imports the build under test (after the page's globals are
 * set). `providerProps` are added to the provider's (4.0 needs mode="portal").
 */
export async function portalSession(load, providerProps = {}) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://app.test/' });
    const { window } = dom;
    window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
    };
    Object.defineProperty(window.HTMLIFrameElement.prototype, 'sandbox', {
        get() {
            const tokens = () => (this.getAttribute('sandbox') ?? '').split(' ').filter(Boolean);
            return {
                add: (...names) => this.setAttribute('sandbox', [...new Set([...tokens(), ...names])].join(' ')),
                contains: (name) => tokens().includes(name),
            };
        },
    });
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'MessageEvent', 'HTMLElement']) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const W = await load(window);
    const chain = scriptedChain(W);
    globalThis.fetch = (url, init) => chain.fetch(url, init);

    const key = fixedPasskey();
    const seed = Buffer.alloc(32, 21);
    chain.walletFor({ rawId: key.rawId, key: { compressed: key.compressed } }, { rpId: RP_ID, seed, counter: 2 });

    // The portal: answers the connect the SDK's dialog opens.
    const answered = new Set();
    const portal = setInterval(() => {
        const iframe = document.getElementById('lazorkit-iframe');
        if (!iframe?.src || answered.has(iframe.src)) return;
        answered.add(iframe.src);
        const params = new URL(iframe.src).searchParams;
        if (params.get('action') !== 'connect') return;
        const challenge = Buffer.from(params.get('challenge'), 'base64');
        window.dispatchEvent(
            new window.MessageEvent('message', {
                origin: PORTAL,
                source: iframe.contentWindow,
                data: {
                    type: 'connect-result',
                    data: {
                        credentialId: key.rawId.toString('base64'),
                        publickey: key.compressed.toString('base64'),
                        accountName: 'Alice',
                        kind: 'asserted',
                        ...assertion(key, challenge),
                    },
                },
            }),
        );
    }, 5);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
        React.createElement(W.LazorkitProvider, {
            rpcUrl: RPC,
            portalUrl: PORTAL,
            paymasterConfig: { paymasterUrl: PAYMASTER },
            cluster: 'devnet',
            ...providerProps,
        }),
    );
    try {
        for (let i = 0; i < 400 && W.useWalletStore.getState().connection.rpcEndpoint !== RPC; i++) await new Promise((r) => setTimeout(r, 5));
        W.useWalletStore.setState({
            connection: new Connection(RPC, { commitment: 'confirmed', fetch: (_url, init) => chain.fetch(RPC, init), disableRetryOnRateLimit: true }),
        });
        const mounted = snapshot();
        const wallet = await W.useWalletStore.getState().connect();
        const connected = snapshot();
        await W.useWalletStore.getState().disconnect();
        const disconnected = snapshot();
        return { mounted, connected, disconnected, wallet };
    } finally {
        clearInterval(portal);
        root.unmount();
        window.close();
        void Keypair;
    }
}
