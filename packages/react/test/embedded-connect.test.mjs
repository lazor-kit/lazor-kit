// Embedded connect, through the built package (`pnpm build` first) in a page
// on https://app.test (jsdom) with a virtual authenticator, a scripted devnet
// and a paymaster that signs as a real fee payer. No network.
//
// A (new user): one get finds nothing, the no-passkey screen, create with
// user.id = the wallet's seed, the wallet created at findWallet(seed) and read
// back. D8: immediate mode at the top level of the options, only with user
// activation, and never again on the page once it failed. "Another device":
// hints ['hybrid'] over a fresh challenge. "Not now", a closed create sheet,
// an authenticator that already holds one. B: a 32-byte userHandle names the
// wallet, with no scan for the credential. R32: a wallet this passkey created
// alone is adopted unused; a plant is not. The 3.3 lookup for other passkeys
// (v1 and v2), the chooser, key recovery pinned to the passkey, a network
// failure that creates nothing, R29 and D10. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { freshPage } from './helpers/fresh-page.mjs';
import { credential } from './helpers/fake-webauthn.mjs';
import { APP_NAME, RP_ID, embeddedConfig, loadPackage, rejection, scriptedUi, setUpPage, until } from './helpers/embedded-page.mjs';

console.debug = () => {};
console.error = () => {};
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

const { window, authenticator } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const PROOF_TAG = Buffer.from('LazorKit ownership proof v1');
const isProofChallenge = (bytes) => bytes.length === 59 && Buffer.from(bytes.subarray(0, 27)).equals(PROOF_TAG);
const challengeOf = (call) => Buffer.from(new Uint8Array(call.options.publicKey.challenge));
const gets = () => authenticator.calls.filter((c) => c.kind === 'get');
const creates = () => authenticator.calls.filter((c) => c.kind === 'create');
/** getProgramAccounts calls that look a credential up (memcmp at 48, the credential hash). */
const credentialScans = () =>
    chain.calls('getProgramAccounts').filter((c) => (c.params[1]?.filters ?? []).some((f) => f.memcmp?.offset === 48));

let events;
let ui;
function configure(overrides = {}, answers = []) {
    events = [];
    ui = scriptedUi(answers);
    return W.createLazorkitClient(embeddedConfig({ ui, onEvent: (e) => events.push(e), ...overrides }), { replace: true });
}
const ceremonies = () => events.filter((e) => e.type === 'ceremony' && e.phase === 'start').map((e) => e.kind);
const screens = () => events.filter((e) => e.type === 'screen' && e.phase === 'open').map((e) => e.name);

beforeEach(async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    authenticator.state.caps = { immediateGet: false, conditionalGet: false };
    authenticator.state.userActivation = true;
    localStorage.clear();
    W.useWalletStore.setState({ wallet: null, isConnecting: false, isSigning: false, error: null, step: null });
    warnings.length = 0;
});

// ─── A: new user ────────────────────────────────────────────────────────────

