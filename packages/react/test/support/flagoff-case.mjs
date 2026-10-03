/**
 * One flag-off case through a built package, in a fresh process (no lane,
 * client or memo carried over from another case). Writes the record as JSON.
 *
 *   node test/support/flagoff-case.mjs <dist/index.mjs> '<case json>' <out.json>
 *
 * Run by ./flagoff.mjs; see test/flagoff.test.mjs. A case may also carry
 * `options` (the transaction options, instead of its variant's) and
 * `paymasterConfig`: test/txv1-send.test.mjs runs 'v1' requests this way.
 */
import { writeFileSync } from 'node:fs';
import { FAULTS, SLOT0, WEB_VARIANTS } from './corpus.mjs';
import { loadWallet, portal, router, runStep, setup } from './wallet.mjs';

const [dist, caseJson, outFile] = process.argv.slice(2);
const kase = JSON.parse(caseJson);

// The package logs its retries and errors; keep stdout for the record.
const consoleLines = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => consoleLines.push(`${level}: ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' ')}`);
}

const W = await loadWallet(dist);
const { corpus, chain, S } = setup(W, {
  fault: kase.fault ? FAULTS[kase.fault] : undefined,
  noFeeRecord: kase.noFeeRecord,
  paymasterConfig: kase.paymasterConfig,
  slot0: SLOT0,
});

const payload = corpus.payloads[kase.payload];
const transactionOptions = () => ({
  ...(kase.options ?? WEB_VARIANTS[kase.variant]),
  ...(payload.lookupTables.length ? { addressLookupTableAccounts: payload.lookupTables } : {}),
});
const send = () => ({ instructions: payload.instructions(), transactionOptions: transactionOptions() });

const steps = [];
const step = (call, fn, show) => runStep({ steps, call, fn, show, chain });
const sig = (v) => v;
switch (kase.flow) {
  case 'execute':
  case 'execute-register':
    await step('signAndSendTransaction', () => S().signAndSendTransaction(send()), sig);
    break;
  case 'execute-pair':
    await step('signAndSendTransaction', () => S().signAndSendTransaction(send()), sig);
    await step('signAndSendTransaction', () => S().signAndSendTransaction(send()), sig);
    break;
  case 'session':
    await step('signAndSendWithSession', () => S().signAndSendWithSession(send()), sig);
    break;
  case 'authority':
    await step('signAndSendWithAuthority', () => S().signAndSendWithAuthority(send()), sig);
    break;
  case 'authorizeAndExecute':
    await step('authorizeAndExecute', () => S().authorizeAndExecute(send()), sig);
    break;
  case 'deferred': {
    const a = await step('authorizeDeferred', () => S().authorizeDeferred(send()), (v) => ({ signature: v.signature, deferredPayload: v.deferredPayload }));
    if (a.ok) {
      await step('executeDeferred', () => S().executeDeferred({ deferredPayload: a.raw.deferredPayload, transactionOptions: transactionOptions() }), sig);
    }
    break;
  }
  default:
    throw new Error(`unknown flow ${kase.flow}`);
}

const out = {
  case: kase,
  steps: steps.map(({ raw, ...s }) => s),
  rpc: chain.rec.rpc,
  paymaster: chain.rec.paymaster,
  portal: portal.opens,
  diagnostics: { unexpectedRequests: router.unexpected, console: consoleLines },
};
// A file, not stdout: a pipe is written asynchronously, and exit would cut it short.
writeFileSync(outFile, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
process.exit(0);
