// What a session or delegate key may spend, through the built package (`pnpm
// build` first). Under LazorKit v2 a policy names what may leave the vault,
// and nothing it does not name may (D13): SOL only with a Sol* action
// (ActionUnlistedSolOutflow, 3037), a token only with a Token* action naming
// its mint (ActionUnlistedTokenOutflow, 3038).
//
// Checked: the actions a `SpendingLimits` preset stands for, as the program
// reads them, with one entry per mint; the presets it refuses before anything
// is read or prompted, those that do not fit in the transaction included; the
// refusals as `UnlistedSolOutflowError` / `UnlistedTokenOutflowError` (from
// either copy of the package, wrapped or raw) and as a session or delegate
// send reports them, not resent; an Admin key's, and one whose outcome is not
// known, as they came; the error names. A scripted RPC and paymaster, no
// network. Run with `pnpm test`.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram } from '@solana/web3.js';
import { WalletSendTransactionError } from '@solana/wallet-adapter-base';

// Node 18 has WebCrypto, but not as a global.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => void storage.set(key, String(value)),
    removeItem: (key) => void storage.delete(key),
};

const require = createRequire(import.meta.url);
const W = await import('../dist/index.mjs');
// The CJS build is a second copy of every class: `instanceof` fails between the two.
const W2 = require('../dist/index.js');
// The protocol SDK's own builders and parser: what the program reads.
const { Actions, SessionActionType, parseActions, serializeActions } = require('@lazorkit/sdk-legacy');
const { MAX_PASSKEY_SESSION_ACTIONS_BYTES } = require('@lazorkit/sdk-legacy/approval');

const fixed = (byte) => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey;
const USDC = fixed(21);
const BONK = fixed(22);
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const V2 = W.PROGRAM_ID_DEVNET.toBase58();
const INNER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ─── The preset ─────────────────────────────────────────────────────────────

test('SpendingLimits names SOL and each listed mint: the actions, as the program reads them', () => {
    const parsed = (limits) =>
        parseActions(serializeActions(W.spendingLimitsToActions(limits))).map(
            ({ type, limit, windowSeconds, spent, lastReset, mint, expiresAt }) => ({
                type,
                limit,
                windowSeconds,
                spent,
                lastReset,
                mint: mint?.toBase58(),
                expiresAt,
            }),
        );
    const row = (type, limit, mint, windowSeconds) => ({
        type,
        limit,
        windowSeconds,
        spent: windowSeconds === undefined ? undefined : 0n,
        lastReset: windowSeconds === undefined ? undefined : 0n,
        mint: mint?.toBase58(),
        expiresAt: 0n,
    });
    assert.deepEqual(
        parsed({
            solLifetimeCap: 9_000_000n,
            solPerTxMax: 1_000_000n,
            solRecurring: { limit: 2_000_000n, windowSeconds: 86_400n },
            tokens: [
                // Within 224 bytes: a per-transaction limit for USDC too would be 234.
                { mint: USDC, lifetimeCap: 50_000_000n },
                { mint: BONK.toBase58(), perTxMax: 7n },
            ],
        }),
        [
            row(SessionActionType.SolLimit, 9_000_000n),
            row(SessionActionType.SolMaxPerTx, 1_000_000n),
            row(SessionActionType.SolRecurringLimit, 2_000_000n, undefined, 86_400n),
            row(SessionActionType.TokenLimit, 50_000_000n, USDC),
            row(SessionActionType.TokenMaxPerTx, 7n, BONK),
        ],
    );
    // All three limits on one mint (all of them on each of two mints do not fit: see below).
    assert.deepEqual(
        parsed({ tokens: [{ mint: USDC, lifetimeCap: 50_000_000n, perTxMax: 5_000_000n, recurring: { limit: 10_000_000n, windowSeconds: 3_600n } }] }),
        [
            row(SessionActionType.TokenLimit, 50_000_000n, USDC),
            row(SessionActionType.TokenMaxPerTx, 5_000_000n, USDC),
            row(SessionActionType.TokenRecurringLimit, 10_000_000n, USDC, 3_600n),
        ],
    );
});