test('new user: one get finds nothing, the no-passkey screen, create, and the wallet at findWallet(user.id), read back', async () => {
    const client = configure({}, [(ctx) => ({ action: 'create', name: ctx.suggestedName })]);
    const wallet = await client.connect();

    const [get] = gets();
    assert.equal(gets().length, 1);
    assert.ok(isProofChallenge(challengeOf(get)), 'step 1 signs a tagged ownership challenge');
    assert.deepEqual(get.options.publicKey.allowCredentials, []);
    assert.equal(get.options.mediation, 'optional');
    assert.equal(get.options.uiMode, undefined);

    const [create] = creates();
    const pk = create.options.publicKey;
    assert.deepEqual(pk.rp, { id: RP_ID, name: APP_NAME });
    assert.deepEqual(pk.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
    assert.equal(pk.authenticatorSelection.residentKey, 'required');
    assert.equal(pk.authenticatorSelection.authenticatorAttachment, undefined);
    assert.equal(pk.attestation, 'none');
    assert.deepEqual(pk.excludeCredentials, []);
    const seed = Buffer.from(new Uint8Array(pk.user.id));
    assert.equal(seed.length, 32, 'user.id is the 32-byte seed');

    const [walletPda] = W.findWalletPda(seed, chain.PROGRAM);
    const [vault] = W.findVaultPda(walletPda, chain.PROGRAM);
    assert.equal(wallet.smartWallet, walletPda.toBase58(), 'the wallet is at findWallet(user.id)');
    assert.equal(wallet.vaultPda, vault.toBase58());
    assert.equal(wallet.mode, 'embedded');
    assert.equal(wallet.rpId, RP_ID);
    assert.equal(wallet.how, 'created');
    assert.equal(wallet.programId, chain.PROGRAM.toBase58());

    // The name: "<appName> · <short vault>", at most 60 bytes.
    const name = pk.user.name;
    assert.equal(name, `${APP_NAME} · ${vault.toBase58().slice(0, 4)}…${vault.toBase58().slice(-4)}`);
    assert.ok(Buffer.byteLength(name) <= 60);
    assert.equal(ui.shown[0].suggestedName, name);

    // 2 prompts, 1 screen, the creation sent once; nothing left pending.
    assert.deepEqual(ceremonies(), ['get', 'create']);
    assert.deepEqual(screens(), ['no-passkey']);
    assert.equal(chain.state.sent.length, 1);
    assert.equal(credentialScans().length, 0, 'a passkey made a moment ago is looked up nowhere');
    assert.deepEqual(events.find((e) => e.type === 'connected'), { type: 'connected', how: 'created', signatures: [events.find((e) => e.type === 'connected').signatures[0]] });
    assert.equal([...Object.keys(localStorage)].filter((k) => k.includes(':pending:')).length, 0);
    assert.equal(W.useWalletStore.getState().wallet.smartWallet, walletPda.toBase58());
});

test("a long app name is cut so the passkey's name stays within 60 bytes, vault suffix whole", async () => {
    const long = 'Ứng dụng ví điện tử rất dài của chúng tôi dành cho mọi người';
    configure({ appName: long }, [(ctx) => ({ action: 'create', name: ctx.suggestedName })]);
    await W.getLazorkitClient().connect();
    const name = creates()[0].options.publicKey.user.name;
    assert.ok(Buffer.byteLength(name) <= 60, `${Buffer.byteLength(name)} bytes`);
    assert.match(name, / · \w{4}…\w{4}$/);
    assert.ok(long.startsWith(name.split(' · ')[0].trim()));
});

test('excludeCredentials names the passkeys this device knows; an authenticator holding one shows the notice', async () => {
    // A passkey of this app seen here earlier.
    const known = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(known);
    localStorage.setItem(`lazorkit:embedded:${RP_ID}:known`, JSON.stringify([known.rawId.toString('base64url')]));
    configure({}, [{ action: 'create', name: 'x' }, { action: 'not-now' }]);
    authenticator.next('cancel'); // the first get: closed
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(error.reason, 'not-now');
    const ids = creates()[0].options.publicKey.excludeCredentials.map((c) => Buffer.from(new Uint8Array(c.id)));
    assert.deepEqual(ids, [known.rawId]);
    assert.equal(ui.shown[1].notice, 'exists', 'InvalidStateError: the notice, no throw');
    assert.equal(chain.state.sent.length, 0);
});

test('"Not now": UserRejectedError, nothing created or sent, and error stays null', async () => {
    configure({}, [{ action: 'not-now' }]);
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(W.errorKind(error), 'rejected');
    assert.equal(W.userMessage(error, 'connect'), null);
    assert.equal(W.useWalletStore.getState().error, null);
    assert.equal(W.useWalletStore.getState().wallet, null);
    assert.equal(creates().length, 0);
    assert.equal(chain.state.sent.length, 0);
    assert.equal(chain.state.rpcCalls.length, 0, 'not even a read');
});

test('a closed create sheet creates nothing and stays on the no-passkey screen', async () => {
    configure({}, [{ action: 'create', name: 'x' }, { action: 'not-now' }]);
    authenticator.next({}, 'cancel'); // get finds nothing; create is closed
    await rejection(W.getLazorkitClient().connect());
    assert.equal(ui.shown.length, 2);
    assert.equal(ui.shown[1].notice, undefined);
    assert.equal(chain.state.sent.length, 0);
});

// ─── D8: immediate mode, and another device ─────────────────────────────────

test('D8: immediate mode at the top level when the browser has it and the user clicked; after it fails, modal for the page', async () => {
    const page = await loadPackage(() => freshPage());
    authenticator.state.caps.immediateGet = true;
    await page.W.passkeyCapabilities();
    const client = page.W.createLazorkitClient(embeddedConfig({ ui: scriptedUi([{ action: 'not-now' }, { action: 'not-now' }]) }), { replace: true });
    globalThis.fetch = (url, init) => page.chain.fetch(url, init);
    await rejection(client.connect());
    const first = gets()[0].options;
    assert.equal(first.uiMode, 'immediate', 'top level, not in publicKey');
    assert.equal(first.publicKey.uiMode, undefined);
    assert.equal(first.mediation, undefined);
    assert.deepEqual(first.publicKey.allowCredentials, []);

    await rejection(client.connect());
    const second = gets()[1].options;
    assert.equal(second.uiMode, undefined, 'never immediate again on this page');
    assert.equal(second.mediation, 'optional');
    globalThis.fetch = (url, init) => chain.fetch(url, init);
});

test('D8: no immediate mode without user activation (a returning user would be offered to create)', async () => {
    const page = await loadPackage(() => freshPage());
    authenticator.state.caps.immediateGet = true;
    authenticator.state.userActivation = false;
    await page.W.passkeyCapabilities();
    const client = page.W.createLazorkitClient(embeddedConfig({ ui: scriptedUi([{ action: 'not-now' }]) }), { replace: true });
    await rejection(client.connect());
    assert.equal(gets()[0].options.uiMode, undefined);
    assert.equal(gets()[0].options.mediation, 'optional');
});

test('"Use a passkey on another device": a modal get with hints hybrid over a fresh challenge; closed, back to the screen', async () => {
    configure({}, [{ action: 'other-device' }, { action: 'not-now' }]);
    authenticator.next({}, 'cancel');
    await rejection(W.getLazorkitClient().connect());
    const [first, hybrid] = gets();
    assert.deepEqual(hybrid.options.publicKey.hints, ['hybrid']);
    assert.equal(hybrid.options.mediation, 'optional');
    assert.equal(hybrid.options.uiMode, undefined);
    assert.ok(isProofChallenge(challengeOf(hybrid)));
    assert.ok(!challengeOf(hybrid).equals(challengeOf(first)), 'a fresh challenge');
    assert.deepEqual(ceremonies(), ['get', 'get:hybrid']);
    assert.equal(ui.shown.length, 2, 'back to the no-passkey screen');
});

// ─── B: the userHandle fast path ────────────────────────────────────────────

test('B: a 32-byte userHandle finds its used wallet with no scan for the credential, and adopts it (1 prompt)', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    const { wallet, vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 3 });
    configure();
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.smartWallet, wallet.toBase58());
    assert.equal(connected.vaultPda, vault.toBase58());
    assert.equal(connected.how, 'adopted');
    assert.deepEqual(ceremonies(), ['get']);
    assert.deepEqual(screens(), []);
    assert.equal(credentialScans().length, 0, 'no getProgramAccounts by credential hash');
    assert.equal(chain.state.sent.length, 0);
});

