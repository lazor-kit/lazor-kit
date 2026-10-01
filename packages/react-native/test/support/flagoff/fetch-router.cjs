'use strict';
/**
 * The flag-off check's fetch router. Loaded FIRST in every case process,
 * before @solana/web3.js: web3.js 1.99 captures `globalThis.fetch` when its module is evaluated, so
 * every Connection the wallet makes (the store's own, from `setConfig`) sends
 * its JSON-RPC through here, as does the paymaster client (it calls the global
 * `fetch` at request time).
 *
 *   RPC_URL       -> handlers.rpc(body)        (the mock ledger, ./ledger.mjs)
 *   PAYMASTER_URL -> handlers.paymaster(body)  (the mock paymaster)
 *   anything else -> recorded as `unexpected` and refused (no network, ever)
 *
 * The URLs end in `.invalid` (RFC 2606): even a request that bypassed this
 * router could not resolve, let alone reach a real cluster.
 *
 * Dependency-free on purpose (it must not load web3.js itself).
 */
const RPC_URL = 'http://lazorkit-t0.devnet.invalid/';
const PAYMASTER_URL = 'http://paymaster.lazorkit-t0.invalid/';

const state = {
  handlers: null,
  /** Requests to any other URL. Expected to stay empty. */
  unexpected: [],
};

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
  if (!state.handlers) throw new TypeError(`flagoff fetch router: no handlers installed (request to ${url})`);
  if (url === PAYMASTER_URL) {
    const out = await state.handlers.paymaster(body, headersOf(init));
    return respond(out.json, out.status ?? 200);
  }
  if (url.startsWith(RPC_URL)) {
    const out = await state.handlers.rpc(body, headersOf(init));
    return respond(out.json, out.status ?? 200);
  }
  state.unexpected.push({ url, method: (init && init.method) || 'GET', bodyLength: body.length });
  throw new TypeError(`flagoff fetch router: refused a request to ${url} (no network here)`);
}

globalThis.fetch = routedFetch;

module.exports = {
  RPC_URL,
  PAYMASTER_URL,
  state,
  setHandlers(handlers) {
    state.handlers = handlers;
  },
};
