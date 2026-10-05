// A browser page (jsdom) on https://app.test with a virtual authenticator, a
// scripted chain and paymaster, and the built package, for the Embedded
// tests. `scriptedUi()` answers the SDK's screens in order instead of the
// built-in sheets; `embeddedConfig()` is the provider's props for this page.
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { installFakeWebAuthn } from './fake-webauthn.mjs';
import { PAYMASTER, RPC, scriptedChain } from './chain.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18

export const RP_ID = 'app.test';
export const APP_NAME = 'Test App';

/** Set up the page's globals; returns the window and the authenticator. */
export function setUpPage({ url = `https://${RP_ID}/` } = {}) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, pretendToBeVisual: true });
    const { window } = dom;
    window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
    };
    // Nor an iframe's `sandbox` token list (the portal dialog's).
    Object.defineProperty(window.HTMLIFrameElement.prototype, 'sandbox', {
        get() {
            const tokens = () => (this.getAttribute('sandbox') ?? '').split(' ').filter(Boolean);
            return {
                add: (...names) => this.setAttribute('sandbox', [...new Set([...tokens(), ...names])].join(' ')),
                contains: (name) => tokens().includes(name),
            };
        },
    });
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'CustomEvent', 'MessageEvent', 'HTMLElement', 'Node']) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true });
    }
    globalThis.isSecureContext = true;
    const authenticator = installFakeWebAuthn(window);
    return { dom, window, authenticator };
}

/** Load the built package (`import`), and install the scripted chain as `fetch`. */
export async function loadPackage(load) {
    const W = await load();
    const chain = scriptedChain(W);
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    return { W, chain };
}

/** The SDK's screens, answered in order from `answers`. Records what was shown. */
export function scriptedUi(answers = []) {
    const ui = {
        answers,
        shown: [],
        steps: [],
        closed: 0,
        async noPasskey(ctx) {
            ui.shown.push({ screen: 'no-passkey', ...ctx });
            const answer = ui.answers.shift();
            if (!answer) throw new Error('no scripted answer for the no-passkey screen');
            return typeof answer === 'function' ? answer(ctx) : answer;
        },
        progress(step) {
            ui.steps.push(step);
        },
        async chooseWallet(choices) {
            ui.shown.push({ screen: 'choose-wallet', choices });
            const answer = ui.answers.shift();
            return typeof answer === 'function' ? answer(choices) : (answer ?? null);
        },
        async reviewTransaction(review) {
            ui.shown.push({ screen: 'review', review });
            const answer = ui.answers.shift();
            return typeof answer === 'function' ? answer(review) : answer === true;
        },
        close() {
            ui.closed++;
        },
    };
    return ui;
}

export function embeddedConfig(overrides = {}) {
    return {
        mode: 'embedded',
        rpId: RP_ID,
        appName: APP_NAME,
        rpcUrl: RPC,
        cluster: 'devnet',
        paymasterConfig: { paymasterUrl: PAYMASTER },
        ...overrides,
    };
}

/** What a promise rejects with (fails the test if it resolves). */
export async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection, but it resolved');
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `condition()` is truthy. */
export async function until(condition, what = 'the condition', timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await condition();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await tick(5);
    }
}