test('a token limit is encoded as the program lays it out: type, data length, expiry 0, mint, amount', () => {
    const [action] = W.spendingLimitsToActions({ tokens: [{ mint: USDC, perTxMax: 0x0102030405060708n }] });
    const bytes = Buffer.from(serializeActions([action]));
    const expected = Buffer.concat([
        Buffer.from([SessionActionType.TokenMaxPerTx, 40, 0]),
        Buffer.alloc(8),
        USDC.toBuffer(),
        Buffer.from('0807060504030201', 'hex'),
    ]);
    assert.deepEqual(bytes, expected);
    // The same bytes the protocol SDK's own builder gives.
    assert.deepEqual(bytes, Buffer.from(serializeActions([Actions.tokenMaxPerTx({ mint: USDC, max: 0x0102030405060708n })])));
});

test('SOL limits alone name no token, and token limits alone name no SOL: nothing is granted that was not asked for', () => {
    const solOnly = W.spendingLimitsToActions({ solPerTxMax: 1_000_000n });
    assert.deepEqual(solOnly.map((a) => a.type), [SessionActionType.SolMaxPerTx]);

    const tokensOnly = W.spendingLimitsToActions({ tokens: [{ mint: USDC, perTxMax: 1n }, { mint: WSOL, lifetimeCap: 2n }] });
    assert.deepEqual(tokensOnly.map((a) => a.type), [SessionActionType.TokenMaxPerTx, SessionActionType.TokenLimit]);
    // wSOL is a mint like any other.
    assert.equal(tokensOnly[1].mint.toBase58(), WSOL.toBase58());

    assert.deepEqual(W.spendingLimitsToActions({}), []);
    assert.deepEqual(W.spendingLimitsToActions({ tokens: [] }), []);
    assert.deepEqual(W.spendingLimitsToActions(undefined), []);
});