test('R32: an unused wallet this passkey created alone is adopted with no chooser and no scan at all', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    const { wallet } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0, created: 'alone' });
    configure();
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.smartWallet, wallet.toBase58());
    assert.equal(connected.how, 'adopted');
    assert.deepEqual(screens(), []);
    assert.equal(chain.calls('getProgramAccounts').length, 0);
});

test('R32: a planted wallet (created by another key, the passkey added, the creator removed, in one transaction) goes to the chooser', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0, created: 'plant' });
    configure({}, [null]);
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.WalletConfirmationDeclinedError);
    assert.ok(error instanceof W.UserRejectedError);
    assert.deepEqual(screens(), ['choose-wallet']);
    assert.equal(ui.shown[0].choices.length, 1);
    assert.equal(chain.state.sent.length, 0, '"None of these" creates nothing');
});

test('R32: a history of 1000 or more cannot be told, so the user is asked', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    const { wallet } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0, created: 'alone' });
    chain.state.extraHistory.set(
        wallet.toBase58(),
        Array.from({ length: 1000 }, (_, i) => ({ signature: `sig${i}`, slot: i, err: null, memo: null, blockTime: null })),
    );
    configure({}, [(choices) => ({ wallet: choices[0].vault })]);
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.how, 'confirmed');
    assert.deepEqual(screens(), ['choose-wallet']);
});

test("B: a wallet at the userHandle's seed that is not this passkey's: a new wallet elsewhere, after recovering the key (2 prompts)", async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    // Someone else's wallet at the seed: this credential's seat holds another key.
    const taken = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0, key: credential({ rpId: RP_ID }).key.compressed });
    configure();
    const connected = await W.getLazorkitClient().connect();
    assert.notEqual(connected.smartWallet, taken.wallet.toBase58());
    assert.equal(connected.how, 'recovered');
    assert.deepEqual(ceremonies(), ['get', 'get:recover']);
    const [, second] = gets();
    assert.deepEqual(
        second.options.publicKey.allowCredentials.map((c) => Buffer.from(new Uint8Array(c.id))),
        [cred.rawId],
        'the second prompt is pinned to the passkey',
    );
});

