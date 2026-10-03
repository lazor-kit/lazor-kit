/**
 * Drives the built package (dist/index.mjs) through its store, against the
 * mock cluster (./cluster.mjs), with a scripted portal: `openSign` answers
 * with a WebAuthn assertion from the corpus passkey, as the portal would.
 * Import ./env.mjs before the package; `loadWallet` does.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PAYMASTER_URL, RPC_URL, setHandlers, state as router } from './env.mjs';
import { APP_ORIGIN, PORTAL_ORIGIN, PORTAL_URL, RP_ID, SLOT0, makeCorpus } from './corpus.mjs';
import { makeMockCluster } from './cluster.mjs';

const require = createRequire(import.meta.url);
export const web3 = require('@solana/web3.js');
export const sdk = require('@lazorkit/sdk-legacy');
const { p256 } = require('@noble/curves/p256');
const { ed25519 } = require('@noble/curves/ed25519');
let bs58;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

export { PAYMASTER_URL, RPC_URL, router };

/** The package at `dist` (a path), with its portal scripted. */
export async function loadWallet(dist) {
  bs58 ??= (await import('bs58')).default;
  const W = await import(pathToFileURL(dist).href);
  scriptPortal(W);
  return W;
}

// ── the portal ──────────────────────────────────────────────────────────

/** What the scripted portal does: the pages it was opened on, and how the next assertion is padded. */
export const portal = {
  passkey: null,
  /** Every sign page opened: { action, params }, params as the portal's URL carries them. */
  opens: [],
  /** Extra bytes in the next clientDataJSON (Chrome adds a field of its own), or 0. */
  clientDataPadding: 0,
  /** Runs while the user is "approving", before the portal answers. */
  whileOpen: null,
};

/** navigator.credentials.get() as Chrome answers it inside the portal iframe. */
export function assertion(passkey, challengeBytes, padding = 0) {
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(sha256(Buffer.from(RP_ID)), 0);
  authenticatorData[32] = 0x05; // UP | UV
  const fields = { type: 'webauthn.get', challenge: b64url(challengeBytes), origin: PORTAL_ORIGIN, crossOrigin: true, topOrigin: APP_ORIGIN };
  if (padding > 0) fields.other_keys_can_be_added_here = 'x'.repeat(padding);
  const clientDataJson = Buffer.from(JSON.stringify(fields));
  const message = Buffer.concat([authenticatorData, sha256(clientDataJson)]);
  const sig = p256.sign(sha256(message), passkey.priv, { lowS: true });
  return {
    normalized: b64(sig.toCompactRawBytes()),
    authenticatorDataReturn: b64(authenticatorData),
    clientDataJSONReturn: b64(clientDataJson),
  };
}

function scriptPortal(W) {
  const proto = W.DialogManager.prototype;
  proto.openSign = async function openSign(message, transaction, credentialId, clusterSimulation) {
    const params = { action: 'sign', message, transaction, credentialId, ...(clusterSimulation ? { clusterSimulation } : {}) };
    portal.opens.push({ action: 'sign', params });
    if (!portal.passkey || credentialId !== portal.passkey.credentialId) throw new Error(`scripted portal: asked to sign with ${credentialId}`);
    await portal.whileOpen?.();
    const reply = assertion(portal.passkey, fromB64url(message), portal.clientDataPadding);
    return {
      signature: reply.normalized,
      clientDataJsonBase64: reply.clientDataJSONReturn,
      authenticatorDataBase64: reply.authenticatorDataReturn,
      signedPayload: message,
      credentialId,
    };
  };
  proto.destroy = function destroy() {};
}

// ── a case ──────────────────────────────────────────────────────────────

let nextSlot0 = SLOT0;
let cases = 0;

/**
 * A fresh ledger, paymaster and store for one test: the connected corpus
 * wallet, its stored session and Ed25519 authority keys.
 *
 * - `slot0`: the ledger's first slot. In one process the wallet's passkey
 *   lane remembers the last landed slot, so by default each setup starts
 *   past every earlier one; a fresh process (the flag-off cases) uses SLOT0.
 * - `paymasterConfig`: merged into `{ paymasterUrl }` (e.g. `acceptsTxV1`).
 * - `programId` / `cluster`: the corpus program and the cluster the RPC URL
 *   is registered as (devnet v2 by default).
 *
 * Without `slot0`, the RPC URL is the test's own (RPC_URL + a suffix), so a
 * request an earlier test left in flight (web3.js retrying a 429) still
 * reaches that test's mock.
 */
