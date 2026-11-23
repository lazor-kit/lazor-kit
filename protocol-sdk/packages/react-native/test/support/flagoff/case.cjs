'use strict';
// One flag-off case through a built adapter, in a fresh process (no lane,
// client or memo carried over from another case), native modules stubbed,
// against the mock cluster. Prints the record as JSON:
//
//   node test/support/flagoff/case.cjs <dist/index.js> '<case json>'
//
// Run by ./flagoff.mjs; see test/flagoff.test.mjs. The fetch router must load
// before @solana/web3.js (see ./fetch-router.cjs).
const router = require('./fetch-router.cjs');
const stubs = require('./stubs.cjs');
const path = require('path');
const nodeCrypto = require('crypto');
const web3 = require('@solana/web3.js');
const sdk = require('@lazorkit/sdk-legacy');
const { p256 } = require('@noble/curves/p256');
const { ed25519 } = require('@noble/curves/ed25519');

const sha256 = (b) => nodeCrypto.createHash('sha256').update(b).digest();
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Fixed, so nothing in a redirect depends on the clock. */
const PORTAL_TIMESTAMP = '1759276800000';

async function main() {
  const [dist, caseJson] = process.argv.slice(2);
  const kase = JSON.parse(caseJson);
  const C = await import('./corpus.mjs');
  const { makeMockCluster } = await import('./ledger.mjs');
  const { recordConsole, errorRecord, runStep } = await import('./record.mjs');
  const consoleLines = recordConsole();
  const M = require(path.resolve(dist));

  const corpus = C.makeCorpus({ web3, sdk, p256 });
  const cluster = makeMockCluster({
    web3,
    sdk,
    ed25519,
    p256,
    corpus,
    accounts: corpus.initialAccounts({ noFeeRecord: kase.noFeeRecord }),
    fault: kase.fault ? C.FAULTS[kase.fault] : undefined,
  });
  router.setHandlers({ rpc: cluster.rpc, paymaster: cluster.paymaster });

  // The system browser opens the portal page (iOS: openAuthSessionAsync
  // resolves with the redirect), which signs with the corpus passkey.
  const portal = { opens: [], errors: [] };
  const webauthnGet = (challenge) => {
    const authData = Buffer.concat([sha256(Buffer.from(C.RP_ID, 'utf8')), Buffer.from([0x05]), Buffer.alloc(4)]);
    const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: C.PORTAL_ORIGIN, crossOrigin: false }));
    const msg = Buffer.concat([authData, sha256(cdj)]);
    const sig = Buffer.from(p256.sign(sha256(msg), corpus.passkey.priv, { lowS: true }).toCompactRawBytes());
    return { authData, cdj, msg, sig };
  };
  stubs.state.os = 'ios';
  stubs.state.browser = {
    async ios(url) {
      const u = new URL(url);
      const params = Object.fromEntries(u.searchParams.entries());
      portal.opens.push({ action: params.action, base: `${u.origin}${u.pathname}`, params });
      if (params.action !== 'sign') {
        portal.errors.push(`unexpected portal action ${params.action}`);
        return { type: 'cancel' };
      }
      if (params.credentialId !== corpus.passkey.credentialId) portal.errors.push(`asked to sign with ${params.credentialId}`);
      const a = webauthnGet(b64urlDecode(params.message));
      const r = new URL(params.redirect_url);
      r.searchParams.set('success', 'true');
      r.searchParams.set('signature', a.sig.toString('base64'));
      r.searchParams.set('msg', a.msg.toString('base64'));
      r.searchParams.set('message', params.message);
      r.searchParams.set('credentialId', corpus.passkey.credentialId);
      r.searchParams.set('clientDataJSONReturn', a.cdj.toString('base64'));
      r.searchParams.set('authenticatorDataReturn', a.authData.toString('base64'));
      r.searchParams.set('expo', 'lazorverify');
      r.searchParams.set('timestamp', PORTAL_TIMESTAMP);
      r.searchParams.set('environment', 'browser');
      r.searchParams.set('platform', 'ios');
      r.searchParams.set('type', 'SIGNATURE_CREATED');
      return { type: 'success', url: r.toString() };
    },
    async android() {
      throw new Error('the Android browser path is not used here');
    },
  };

  // Let the persisted store hydrate (empty storage) before configuring it.
  await new Promise((r) => setTimeout(r, 20));
  const store = M.useWalletStore;
  const S = () => store.getState();
  S().setConfig({
    portalUrl: C.PORTAL_URL,
    configPaymaster: { paymasterUrl: router.PAYMASTER_URL },
    rpcUrl: router.RPC_URL,
    cluster: 'devnet',
    rpId: C.RP_ID,
    onConfirmWallet: 'builtin',
    trustedAuthorities: [],
    watchMints: [],
  });
  store.setState({ wallet: corpus.mobileWalletInfo });

  const payload = corpus.payloads[kase.payload];
  const transactionOptions = () => ({
    // `options` replaces the variant's (the txv1 tests' 'v1' requests).
    ...(kase.options ?? C.MOBILE_VARIANTS[kase.variant]),
    ...(payload.lookupTables.length ? { addressLookupTableAccounts: payload.lookupTables } : {}),
  });
  const send = () => ({ instructions: payload.instructions(), transactionOptions: transactionOptions() });
  const redirect = { redirectUrl: C.MOBILE_REDIRECT };

  const steps = [];
  const step = (call, fn, show) => runStep({ steps, call, fn, show, cluster, portal });
  const sig = (v) => v;
  switch (kase.flow) {
    case 'execute':
    case 'execute-register':
      await step('signAndExecuteTransaction', () => S().signAndExecuteTransaction(send(), redirect), sig);
      break;
    case 'execute-pair':
      await step('signAndExecuteTransaction', () => S().signAndExecuteTransaction(send(), redirect), sig);
      await step('signAndExecuteTransaction', () => S().signAndExecuteTransaction(send(), redirect), sig);
      break;
    case 'transferSol':
      await step('transferSol', () => S().transferSol({ recipient: corpus.recipient, lamports: 1_000_000, transactionOptions: transactionOptions() }, redirect), sig);
      break;
    case 'session':
      await step(
        'signAndSendWithSession',
        () => S().signAndSendWithSession({ sessionKeypair: corpus.sessionKey, sessionPda: corpus.sessionPda, ...send() }, {}),
        sig,
      );
      break;
    case 'authorizeAndExecute':
      await step('authorizeAndExecute', () => S().authorizeAndExecute(send(), redirect), sig);
      break;
    case 'deferred': {
      const a = await step('authorizeDeferred', () => S().authorizeDeferred(send(), redirect), (v) => ({
        signature: v.signature,
        deferredPayload: sdk.serializeDeferredPayload(v.deferredPayload),
        deferredExecPda: v.deferredExecPda.toBase58(),
        counter: v.counter,
      }));
      if (a.ok) {
        await step('executeDeferred', () => S().executeDeferred({ deferredPayload: a.raw.deferredPayload, transactionOptions: transactionOptions() }, {}), sig);
      }
      break;
    }
    default:
      throw new Error(`unknown flow ${kase.flow}`);
  }

  const authority = cluster.ledger.accounts.get(corpus.authorityPda.toBase58());
  const out = {
    case: kase,
    steps: steps.map(({ raw, ...s }) => s),
    rpc: cluster.rec.rpc,
    paymaster: cluster.rec.paymaster,
    portal: portal.opens,
    sends: cluster.rec.sends,
    diagnostics: {
      unexpectedRequests: router.state.unexpected,
      portalErrors: portal.errors,
      ledgerEnd: { slot: cluster.ledger.slot, authorityCounter: authority.data.readUInt32LE(8) },
      storeAfter: { isSigning: S().isSigning, error: S().error ? errorRecord(S().error) : null },
      console: consoleLines,
    },
  };
  // Exit only once it is written: a pipe is asynchronous on macOS, and an
  // exit right after `write` would cut the record at the pipe's buffer.
  await new Promise((resolve) => process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)), resolve));
}

main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(`flag-off case runner failed: ${e?.stack ?? e}\n`);
    process.exit(2);
  },
);