test('the presets the program would refuse, or that name nothing, are refused', () => {
    const refused = [
        [{ tokens: [{ mint: USDC }] }, /tokens\[0\] \(mint .*\) has no limit/],
        [{ tokens: [{ mint: 'not a mint', perTxMax: 1n }] }, /tokens\[0\]\.mint must be the token's mint address/],
        [{ tokens: [{ perTxMax: 1n }] }, /tokens\[0\]\.mint must be the token's mint address/],
        [{ tokens: [{ mint: USDC, perTxMax: 1n }, { mint: USDC.toBase58(), lifetimeCap: 2n }] }, /names mint .* twice/],
        [{ tokens: [{ mint: USDC, perTxMax: -1n }] }, /tokens\[0\]\.perTxMax must be a bigint from 0 to 2\^64 - 1/],
        [{ tokens: [{ mint: USDC, lifetimeCap: 1n << 64n }] }, /tokens\[0\]\.lifetimeCap must be a bigint/],
        [{ tokens: [{ mint: USDC, perTxMax: 5 }] }, /tokens\[0\]\.perTxMax must be a bigint/],
        [{ tokens: [{ mint: USDC, recurring: { limit: 1n, windowSeconds: 0n } }] }, /tokens\[0\]\.recurring\.windowSeconds must be at least 1 second/],
        [{ solRecurring: { limit: 1n, windowSeconds: 0n } }, /solRecurring\.windowSeconds must be at least 1 second/],
        // A window written for the releases that counted slots is refused, never read as seconds.
        [{ solRecurring: { limit: 1n, windowSlots: 216_000n } }, /solRecurring\.windowSlots is no longer read: .* Pass windowSeconds/],
        [{ tokens: [{ mint: USDC, recurring: { limit: 1n, windowSlots: 9_000n } }] }, /tokens\[0\]\.recurring\.windowSlots is no longer read/],
        [{ solRecurring: { limit: 1n } }, /solRecurring\.windowSeconds must be a bigint/],
        [{ solPerTxMax: 1 }, /solPerTxMax must be a bigint/],
    ];
    for (const [limits, message] of refused) {
        assert.throws(() => W.spendingLimitsToActions(limits), message, JSON.stringify(limits, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
    }

    // A policy holds at most 16 actions.
    const mints = (n) => Array.from({ length: n }, (_, i) => ({ mint: fixed(100 + i), perTxMax: 1n }));
    const sol = { solLifetimeCap: 1n, solPerTxMax: 1n, solRecurring: { limit: 1n, windowSeconds: 1n } };
    assert.throws(() => W.spendingLimitsToActions({ ...sol, tokens: mints(14) }), /makes 17 actions; a policy holds at most 16/);
});

test("the actions must fit in the transaction that registers them, beside the passkey's response: 224 bytes at most", () => {
    const window = { limit: 1n, windowSeconds: 1n };
    // solRecurring (43 bytes), a lifetimeCap and a recurring limit (51 + 75), and a perTxMax (51): 220 bytes.
    const largest = {
        solRecurring: window,
        tokens: [
            { mint: USDC, lifetimeCap: 1n, recurring: window },
            { mint: BONK, perTxMax: 1n },
        ],
    };
    assert.equal(serializeActions(W.spendingLimitsToActions(largest)).length, 220);
    // solPerTxMax is 19 bytes more.
    assert.throws(
        () => W.spendingLimitsToActions({ ...largest, solPerTxMax: 1n }),
        /spendingLimits makes 239 bytes of actions; at most 224 fit/,
    );
    // What @lazorkit/sdk-legacy's prepareCreateSession takes with a typed request, no more.
    assert.equal(MAX_PASSKEY_SESSION_ACTIONS_BYTES, 224);

    // The README's shape (solPerTxMax, and perTxMax and lifetimeCap for each mint): 2 mints fit, 3 do not.
    const mints = (n, limits) => Array.from({ length: n }, (_, i) => ({ mint: fixed(100 + i), ...limits }));
    const readme = (n) => ({ solPerTxMax: 1n, tokens: mints(n, { perTxMax: 1n, lifetimeCap: 1n }) });
    assert.equal(W.spendingLimitsToActions(readme(2)).length, 5);
    assert.throws(() => W.spendingLimitsToActions(readme(3)), /makes 325 bytes of actions/);
    // One perTxMax for each mint: 4 fit beside solPerTxMax, 5 do not.
    assert.equal(W.spendingLimitsToActions({ solPerTxMax: 1n, tokens: mints(4, { perTxMax: 1n }) }).length, 5);
    assert.throws(() => W.spendingLimitsToActions({ solPerTxMax: 1n, tokens: mints(5, { perTxMax: 1n }) }), /makes 274 bytes/);
});

// ─── The refusals ───────────────────────────────────────────────────────────

const hex = { 3023: '0xbcf', 3037: '0xbdd', 3038: '0xbde' };
/** Logs of a failed instruction: `first` failed first (an inner program, or LazorKit itself). */
const logsFor = (code, first) => [
    `Program ${V2} invoke [1]`,
    ...(first === V2 ? [] : [`Program ${first} invoke [2]`, `Program ${first} failed: custom program error: ${hex[code]}`]),
    `Program ${V2} failed: custom program error: ${hex[code]}`,
];
const web3Error = (code, first) =>
    new SendTransactionError({
        action: 'simulate',
        signature: '',
        transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex[code]}`,
        logs: logsFor(code, first),
    });
const korasText = (code) => `Invalid transaction: Transaction simulation failed: InstructionError(0, Custom(${code}))`;
const wrap = (error) => new WalletSendTransactionError(error.message, error);

test('UnlistedSolOutflowError and UnlistedTokenOutflowError: plain messages, the program codes, recognised from either copy and wrapped', () => {
    const sol = new W.UnlistedSolOutflowError('session');
    assert.equal(sol.message, 'This session is not allowed to spend SOL');
    assert.equal(sol.name, 'UnlistedSolOutflowError');
    assert.equal(sol.code, 3037);
    assert.equal(W.UNLISTED_SOL_OUTFLOW_CODE, 3037);
    assert.equal(new W.UnlistedSolOutflowError('authority').message, 'This key is not allowed to spend SOL');

    const token = new W.UnlistedTokenOutflowError('session');
    assert.equal(token.message, 'This session is not allowed to spend this token');
    assert.equal(token.name, 'UnlistedTokenOutflowError');
    assert.equal(token.code, 3038);
    assert.equal(W.UNLISTED_TOKEN_OUTFLOW_CODE, 3038);
    assert.equal(new W.UnlistedTokenOutflowError('authority').message, 'This key is not allowed to spend this token');

    for (const [is, own, copy] of [
        [W.isUnlistedSolOutflowError, sol, new W2.UnlistedSolOutflowError()],
        [W.isUnlistedTokenOutflowError, token, new W2.UnlistedTokenOutflowError()],
    ]) {
        assert.ok(!(copy instanceof own.constructor));
        assert.equal(is(own), true);
        assert.equal(is(copy), true);
        assert.equal(is(wrap(own)), true);
        assert.equal(is(new Error('wrapped', { cause: copy })), true);
        // An error that only shares the name is not one.
        assert.equal(is(Object.assign(new Error('x'), { name: own.name })), false);
    }
    // Neither is the other.
    assert.equal(W.isUnlistedSolOutflowError(token), false);
    assert.equal(W.isUnlistedTokenOutflowError(sol), false);
});

test('the raw 3037 / 3038: the logs decide whose it is, and one with no logs counts as LazorKit\'s', () => {
    for (const [code, is, other] of [
        [3037, W.isUnlistedSolOutflowError, W.isUnlistedTokenOutflowError],
        [3038, W.isUnlistedTokenOutflowError, W.isUnlistedSolOutflowError],
    ]) {
        assert.equal(is(web3Error(code, V2)), true, `${code} LazorKit's`);
        assert.equal(is(web3Error(code, INNER)), false, `${code} an inner program's`);
        assert.equal(is(wrap(web3Error(code, INNER))), false);
        assert.equal(is(new W.PaymasterError(korasText(code), { code: -32602 })), true);
        assert.equal(is({ InstructionError: [0, { Custom: code }] }), true);
        assert.equal(is(new W.TransactionFailedError('5'.repeat(88), { InstructionError: [0, { Custom: code }] }, 1)), true);
        assert.equal(is(new Error(`custom program error: ${hex[code]}`)), true);
        assert.equal(other(web3Error(code, V2)), false);
    }
    assert.equal(W.isUnlistedSolOutflowError(new Error('custom program error: 0xbdc')), false);
    assert.equal(W.isUnlistedSolOutflowError(undefined), false);
    assert.equal(W.isUnlistedTokenOutflowError(null), false);
});

test('ERROR_NAMES and errorFromCode name 3036-3038 and 4018, and keep the protocol SDK\'s names', () => {
    for (const L of [W, W2]) {
        assert.equal(L.ERROR_NAMES[3036], 'SessionNotExpired');
        assert.equal(L.ERROR_NAMES[3037], 'ActionUnlistedSolOutflow');
        assert.equal(L.ERROR_NAMES[3038], 'ActionUnlistedTokenOutflow');
        assert.equal(L.ERROR_NAMES[4018], 'RetiredDeployment');
        assert.equal(L.errorFromCode(3037), 'ActionUnlistedSolOutflow');
        assert.equal(L.errorFromCode(3038), 'ActionUnlistedTokenOutflow');
        assert.equal(L.errorFromCode(3032), 'SessionTokenAuthorityChanged');
        assert.equal(L.errorFromCode(3035), 'PolicyRankMismatch');
        assert.equal(L.errorFromCode(3006), 'SignatureReused');
        assert.equal(L.errorFromCode(1), undefined);
    }
});

// ─── Through the store ──────────────────────────────────────────────────────

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const FEE_PAYER = fixed(7);
const WALLET = fixed(11);
const RECIPIENT = fixed(13);
const PROGRAM = W.PROGRAM_ID_DEVNET;

/** Accounts that exist: address → owner. */
const accounts = new Map();
/** RPC and paymaster requests made, of any kind. */
let requests = 0;
/** How a landed transaction ended: `null`, or its TransactionError. */
let landedErr = null;
/** The paymaster's JSON-RPC error for a send, or `null` to send it. */
let refusal = null;
/** The first send's answer is lost: the request fails once it may have reached the paymaster. */
let firstAnswerLost = false;
let sends = 0;

const rpcFetch = async (_url, init) => {
    requests++;
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    if (method === 'getLatestBlockhash') {
        return reply({ context: { slot: 1 }, value: { blockhash: fixed(9).toBase58(), lastValidBlockHeight: 1e9 } });
    }
    if (method === 'getSlot') return reply(1000);
    if (method === 'getAccountInfo') {
        const owner = accounts.get(params[0]);
        return reply({
            context: { slot: 1 },
            value: owner ? { data: ['', 'base64'], executable: false, lamports: 1_000_000, owner, rentEpoch: 0, space: 0 } : null,
        });
    }
    if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
    if (method === 'getSignatureStatuses') {
        return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 600, confirmations: 1, err: landedErr, confirmationStatus: 'confirmed' })) });
    }
    throw new Error(`unscripted RPC ${method}`);
};
globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), PAYMASTER);
    const { id, method } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: FEE_PAYER.toBase58() } });
    if (method === 'signAndSendTransaction') {
        sends++;
        if (firstAnswerLost && sends === 1) throw new TypeError('fetch failed: the connection was reset');
        if (refusal) return answer({ error: refusal });
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
};
// The paymaster logs each failed attempt; keep the output to the assertions.
console.error = () => {};
console.info = () => {};
console.warn = () => {};

