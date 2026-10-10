// signMessage in Embedded mode (D9: the 3.3 format), through the built
// package with a virtual authenticator and a scripted devnet. The passkey
// signs `signedMessageChallenge(message)` (58 bytes), pinned to the connected
// passkey; the reply is checked to be over that challenge and from that
// passkey; and `verifyWalletMessage` with the app's rpId accepts it against
// the key on chain, and nothing else. Run with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { freshPage } from './helpers/fresh-page.mjs';
import { credential } from './helpers/fake-webauthn.mjs';
import { RP_ID, embeddedConfig, loadPackage, rejection, scriptedUi, setUpPage } from './helpers/embedded-page.mjs';

console.debug = () => {};
console.error = () => {};
console.warn = () => {};

const { window, authenticator } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

const TAG = Buffer.from('LazorKit signed message v1');
const MESSAGE = 'Sign in to app.test\nNonce: 7';
let cred;
let wallet;
let vault;

beforeEach(async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
    W.useWalletStore.setState({ wallet: null, isConnecting: false, isSigning: false, error: null, step: null });
    cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    ({ wallet, vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 1 }));
    W.createLazorkitClient(embeddedConfig({ ui: scriptedUi() }), { replace: true });
    await W.getLazorkitClient().connect();
    authenticator.clear();
});

test('the passkey signs the 58-byte message challenge, pinned to the connected passkey', async () => {
    const result = await W.getLazorkitClient().signMessage(MESSAGE);
    const [call] = authenticator.calls;
    const challenge = Buffer.from(new Uint8Array(call.options.publicKey.challenge));
    const expected = Buffer.concat([TAG, createHash('sha256').update(Buffer.concat([TAG, Buffer.from(MESSAGE)])).digest()]);
    assert.equal(challenge.length, 58);
    assert.ok(challenge.equals(expected));
    assert.deepEqual(call.options.publicKey.allowCredentials.map((c) => Buffer.from(new Uint8Array(c.id))), [cred.rawId]);
    assert.equal(Buffer.from(result.signature, 'base64').length, 64);
    const clientData = JSON.parse(Buffer.from(result.clientDataJsonBase64, 'base64').toString());
    assert.equal(clientData.challenge, expected.toString('base64url'));
});

test('verifyWalletMessage (rpId = the app) is true for the key on chain, by wallet or vault, and false otherwise', async () => {
    const result = await W.getLazorkitClient().signMessage(MESSAGE);
    const base = { connection: W.useWalletStore.getState().connection, credentialId: cred.rawId.toString('base64'), rpId: RP_ID, message: MESSAGE, ...result };
    assert.equal(await W.verifyWalletMessage({ ...base, wallet }), true);
    assert.equal(await W.verifyWalletMessage({ ...base, wallet: vault.toBase58() }), true);
    assert.equal(await W.verifyWalletMessage({ ...base, wallet, rpId: 'portal.lazor.sh' }), false, 'another relying party');
    assert.equal(await W.verifyWalletMessage({ ...base, wallet, message: 'Sign in to evil.test' }), false);
    assert.equal(await W.verifyWalletMessage({ ...base, wallet, origin: 'https://evil.test' }), false);
    assert.equal(await W.verifyWalletMessage({ ...base, wallet, origin: `https://${RP_ID}` }), true);
});

test('another passkey answering: PasskeyMismatchError, no result', async () => {
    authenticator.next({ answerWith: credential({ rpId: RP_ID }) });
    const error = await rejection(W.getLazorkitClient().signMessage(MESSAGE));
    assert.ok(error instanceof W.PasskeyMismatchError);
    assert.equal(W.useWalletStore.getState().error, error);
});

test('a closed sheet: UserRejectedError, and error stays null', async () => {
    authenticator.next('cancel');
    const error = await rejection(W.getLazorkitClient().signMessage(MESSAGE));
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(W.useWalletStore.getState().error, null);
    assert.equal(W.useWalletStore.getState().isSigning, false);
});

test('bytes are signed as given (the core client takes a Uint8Array)', async () => {
    const bytes = new Uint8Array(randomBytes(40));
    const result = await W.getLazorkitClient().signMessage(bytes);
    assert.ok(W.verifySignedMessage({ message: bytes, publicKey: cred.key.compressed, rpId: RP_ID, ...result }));
});
