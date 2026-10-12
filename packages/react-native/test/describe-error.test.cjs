// describeError and sendStatusOf, through the built package (`pnpm build`
// first): the adapter's own errors (PortalCancelledError, the wallet chooser,
// "Already connecting"), every program error, a transaction that may have
// been sent ("Still checking…", never retryable). And parity with
// @lazorkit/wallet: the same source, and the same answer for the same error
// (its built /core entry, `pnpm --filter @lazorkit/wallet build` first, as CI
// does). The native modules the package loads are stubbed. Run with
// `pnpm test`.
'use strict';
const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const STUBS = {
  'react-native': {
    Platform: { OS: 'android', select: (options) => options.android ?? options.default },
    Linking: { addEventListener: () => ({ remove() {} }), openURL: async () => {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
    useColorScheme: () => 'light',
  },
  'expo-web-browser': {},
  'expo-crypto': {},
  'react-native-get-random-values': {},
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : load.call(this, request, ...rest);
};

const { Keypair, SendTransactionError } = require('@solana/web3.js');
const M = require('../dist/index.js');
const Web = require('../../react/dist/core.js');

const V2 = M.PROGRAM_ID_DEVNET.toBase58();
const INNER = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SIG = '5'.repeat(88);
const hex = (code) => `0x${code.toString(16)}`;
const logsFor = (code, first = V2, top = V2) => [
  `Program ${top} invoke [1]`,
  ...(first === top ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex(code)}`]),
  `Program ${top} failed: custom program error: ${hex(code)}`,
];
const web3Error = (code) =>
  new SendTransactionError({
    action: 'simulate',
    signature: '',
    transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex(code)}`,
    logs: logsFor(code),
  });
const paymasterSim = (code, first) =>
  new M.PaymasterError('Transaction simulation failed', { code: -32002, data: { logs: logsFor(code, first) } });
const kora = (code) => new M.PaymasterError(`Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`);
const landed = (code, logs) => new M.TransactionFailedError(SIG, { InstructionError: [0, { Custom: code }] }, 1, logs);

const PROGRAM_TITLES = {
  3006: 'Please approve again',
  3008: "Session length isn't allowed",
  3009: 'Session ended',
  3014: 'Approval expired',
  3023: 'Over the per-payment limit',
  3024: 'Spending limit reached',
  3030: 'Blocked to protect your wallet',
  3031: 'Blocked to protect your wallet',
  3032: 'Blocked to protect your wallet',
  3037: 'Needs your passkey',
  3038: 'Needs your passkey',
  4018: 'Wallet needs an upgrade',
};

function check(error, expected, label) {
  const d = M.describeError(error);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(d[key], value, `${label}: ${key} (${JSON.stringify(d)})`);
  assert.ok(d.title && d.message, `${label}: text`);
  if (d.maybeSent) assert.equal(d.retryable, false, `${label}: never retryable when it may have been sent`);
  return d;
}

test('the same source as @lazorkit/wallet, imports and indentation aside', () => {
  const body = (file) =>
    readFileSync(file, 'utf8')
      .replace(/^import[\s\S]*?;$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  assert.equal(
    body(path.join(__dirname, '../src/core/describeError.ts')),
    body(path.join(__dirname, '../../react/core/describeError.ts'))
  );
});

test('the 0xbc0 of a session refused for its length is 3008 InvalidSessionDuration', () => {
  for (const error of [web3Error(3008), paymasterSim(3008), kora(3008), landed(3008)]) {
    check(error, { code: 'program-3008', programError: 'InvalidSessionDuration', retryable: false, maybeSent: false }, '3008');
  }
});

test('every LazorKit program error maps, with the program\'s own name; an inner program\'s does not', () => {
  for (const code of Object.keys(M.ERROR_NAMES).map(Number)) {
    const expected = {
      code: code === 4018 ? 'v1-retired' : `program-${code}`,
      programError: M.ERROR_NAMES[code],
      maybeSent: false,
      ...(PROGRAM_TITLES[code] ? { title: PROGRAM_TITLES[code] } : {}),
    };
    check(paymasterSim(code), expected, `${code} logs`);
    check(landed(code, logsFor(code)), expected, `${code} landed`);
    if (code !== 3014) check(kora(code), expected, `${code} Kora`);
  }
  check(paymasterSim(3006, INNER), { code: 'tx-failed', programError: undefined }, 'inner 3006');
  check(kora(3014), { code: 'tx-failed' }, '3014 with no logs');
});

test('may have been sent: "Still checking…", never retryable', () => {
  const lost = new M.PaymasterError('Failed to sign and execute transaction', { maybeSent: true });
  for (const error of [
    lost,
    new M.TransactionOutcomeUnknownError('lost', undefined, lost),
    new M.ConfirmationTimeoutError(SIG, 120_000),
    new M.PaymasterError('failed', { data: { signature: SIG } }),
    new M.PaymasterError('later attempt', { maybeSent: true, data: { logs: logsFor(3037) } }),
  ]) {
    check(error, { code: 'outcome-unknown', title: 'Still checking…', retryable: false, maybeSent: true }, error.message);
    assert.equal(M.sendStatusOf(error), 'checking');
  }
});

test("the adapter's own errors", () => {
  check(new M.PortalCancelledError(), { code: 'user-rejected', title: 'Cancelled', retryable: true }, 'portal closed');
  check(new M.WalletConfirmationDeclinedError(), { code: 'user-rejected' }, 'none chosen');
  assert.equal(M.sendStatusOf(new M.PortalCancelledError()), 'cancelled');
  check(new M.WalletChooserNotShownError(), { code: 'wallet-chooser-not-shown', retryable: true }, 'chooser');
  check(new M.WalletNeedsConfirmationError('cred', []), { code: 'wallet-needs-confirmation' }, 'needs confirmation');
  check(new M.SigningError('Another passkey request is still in progress'), { code: 'busy' }, 'busy');
  check(new M.WalletConnectionError('Already connecting'), { code: 'busy' }, 'connecting');
  check(new M.SigningError('No wallet connected'), { code: 'not-connected' }, 'no wallet');
  check(new Error('Failed to open browser: locked'), { code: 'browser-failed', retryable: true }, 'browser');
  check(new M.TransactionExpiredError(SIG), { code: 'tx-expired', retryable: true }, 'expired');
  check(new M.PreviousTransactionPendingError(SIG), { code: 'previous-pending' }, 'pending');
  check(new M.SignatureReusedError(), { code: 'program-3006' }, '3006');
  check(new M.DeferredExpiredError(Keypair.generate().publicKey, SIG, 1n), { code: 'program-3014' }, '3014');
  check(new M.UnlistedSolOutflowError('session'), { code: 'program-3037' }, '3037');
  check(new M.UnlistedTokenOutflowError('session'), { code: 'program-3038' }, '3038');
  check(new M.V1WalletRetiredError(), { code: 'v1-retired' }, 'retired');
  check(new M.V1WalletMigratedError(), { code: 'v1-migrated' }, 'migrated');
  check(new M.TypedRequestTooLargeError(20_000, 16_384, 'URL'), { code: 'request-too-large' }, 'too large');
  check(new M.RequestOutOfDateError(), { code: 'request-out-of-date', retryable: true }, 'stale');
  check(new M.PortalReplyMismatchError('slot'), { code: 'portal-reply-mismatch' }, 'reply mismatch');
  check(new M.PortalRefusedError('wrong-network', 'x'), { code: 'wrong-network' }, 'wrong network');
  check(new M.PortalRefusedError('chain-unavailable', 'x'), { code: 'portal-chain-unavailable', retryable: true }, 'chain');
  check(new M.PaymasterError('Failed: Too Many Requests', { httpStatus: 429 }), { code: 'rate-limited' }, '429');
  check(new Error('RPC request timed out after 10000 ms'), { code: 'timeout' }, 'timeout');
  check(new TypeError('Network request failed: fetch failed'), { code: 'network' }, 'network');
  check(landed(1, ['Program log: Error: insufficient funds']), { code: 'insufficient-funds' }, 'funds');
  check(new Error('weird'), { code: 'unknown', retryable: false }, 'unknown');
  assert.equal(M.sendStatusOf(new Error('weird')), 'failed');
});

test('the same answer as @lazorkit/wallet for the same error', () => {
  const errors = [
    web3Error(3008),
    kora(3023),
    landed(3037, logsFor(3037)),
    paymasterSim(3006, INNER),
    new M.PaymasterError('lost', { maybeSent: true }),
    new M.ConfirmationTimeoutError(SIG, 1),
    new M.PortalCancelledError(),
    new M.PortalRefusedError('request-invalid', 'x'),
    new M.RequestOutOfDateError(),
    new M.TransactionExpiredError(SIG),
    new M.PaymasterError('x', { httpStatus: 429 }),
    new Error('Popup was blocked by browser'),
    new Error('weird'),
  ];
  for (const error of errors) {
    assert.deepEqual(M.describeError(error), Web.describeError(error), error.message);
    assert.equal(M.sendStatusOf(error), Web.sendStatusOf(error), error.message);
  }
});
