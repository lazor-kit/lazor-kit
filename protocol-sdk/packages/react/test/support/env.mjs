/**
 * The environment the built package runs in under node:test, with no browser
 * and no network. Import it BEFORE the package: @solana/web3.js captures
 * `globalThis.fetch` when its module is evaluated, so every Connection the
 * wallet makes (the store's own, from `setConfig`) sends its JSON-RPC through
 * the router installed here, as does the paymaster client (it calls the
 * global `fetch` at request time).
 *
 *   RPC_URL[...]               -> handlers.rpc(body)        (test/support/cluster.mjs)
 *   http://paymaster*.invalid/ -> handlers.paymaster(body)  (the mock paymaster)
 *   anything else              -> recorded as `unexpected` and refused
 *
 * The URLs end in `.invalid` (RFC 2606): a request that bypassed the router
 * could not resolve. Also a `window` with no DOM (the portal is scripted, see
 * ./wallet.mjs) and a `localStorage` kept in memory.
 */

export const RPC_URL = 'http://lazorkit-t0.devnet.invalid/';
export const PAYMASTER_URL = 'http://paymaster.lazorkit-t0.invalid/';
const PAYMASTER = /^http:\/\/paymaster[a-z0-9.-]*\.invalid\/$/;

export const state = {
  handlers: null,
  /** Requests to any other URL. Expected to stay empty. */
  unexpected: [],
};
/** Handlers by URL: a request still in flight from an earlier test (a retry) reaches that test's mock, not the current one. */
const routes = new Map();

/** The handlers for every request from now on, and for `urls` for good. */
export function setHandlers(handlers, urls = []) {
  state.handlers = handlers;
  for (const url of urls) routes.set(url, handlers);
}

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.href === 'string') return input.href;
  if (input && typeof input.url === 'string') return input.url;
  return String(input);
}

function headersOf(init) {
  const out = {};
  const h = init && init.headers;
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) {
    h.forEach((v, k) => (out[String(k).toLowerCase()] = String(v)));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  } else {
    for (const k of Object.keys(h)) out[k.toLowerCase()] = String(h[k]);
  }
  return out;
}

function respond(json, status = 200) {
  return new Response(typeof json === 'string' ? json : JSON.stringify(json), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function routedFetch(input, init) {
  const url = urlOf(input);
  const body = init && typeof init.body === 'string' ? init.body : init && init.body != null ? String(init.body) : '';
  const handlers = routes.get(url) ?? state.handlers;
  if (!handlers) throw new TypeError(`test fetch router: no handlers installed (request to ${url})`);
  if (PAYMASTER.test(url)) {
    const out = await handlers.paymaster(body, headersOf(init), url);
    return respond(out.json, out.status ?? 200);
  }
  if (url.startsWith(RPC_URL)) {
    const out = await handlers.rpc(body, headersOf(init));
    return respond(out.json, out.status ?? 200);
  }
  state.unexpected.push({ url, method: (init && init.method) || 'GET', bodyLength: body.length });
  throw new TypeError(`test fetch router: refused a request to ${url} (no network in tests)`);
}

globalThis.fetch = routedFetch;

// ── a browser without a DOM ─────────────────────────────────────────────

class MemoryStorage {
  #items = new Map();
  get length() {
    return this.#items.size;
  }
  key(i) {
    return [...this.#items.keys()][i] ?? null;
  }
  getItem(k) {
    return this.#items.has(String(k)) ? this.#items.get(String(k)) : null;
  }
  setItem(k, v) {
    this.#items.set(String(k), String(v));
  }
  removeItem(k) {
    this.#items.delete(String(k));
  }
  clear() {
    this.#items.clear();
  }
}

export const APP_ORIGIN = 'http://localhost:3000';
const storage = new MemoryStorage();
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('localStorage', storage);
define('window', {
  addEventListener() {},
  removeEventListener() {},
  location: { origin: APP_ORIGIN, href: `${APP_ORIGIN}/` },
  localStorage: storage,
});
