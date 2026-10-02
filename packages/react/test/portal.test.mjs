// What the portal dialog sends its iframe, through the built package (`pnpm
// build` first) in a browser page (jsdom): the sign dialog hands the portal
// the stored credential id, passkey public key and wallet address
// (`SYNC_CREDENTIALS`), addressed to the portal's origin only — never `'*'`,
// which delivered them to whatever page the iframe showed, the portal's or
// not. jsdom gives the iframe a page at the URL it is set to without fetching
// it, so no network: a page at the portal's URL stands in for the portal, and
// one at another origin for an iframe navigated away from it. Run with
// `pnpm test`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ─── A browser page ─────────────────────────────────────────────────────────

const APP = 'http://app.test/';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: APP });
const { window } = dom;
// jsdom has <dialog> but not its modal methods.
window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
};
window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
};
// Nor an iframe's `sandbox` token list.
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
// The portal dialog's debug log.
console.debug = () => {};

const W = await import('../dist/index.mjs');

after(() => window.close());

const CREDENTIAL_ID = Buffer.from('a passkey credential').toString('base64');
const PASSKEY = [2, ...new Array(32).fill(0x11)];
const SMART_WALLET = W.Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey.toBase58();

async function until(condition, what) {
    for (let i = 0; i < 400; i++) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`timed out waiting for ${what}`);
}

/**
 * Opens the sign dialog for `portalUrl` with a wallet stored and, given
 * `navigateTo`, sends its iframe there at once (before the credentials are
 * first synced, half a second in). Records what the SDK posts to the iframe's
 * window (every `postMessage` call) and what reached its page.
 */
async function syncedCredentials(portalUrl, { navigateTo } = {}) {
    await W.StorageManager.saveWallet({
        credentialId: CREDENTIAL_ID,
        passkeyPubkey: PASSKEY,
        smartWallet: SMART_WALLET,
        walletDevice: '',
        platform: 'web',
        expo: '',
        protocolVersion: 2,
    });
    const dialog = new W.DialogManager({ portalUrl });
    const posts = [];
    const delivered = [];
    const signing = dialog.openSignMessage('aGVsbG8', CREDENTIAL_ID).catch((error) => error);
    try {
        await until(() => dialog.getIframeRef()?.contentWindow, 'the portal iframe');
        const iframe = dialog.getIframeRef();
        if (navigateTo) iframe.src = navigateTo;
        const frame = iframe.contentWindow;
        const post = frame.postMessage;
        frame.postMessage = function (message, targetOrigin) {
            posts.push({ message, targetOrigin });
            return post.call(this, message, targetOrigin);
        };
        frame.addEventListener('message', (event) => delivered.push(event.data));
        // Sent half a second after the dialog opens, then again 200 ms later.
        await until(() => posts.length >= 2, 'the credentials to be synced twice');
        // Long enough for a message posted to the frame to be dispatched.
        await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
        dialog.destroy();
        assert.ok((await signing) instanceof W.PortalCancelledError);
        await W.StorageManager.clearWallet();
        await until(() => !document.getElementById('lazorkit-iframe'), 'the dialog to close');
    }
    return { posts, delivered };
}

/** Asserts `message` is the credentials sync, carrying the stored wallet's. */
function assertCredentials(message) {
    assert.equal(message.type, 'SYNC_CREDENTIALS');
    assert.equal(message.data.credentialId, CREDENTIAL_ID);
    assert.equal(message.data.publickey, Buffer.from(PASSKEY).toString('base64'));
    assert.equal(message.data.smartWalletAddress, SMART_WALLET);
}

test("the sign dialog sends the stored credentials to the portal's page, addressed to the portal's origin only", async () => {
    const { posts, delivered } = await syncedCredentials('http://portal.test');
    for (const { message, targetOrigin } of posts) {
        assert.equal(targetOrigin, 'http://portal.test');
        assertCredentials(message);
    }
    assert.ok(delivered.length >= 1, "the portal's page receives them");
    for (const message of delivered) assertCredentials(message);
});

test('an iframe navigated away from the portal receives none of them', async () => {
    const { posts, delivered } = await syncedCredentials('http://portal.test', { navigateTo: 'http://elsewhere.test/' });
    assert.ok(posts.length >= 2, 'posted to the iframe all the same');
    for (const { targetOrigin } of posts) assert.equal(targetOrigin, 'http://portal.test');
    assert.deepEqual(delivered, [], 'a page of another origin receives nothing');
});

test("a portal URL with a port and a path: the credentials are addressed to its origin", async () => {
    const { posts, delivered } = await syncedCredentials('https://portal.example:8443/wallet');
    for (const { targetOrigin } of posts) assert.equal(targetOrigin, 'https://portal.example:8443');
    assert.ok(delivered.length >= 1);
});