const store = W.useWalletStore;
W.registerCluster(RPC, 'devnet');

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    storage.clear();
    accounts.clear();
    requests = 0;
    sends = 0;
    landedErr = null;
    refusal = null;
    firstAnswerLost = false;
    store.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true }),
        config: { portalUrl: 'http://portal.test', paymasterConfig: { paymasterUrl: PAYMASTER }, rpcUrl: RPC, cluster: 'devnet' },
        wallet: {
            credentialId: Buffer.from('a passkey').toString('base64'),
            passkeyPubkey: [2, ...new Array(32).fill(1)],
            smartWallet: WALLET.toBase58(),
            walletDevice: '',
            platform: 'web',
            expo: '',
            protocolVersion: 2,
        },
        isSigning: false,
        error: null,
    });
});

/** A session key kept for WALLET (as an earlier release left it; it moves on first use). */
function keptSession() {
    const key = Keypair.generate();
    const sessionPda = W.findSessionPda(WALLET, key.publicKey.toBytes(), PROGRAM)[0];
    accounts.set(sessionPda.toBase58(), PROGRAM.toBase58());
    storage.set(
        'lazorkit-session',
        JSON.stringify({
            secretKey: Array.from(key.secretKey),
            publicKey: key.publicKey.toBase58(),
            sessionPda: sessionPda.toBase58(),
            walletPda: WALLET.toBase58(),
            expiresAt: '900000',
        }),
    );
}