test('a new-style passkey with no wallet: the key recovered (2 prompts), the wallet at findWallet(userHandle)', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    configure();
    const connected = await W.getLazorkitClient().connect();
    const [walletPda] = W.findWalletPda(cred.userHandle, chain.PROGRAM);
    assert.equal(connected.smartWallet, walletPda.toBase58());
    assert.equal(connected.how, 'recovered');
    assert.deepEqual(ceremonies(), ['get', 'get:recover']);
    assert.equal(chain.state.sent.length, 1);
});

// ─── The 3.3 lookup, for passkeys this SDK did not make ─────────────────────

test('a 16-byte userHandle: the lookup scans v2 and v1, and adopts the one signed-for wallet', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(16) });
    authenticator.add(cred);
    const { wallet } = chain.walletFor(cred, { rpId: RP_ID, counter: 2 });
    configure({ trustedAuthorities: [], watchMints: [] });
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.smartWallet, wallet.toBase58());
    assert.equal(connected.how, 'adopted');
    const scanned = new Set(credentialScans().map((c) => c.params[0]));
    assert.ok(scanned.has(chain.PROGRAM.toBase58()), 'the v2 program');
    assert.equal(scanned.size, 2, 'and the v1 program paired with it');
});

test('C: a wallet the passkey never signed for goes to the chooser; picking it connects it (confirmed)', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(16) });
    authenticator.add(cred);
    const { vault } = chain.walletFor(cred, { rpId: RP_ID, counter: 0 });
    configure({}, [(choices) => ({ wallet: choices[0].vault })]);
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.vaultPda, vault.toBase58());
    assert.equal(connected.how, 'confirmed');
    assert.deepEqual(screens(), ['choose-wallet']);
});

test("onConfirmWallet 'throw' on the fast path: WalletNeedsConfirmationError, then connect({ confirmWallet }) with no prompt", async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    const { vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0 });
    configure({ onConfirmWallet: 'throw' });
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.WalletNeedsConfirmationError);
    assert.equal(error.candidates[0].vault, vault.toBase58());
    assert.deepEqual(screens(), [], 'the SDK sheet is not shown');
    const before = gets().length;
    const connected = await W.getLazorkitClient().connect({ confirmWallet: vault.toBase58() });
    assert.equal(connected.vaultPda, vault.toBase58());
    assert.equal(gets().length, before, 'no second prompt');
});

test('a function onConfirmWallet is asked on the fast path, not the SDK sheet', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 0 });
    let asked;
    configure({ onConfirmWallet: (request) => ((asked = request), null) });
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.WalletConfirmationDeclinedError);
    assert.equal(asked.candidates.length, 1);
    assert.deepEqual(screens(), []);
});

test('D: another passkey answering the pinned second prompt: PasskeyMismatchError, nothing created', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(16) });
    const other = credential({ rpId: RP_ID });
    authenticator.add(cred);
    configure();
    authenticator.next({}, { answerWith: other });
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.PasskeyMismatchError, String(error));
    assert.equal(W.errorKind(error), 'other-passkey');
    assert.equal(chain.state.sent.length, 0);
});

test('the RPC down while finding the wallet: NetworkError, nothing created', async () => {
    const cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    configure();
    chain.state.mode = 'rpc-down';
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.NetworkError, String(error));
    assert.equal(W.userMessage(error, 'connect'), "Couldn't reach the network. Nothing was created.");
    assert.equal(chain.state.sent.length, 0);
    assert.equal(W.useWalletStore.getState().error, error);
});

// ─── R29: a passkey created, its wallet not ─────────────────────────────────

test('R29: the wallet fails after the passkey was created: "Try again" lands it with no new prompt', async () => {
    configure({}, [(ctx) => ({ action: 'create', name: ctx.suggestedName }), { action: 'retry-wallet' }]);
    chain.state.mode = 'fail';
    const connecting = W.getLazorkitClient().connect();
    await until(() => ui.shown.length === 2, 'the wallet-failed notice');
    assert.equal(ui.shown[1].notice, 'wallet-failed');
    assert.equal(Object.keys(localStorage).filter((k) => k.includes(':pending:')).length, 1, 'the pending record is kept');
    chain.state.mode = null;
    const connected = await connecting;
    assert.equal(connected.how, 'created');
    assert.deepEqual(ceremonies(), ['get', 'create'], 'no prompt for the retry');
    assert.equal(Object.keys(localStorage).filter((k) => k.includes(':pending:')).length, 0);
});