export function setup(W, { paymasterUrl = PAYMASTER_URL, paymasterConfig = {}, programId, cluster = 'devnet', fault, txV1, noFeeRecord, slot0 } = {}) {
  localStorage.clear();
  const first = slot0 ?? nextSlot0;
  const corpus = makeCorpus({ web3, sdk, p256, ...(programId ? { programId } : {}) });
  const chain = makeMockCluster({
    web3,
    sdk,
    bs58,
    ed25519,
    p256,
    corpus,
    accounts: corpus.initialAccounts({ noFeeRecord }),
    fault,
    txV1,
    slot0: first,
  });
  const rpcUrl = slot0 === undefined ? `${RPC_URL}case-${++cases}` : RPC_URL;
  setHandlers({ rpc: chain.rpc, paymaster: chain.paymaster }, [rpcUrl]);
  portal.passkey = corpus.passkey;
  portal.opens = [];
  portal.clientDataPadding = 0;
  portal.whileOpen = null;
  const store = W.useWalletStore;
  store.getState().setConfig({ portalUrl: PORTAL_URL, paymasterConfig: { paymasterUrl, ...paymasterConfig }, rpcUrl, cluster });
  store.setState({ wallet: corpus.webWalletInfo, isSigning: false, error: null });
  localStorage.setItem('lazorkit-session', JSON.stringify(corpus.webSessionStorage));
  localStorage.setItem('lazorkit-authority', JSON.stringify(corpus.webAuthorityStorage));
  const S = () => store.getState();
  return {
    corpus,
    chain,
    S,
    /** Ends the test's ledger: the next setup starts past it. */
    done() {
      nextSlot0 = Math.max(nextSlot0, chain.ledger.slot + 1_000);
    },
  };
}

// ── recording ───────────────────────────────────────────────────────────

const STEP_TIMEOUT_MS = 90_000;

/** What an error says, field by field (no stack: paths differ between machines). */
export function errorRecord(e, depth = 0) {
  if (e === null || e === undefined) return null;
  if (!(e instanceof Error) && typeof e !== 'object') return { thrown: String(e) };
  const out = {
    name: e.name ?? null,
    constructor: e.constructor?.name ?? null,
    message: typeof e.message === 'string' ? e.message : String(e),
  };
  for (const k of ['code', 'httpStatus', 'signature', 'maybeSent', 'stage', 'pendingSignature', 'authorizeSignature', 'slot']) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  if (e.data !== undefined) out.data = e.data;
  if (e.logs !== undefined) out.logs = e.logs;
  if (e.transactionError !== undefined) out.transactionError = e.transactionError;
  if (e.deferredExecPda !== undefined) out.deferredExecPda = e.deferredExecPda?.toBase58?.() ?? String(e.deferredExecPda);
  if (e.expiresAtSlot !== undefined) out.expiresAtSlot = String(e.expiresAtSlot);
  if (e instanceof RangeError) out.isRangeError = true;
  if (e.cause !== undefined && depth < 2) out.cause = errorRecord(e.cause, depth + 1);
  return out;
}

/** Run one wallet call and note which requests and portal opens belong to it. */
export async function runStep({ steps, call, fn, show, chain }) {
  const at = () => ({ rpc: chain.rec.rpc.length, paymaster: chain.rec.paymaster.length, portal: portal.opens.length, sends: chain.rec.sends.length });
  const from = at();
  const record = { call };
  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${call} did not settle within ${STEP_TIMEOUT_MS} ms`), { name: 'StepTimeout' })), STEP_TIMEOUT_MS);
      }),
    ]);
    record.ok = true;
    record.raw = value;
    record.value = show(value);
  } catch (error) {
    record.ok = false;
    record.error = errorRecord(error);
    record.raw = error;
  } finally {
    clearTimeout(timer);
  }
  const to = at();
  record.ranges = Object.fromEntries(Object.keys(from).map((k) => [k, [from[k], to[k]]]));
  steps.push(record);
  return record;
}