/** An authority key kept for WALLET, as `keptSession`: a delegate's, unless `role` says otherwise. */
function keptAuthority(role = W.ROLE_SPENDER) {
    const key = Keypair.generate();
    const authorityPda = W.findAuthorityPda(WALLET, key.publicKey.toBytes(), PROGRAM)[0];
    accounts.set(authorityPda.toBase58(), PROGRAM.toBase58());
    storage.set(
        'lazorkit-authority',
        JSON.stringify({
            secretKey: Array.from(key.secretKey),
            publicKey: key.publicKey.toBase58(),
            authorityPda: authorityPda.toBase58(),
            walletPda: WALLET.toBase58(),
            role,
        }),
    );
}

const transfer = () => [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: RECIPIENT, lamports: 1000 })];

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('resolved');
}

test('createSession refuses a preset that names a mint with no limit, or does not fit, before anything is read or prompted', async () => {
    for (const spendingLimits of [
        { solPerTxMax: 1n, tokens: [{ mint: USDC }] },
        { tokens: [{ mint: USDC, perTxMax: 1n }, { mint: USDC, perTxMax: 2n }] },
        { tokens: [] },
        // The README's shape for 5 mints: 529 bytes of actions, which no CreateSession transaction holds.
        {
            solPerTxMax: 1n,
            tokens: Array.from({ length: 5 }, (_, i) => ({ mint: fixed(100 + i), perTxMax: 1n, lifetimeCap: 1n })),
        },
    ]) {
        requests = 0;
        const failures = [];
        const error = await rejection(store.getState().createSession({ spendingLimits, onFail: (e) => failures.push(e) }));
        assert.match(error.message, /has no limit|twice|createSession needs spendingLimits|529 bytes of actions; at most 224 fit/);
        assert.equal(requests, 0, 'nothing read or sent');
        assert.deepEqual(failures, [error]);
        assert.equal(store.getState().error, error);
        assert.equal(store.getState().isSigning, false);
    }
    // The message for no limits at all names the token limits too.
    const error = await rejection(store.getState().createSession({}));
    assert.match(error.message, /tokens for each mint it may spend/);
});

test('a session send the program refuses for SOL its actions do not name rejects with UnlistedSolOutflowError', async () => {
    keptSession();
    landedErr = { InstructionError: [0, { Custom: 3037 }] };
    const failures = [];
    const error = await rejection(store.getState().signAndSendWithSession({ instructions: transfer(), onFail: (e) => failures.push(e) }));
    assert.ok(error instanceof W.UnlistedSolOutflowError, `${error.name}: ${error.message}`);
    assert.equal(error.message, 'This session is not allowed to spend SOL');
    assert.equal(error.signer, 'session');
    assert.equal(error.cause.name, 'TransactionFailedError');
    assert.deepEqual(failures, [error]);
    assert.equal(store.getState().error, error);
    assert.equal(W.isUnlistedSolOutflowError(error), true);
});