test('R29: "Not now" after the failure keeps the pending record: the next sign-in creates the wallet with one prompt', async () => {
    configure({}, [(ctx) => ({ action: 'create', name: ctx.suggestedName }), { action: 'not-now' }]);
    chain.state.mode = 'fail';
    await rejection(W.getLazorkitClient().connect());
    const seed = Buffer.from(new Uint8Array(creates()[0].options.publicKey.user.id));
    chain.state.mode = null;
    configure();
    const connected = await W.getLazorkitClient().connect();
    assert.equal(connected.smartWallet, W.findWalletPda(seed, chain.PROGRAM)[0].toBase58());
    assert.deepEqual(ceremonies(), ['get'], 'one prompt: the pending key is proven by the sign-in');
    assert.equal(credentialScans().length, 0);
});

// ─── The relayer is checked ─────────────────────────────────────────────────

test('a paymaster that returns another transaction\'s signature: nothing is saved', async () => {
    configure({}, [(ctx) => ({ action: 'create', name: ctx.suggestedName }), { action: 'not-now' }]);
    chain.state.mode = 'foreign-signature';
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.UserRejectedError, 'the user gave up after the wallet-failed notice');
    assert.equal(ui.shown[1].notice, 'wallet-failed');
    assert.equal(W.useWalletStore.getState().wallet, null);
});

// ─── D10, disconnect, abandon ───────────────────────────────────────────────

test('D10: a live session whose key this device holds (kept at disconnect) does not send the wallet to the chooser', async () => {
    configure({ keyStorage: 'memory' }, [(ctx) => ({ action: 'create', name: ctx.suggestedName })]);
    const created = await W.getLazorkitClient().connect();
    await W.useWalletStore.getState().createSession({ spendingLimits: { solPerTxMax: 1_000_000n } });
    await W.getLazorkitClient().disconnect({ keepSessionKeys: true });

    configure({ keyStorage: 'memory' }, [null]);
    const again = await W.getLazorkitClient().connect();
    assert.equal(again.smartWallet, created.smartWallet);
    assert.equal(again.how, 'adopted');
    assert.deepEqual(screens(), [], 'no chooser: the session is this device\'s own');

    // A plain disconnect deletes the key: the session is someone's, so the user is asked.
    await W.getLazorkitClient().disconnect();
    configure({ keyStorage: 'memory' }, [null]);
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.WalletConfirmationDeclinedError);
    assert.deepEqual(screens(), ['choose-wallet']);
    assert.ok(ui.shown[0].choices[0].liveSessions.length === 1);
});

test('disconnect during connect: the connect rejects as abandoned and saves nothing', async () => {
    configure({}, [() => new Promise(() => {})]);
    const connecting = W.getLazorkitClient().connect();
    await until(() => ui.shown.length === 1, 'the no-passkey screen');
    await W.getLazorkitClient().disconnect();
    const error = await rejection(connecting);
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(error.reason, 'abandoned');
    assert.equal(W.useWalletStore.getState().wallet, null);
    assert.equal(localStorage.getItem(`lazorkit:embedded:${RP_ID}:wallet`), null);
});

test('the step follows the connect: checking, no-passkey, creating, then none', async () => {
    configure({}, [(ctx) => ({ action: 'create', name: ctx.suggestedName })]);
    const steps = [];
    const unsubscribe = W.useWalletStore.subscribe((s) => {
        if ((steps.length || s.step !== null) && steps[steps.length - 1] !== s.step) steps.push(s.step);
    });
    await W.getLazorkitClient().connect();
    unsubscribe();
    assert.deepEqual(steps, ['checking-passkey', 'no-passkey', 'creating-passkey', 'creating-wallet', null]);
});

test('a page on an IP address: connect rejects with LazorkitConfigError ip-host, nothing asked', async () => {
    const saved = globalThis.location;
    globalThis.location = new URL('https://127.0.0.1:5173/');
    try {
        configure();
        assert.equal(W.getLazorkitClient().getState().availability, 'misconfigured');
        const error = await rejection(W.getLazorkitClient().connect());
        assert.ok(error instanceof W.LazorkitConfigError);
        assert.equal(error.problem, 'ip-host');
        assert.equal(authenticator.calls.length, 0);
    } finally {
        globalThis.location = saved;
        configure();
    }
});

test('a SecurityError from the browser (rpId refused for this page) is a config error, not the user\'s', async () => {
    configure();
    authenticator.next({ error: 'SecurityError' });
    const error = await rejection(W.getLazorkitClient().connect());
    assert.ok(error instanceof W.LazorkitConfigError);
    assert.equal(error.problem, 'rp-id-refused');
});

void sha256;