test("a delegate's send the paymaster refuses for a token its policy does not name rejects with UnlistedTokenOutflowError", async () => {
    keptAuthority();
    refusal = { code: -32602, message: korasText(3038) };
    const error = await rejection(store.getState().signAndSendWithAuthority({ instructions: transfer() }));
    assert.ok(error instanceof W.UnlistedTokenOutflowError, `${error.name}: ${error.message}`);
    assert.equal(error.message, 'This key is not allowed to spend this token');
    assert.equal(error.signer, 'authority');
    assert.equal(error.cause.name, 'PaymasterError');
    // The same bytes move the same assets: they are not sent again.
    assert.equal(sends, 1);
});

test("an Admin key's send refused with a 3037 that names no program is reported as it came: an Admin has no policy", async () => {
    keptAuthority(W.ROLE_ADMIN);
    refusal = { code: -32602, message: korasText(3037) };
    const error = await rejection(store.getState().signAndSendWithAuthority({ instructions: transfer() }));
    assert.equal(error.name, 'PaymasterError');
    assert.match(error.message, /Custom\(3037\)/);

    // Whose it is when the logs name LazorKit as the first to fail with it.
    refusal = { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(3037, V2) } };
    const named = await rejection(store.getState().signAndSendWithAuthority({ instructions: transfer() }));
    assert.ok(named instanceof W.UnlistedSolOutflowError, `${named.name}: ${named.message}`);
});

test('a refusal after an attempt whose answer was lost is TransactionOutcomeUnknownError, not a policy refusal: that attempt may have landed', async () => {
    keptSession();
    firstAnswerLost = true;
    refusal = { code: -32602, message: korasText(3037) };
    const failures = [];
    const error = await rejection(store.getState().signAndSendWithSession({ instructions: transfer(), onFail: (e) => failures.push(e) }));
    assert.ok(error instanceof W.TransactionOutcomeUnknownError, `${error.name}: ${error.message}`);
    assert.ok(!(error instanceof W.UnlistedSolOutflowError));
    assert.equal(error.cause.name, 'PaymasterError');
    assert.equal(error.cause.maybeSent, true);
    assert.deepEqual(failures, [error]);
    // Sent again after the lost answer: a later answer cannot say the first did not land.
    assert.ok(sends > 1);
});

test("an inner program's 3037, which the logs name, is reported as it came", async () => {
    keptSession();
    refusal = { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(3037, INNER) } };
    const error = await rejection(store.getState().signAndSendWithSession({ instructions: transfer() }));
    assert.equal(error.name, 'PaymasterError');
    assert.equal(W.isUnlistedSolOutflowError(error), false);
});

test('a send over its SolMaxPerTx (3023) is sent once and reported as it came: the same bytes move the same amount', async () => {
    // As Kora words it, and as a simulation's logs give it.
    for (const answer of [
        { code: -32602, message: korasText(3023) },
        { code: -32002, message: 'Transaction simulation failed', data: { logs: logsFor(3023, V2) } },
    ]) {
        keptSession();
        sends = 0;
        refusal = answer;
        const error = await rejection(store.getState().signAndSendWithSession({ instructions: transfer() }));
        assert.equal(error.name, 'PaymasterError');
        assert.ok(/Custom\(3023\)|0xbcf/.test(error.message) || /0xbcf/.test(JSON.stringify(error.data)), error.message);
        assert.equal(sends, 1, 'not sent again');
    }

    // After an attempt whose answer was lost the outcome is unknown: sent again, as before.
    keptSession();
    sends = 0;
    firstAnswerLost = true;
    refusal = { code: -32602, message: korasText(3023) };
    const unknown = await rejection(store.getState().signAndSendWithSession({ instructions: transfer() }));
    assert.ok(unknown instanceof W.TransactionOutcomeUnknownError, `${unknown.name}: ${unknown.message}`);
    assert.ok(sends > 1);
});

test('any other failure of a session send is reported as it came', async () => {
    keptSession();
    landedErr = { InstructionError: [0, { Custom: 3023 }] };
    const error = await rejection(store.getState().signAndSendWithSession({ instructions: transfer() }));
    assert.equal(error.name, 'TransactionFailedError');
});
