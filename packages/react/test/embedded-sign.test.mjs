// Embedded sends and the review sheet (D14), through the built package in a
// page on https://app.test with a virtual authenticator and a scripted devnet
// and paymaster. One passkey prompt per send, pinned to the connected
// passkey, with a low-S signature; the second of two sends reads its
// challenge from a node at or past the first one's slot; `onSubmitted` once,
// before `onSuccess` and before the confirmation is read, never for a send
// that was not sent; a closed sheet is `UserRejectedError` with nothing sent;
// 4018 and 3006 are never resent; the review comes before any slot or counter
// is read for the challenge, shows what is signed (a copy the app cannot
// change meanwhile), and simulates on the provider's RPC; a paymaster
// answering with another transaction's signature is caught; a v1 wallet
// sends through the v1 relayer, and its 4018 is `V1WalletRetiredError`. Run
// with `pnpm test`.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
    ComputeBudgetProgram,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js';
import { freshPage } from './helpers/fresh-page.mjs';
import { credential } from './helpers/fake-webauthn.mjs';
import { embeddedConfig, loadPackage, rejection, scriptedUi, setUpPage, until, RP_ID } from './helpers/embedded-page.mjs';
import { PAYMASTER, RPC } from './helpers/chain.mjs';

console.debug = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const { window, authenticator } = setUpPage();
const { W, chain } = await loadPackage(() => freshPage());
after(() => window.close());

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const USDC_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

let events;
let ui;
let cred;
let vault;
let wallet;
function configure(overrides = {}, answers = []) {
    events = [];
    ui = scriptedUi(answers);
    return W.createLazorkitClient(embeddedConfig({ ui, onEvent: (e) => events.push(e), ...overrides }), { replace: true });
}
const signGets = () => authenticator.calls.filter((c) => c.kind === 'get');
/** The connected passkey's authority account (its seat on the wallet, and its counter). */
const authorityOf = async () =>
    W.findAuthorityPda(wallet, new Uint8Array(await crypto.subtle.digest('SHA-256', cred.rawId)), chain.PROGRAM)[0].toBase58();
/**
 * The RPC reads a challenge is made from: the slot it names, a blockhash, and
 * the authority's counter (every read of the authority account; the seat
 * lookup before the review is one).
 */
const challengeInputs = (authority) => ({
    slots: chain.calls('getSlot').length,
    blockhashes: chain.calls('getLatestBlockhash').length,
    authorityReads: chain.calls('getAccountInfo').filter((c) => c.params[0] === authority).length,
});
const transfer = (lamports = 0) => [SystemProgram.transfer({ fromPubkey: vault, toPubkey: vault, lamports })];

beforeEach(async () => {
    globalThis.fetch = (url, init) => chain.fetch(url, init);
    chain.reset();
    authenticator.state.credentials.length = 0;
    authenticator.clear();
    localStorage.clear();
    W.useWalletStore.setState({ wallet: null, isConnecting: false, isSigning: false, error: null, step: null });
    // A connected wallet this passkey has used.
    cred = credential({ rpId: RP_ID, userHandle: randomBytes(32) });
    authenticator.add(cred);
    ({ wallet, vault } = chain.walletFor(cred, { rpId: RP_ID, seed: cred.userHandle, counter: 1 }));
    configure({ confirm: false });
    await W.getLazorkitClient().connect();
    events.length = 0;
    authenticator.clear();
    chain.state.rpcCalls.length = 0;
    chain.state.sent.length = 0;
});

/** The LazorKit Execute's secp256r1 signature (r || s) in a sent transaction: its precompile instruction's data. */
function precompileSignature(tx) {
    const keys = tx.message.staticAccountKeys;
    const ix = tx.message.compiledInstructions.find((i) => keys[i.programIdIndex].toBase58() === 'Secp256r1SigVerify1111111111111111111111111');
    assert.ok(ix, 'the transaction carries the secp256r1 precompile');
    const data = Buffer.from(ix.data);
    const offset = data.readUInt16LE(2);
    return data.subarray(offset, offset + 64);
}

test('one pinned prompt per send; the signature is low-S; resolves at confirmed with the signature', async () => {
    const signature = await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    assert.equal(typeof signature, 'string');
    const gets = signGets();
    assert.equal(gets.length, 1);
    assert.deepEqual(
        gets[0].options.publicKey.allowCredentials.map((c) => Buffer.from(new Uint8Array(c.id))),
        [cred.rawId],
    );
    assert.equal(gets[0].options.publicKey.rpId, RP_ID);
    assert.equal(chain.state.sent.length, 1);
    const s = BigInt('0x' + precompileSignature(chain.state.sent[0]).subarray(32).toString('hex'));
    assert.ok(s <= P256_N / 2n, 'low S');
    assert.deepEqual(
        events.filter((e) => e.type === 'ceremony' && e.phase === 'start').map((e) => e.kind),
        ['get:sign'],
    );
    assert.deepEqual(events.filter((e) => e.type === 'submitted' || e.type === 'confirmed').map((e) => e.type), ['submitted', 'confirmed']);
    assert.equal(chain.calls('getProgramAccounts').length, 0, 'a send needs no scan in Embedded mode');
});

test('two sends back to back: the second reads its challenge at or past the slot the first landed in', async () => {
    const client = W.getLazorkitClient();
    await client.signAndSend({ instructions: transfer() });
    const landed = chain.state.history[chain.state.history.length - 1].slot;
    chain.state.rpcCalls.length = 0;
    await client.signAndSend({ instructions: transfer() });
    const authority = W.findAuthorityPda(wallet, new Uint8Array(await crypto.subtle.digest('SHA-256', cred.rawId)), chain.PROGRAM)[0].toBase58();
    const counterReads = chain.state.rpcCalls.filter((c) => c.method === 'getAccountInfo' && c.params[0] === authority && c.params[1]?.minContextSlot !== undefined);
    assert.ok(counterReads.length >= 1, 'the counter is read with minContextSlot');
    assert.ok(counterReads.every((c) => c.params[1].minContextSlot >= landed));
    assert.equal(chain.state.sent.length, 2);
});

test('onSubmitted: once, before onSuccess; a throwing one changes nothing', async () => {
    const order = [];
    const signature = await W.useWalletStore.getState().signAndSendTransaction({
        instructions: transfer(),
        onSubmitted: (sig) => {
            order.push(['submitted', sig]);
            throw new Error('an app bug');
        },
        onSuccess: (sig) => order.push(['success', sig]),
    });
    assert.deepEqual(order, [
        ['submitted', signature],
        ['success', signature],
    ]);
    assert.equal(W.useWalletStore.getState().error, null);
});

test('onSubmitted fires once the paymaster has sent it, before it is confirmed: step submitted, the send still pending', async () => {
    // The node answers the status poll only when released.
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let polled = 0;
    globalThis.fetch = async (url, init) => {
        if (JSON.parse(init.body).method === 'getSignatureStatuses') {
            polled++;
            await held;
        }
        return chain.fetch(url, init);
    };
    let submitted = null;
    let stepAtSubmit;
    let settled = false;
    const sending = W.getLazorkitClient()
        .signAndSend({
            instructions: transfer(),
            onSubmitted: (sig) => {
                submitted = sig;
                stepAtSubmit = W.useWalletStore.getState().step;
            },
        })
        .finally(() => (settled = true));
    try {
        await until(() => polled > 0, 'the confirmation poll');
        assert.equal(typeof submitted, 'string', 'onSubmitted ran before the confirmation was read');
        assert.equal(stepAtSubmit, 'submitted');
        assert.equal(W.getLazorkitClient().getState().step, 'submitted');
        assert.equal(W.getLazorkitClient().getState().status, 'signing');
        assert.equal(settled, false, 'signAndSend is still waiting for the confirmation');
        assert.deepEqual(events.filter((e) => e.type === 'submitted' || e.type === 'confirmed').map((e) => e.type), ['submitted']);
    } finally {
        release();
    }
    assert.equal(await sending, submitted);
    assert.deepEqual(events.filter((e) => e.type === 'submitted' || e.type === 'confirmed').map((e) => e.type), ['submitted', 'confirmed']);
});

test('a closed passkey sheet: UserRejectedError, nothing sent, onSubmitted not called, error null', async () => {
    authenticator.next('cancel');
    let submitted = 0;
    let failed;
    const error = await rejection(
        W.getLazorkitClient().signAndSend({ instructions: transfer(), onSubmitted: () => submitted++, onFail: (e) => (failed = e) }),
    );
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(error.reason, 'passkey-closed');
    assert.equal(failed, error, 'onFail still runs');
    assert.equal(W.userMessage(error, 'send'), 'Nothing signed, nothing sent.');
    assert.equal(submitted, 0);
    assert.equal(chain.state.sent.length, 0);
    assert.equal(W.useWalletStore.getState().error, null);
    assert.equal(W.useWalletStore.getState().isSigning, false);
});

test('a paymaster refusal before sending: no onSubmitted, the error recorded', async () => {
    chain.state.mode = 'fail';
    let submitted = 0;
    const error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer(), onSubmitted: () => submitted++ }));
    assert.equal(submitted, 0);
    assert.equal(W.useWalletStore.getState().error, error);
});

test('a paymaster answering with another transaction\'s signature: outcome unknown, no onSubmitted, the next challenge waits', async () => {
    chain.state.mode = 'foreign-signature';
    let submitted = 0;
    const error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer(), onSubmitted: () => submitted++ }));
    assert.ok(error instanceof W.TransactionOutcomeUnknownError, String(error));
    assert.equal(error.signature, undefined);
    assert.equal(W.errorKind(error), 'tx-unknown');
    assert.equal(submitted, 0);
});

test('4018 and 3006 from the paymaster are sent exactly once', async () => {
    for (const code of [4018, 3006]) {
        chain.state.sent.length = 0;
        const original = chain.fetch;
        globalThis.fetch = async (url, init) => {
            const body = JSON.parse(init.body);
            if (String(url).includes('paymaster') && body.method === 'signAndSendTransaction') {
                chain.state.sent.push(body);
                return new Response(
                    JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32002, message: `Transaction simulation failed: custom program error: 0x${code.toString(16)}`, data: { logs: [`Program ${chain.PROGRAM.toBase58()} failed: custom program error: 0x${code.toString(16)}`] } } }),
                    { status: 200 },
                );
            }
            return original(url, init);
        };
        await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer() }));
        assert.equal(chain.state.sent.length, 1, `${code} is not retried`);
        globalThis.fetch = (url, init) => chain.fetch(url, init);
    }
});

// ─── The review sheet (D14) ─────────────────────────────────────────────────

test('the review opens before any passkey prompt or challenge read; approving signs what was reviewed', async () => {
    const authority = await authorityOf();
    let atReview;
    configure({}, [
        (review) => {
            atReview = { gets: signGets().length, ...challengeInputs(authority), review };
            return true;
        },
    ]);
    await W.getLazorkitClient().signAndSend({ instructions: transfer(500_000_000) });
    assert.equal(atReview.gets, 0, 'no passkey prompt before the review');
    assert.equal(atReview.slots, 0, 'no slot read for a challenge before the review');
    assert.equal(atReview.blockhashes, 0);
    assert.equal(atReview.authorityReads, 1, "only the seat lookup: the counter isn't read for a challenge yet");
    const after = challengeInputs(authority);
    assert.ok(after.slots >= 1 && after.authorityReads >= 2, 'the challenge is read after the review');
    assert.equal(atReview.review.rows[0].text, `Send 0.5 SOL to ${vault.toBase58().slice(0, 8)}…${vault.toBase58().slice(-8)}`);
    assert.equal(atReview.review.feeLine, 'Network fee: paid by Test App');
    assert.equal(signGets().length, 1);
    assert.deepEqual(
        events.filter((e) => e.type === 'screen').map((e) => `${e.name}:${e.phase}`),
        ['review-transaction:open', 'review-transaction:close'],
    );
});

test('cancelling the review: UserRejectedError review-cancelled, nothing prepared, prompted or sent', async () => {
    const authority = await authorityOf();
    configure({}, [false]);
    const error = await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer() }));
    assert.ok(error instanceof W.UserRejectedError);
    assert.equal(error.reason, 'review-cancelled');
    assert.deepEqual(challengeInputs(authority), { slots: 0, blockhashes: 0, authorityReads: 1 }, 'no challenge was read');
    assert.equal(signGets().length, 0);
    assert.equal(chain.state.sent.length, 0);
    assert.equal(W.useWalletStore.getState().error, null);
});

test('confirm: false on the call skips the review; the provider default is on', async () => {
    configure({}, []);
    await W.getLazorkitClient().signAndSend({ instructions: transfer(), confirm: false });
    assert.equal(ui.shown.length, 0);
    assert.equal(chain.state.sent.length, 1);
});

test('the simulation runs on the provider\'s RPC, unsigned, with the vault\'s balance change', async () => {
    chain.state.accounts.set(vault.toBase58(), { owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), lamports: 2_000_000_000 });
    chain.state.simulation = { err: null, logs: [], vaultLamportsAfter: 1_500_000_000 };
    let review;
    configure({}, [(r) => ((review = r), true)]);
    await W.getLazorkitClient().signAndSend({
        instructions: [SystemProgram.transfer({ fromPubkey: vault, toPubkey: Keypair.generate().publicKey, lamports: 500_000_000 })],
    });
    const [simulate] = chain.calls('simulateTransaction');
    assert.ok(simulate, 'simulated');
    assert.equal(simulate.params[1].sigVerify, false);
    assert.equal(simulate.params[1].replaceRecentBlockhash, true);
    assert.deepEqual(simulate.params[1].accounts.addresses, [vault.toBase58()]);
    assert.deepEqual(review.simulation, { status: 'ok', balanceChange: '−0.5 SOL' });
});

test('a failing simulation is shown as such ("Approve anyway" in the built-in sheet)', async () => {
    chain.state.simulation = { err: { InstructionError: [0, { Custom: 1 }] }, logs: ['Program 11111111111111111111111111111111 failed: custom program error: 0x1'] };
    let review;
    configure({}, [(r) => ((review = r), false)]);
    await rejection(W.getLazorkitClient().signAndSend({ instructions: transfer(1) }));
    assert.deepEqual(review.simulation, { status: 'failed', reason: 'custom program error: 0x1' });
});

test('the decoders: transfer, transferChecked (recipient owner shown), ATA, compute budget, memo, an approval flagged, unknown', async () => {
    const recipientOwner = Keypair.generate().publicKey;
    const source = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const tokenAccount = (mint, owner) => {
        const data = Buffer.alloc(165);
        mint.toBuffer().copy(data, 0);
        owner.toBuffer().copy(data, 32);
        return { owner: TOKEN.toBase58(), data, lamports: 2_039_280 };
    };
    chain.state.accounts.set(source.toBase58(), tokenAccount(USDC_DEVNET, vault));
    chain.state.accounts.set(destination.toBase58(), tokenAccount(USDC_DEVNET, recipientOwner));
    const transferChecked = new TransactionInstruction({
        programId: TOKEN,
        keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: USDC_DEVNET, isSigner: false, isWritable: false },
            { pubkey: destination, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([12, ...Buffer.from(new BigUint64Array([2_500_000n]).buffer), 6]),
    });
    const approve = new TransactionInstruction({
        programId: TOKEN,
        keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
            { pubkey: vault, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([4, ...Buffer.from(new BigUint64Array([10n]).buffer)]),
    });
    const ata = new TransactionInstruction({
        programId: ATA,
        keys: [vault, Keypair.generate().publicKey, recipientOwner, USDC_DEVNET, SystemProgram.programId, TOKEN].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
        data: Buffer.from([1]),
    });
    const memo = new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from('order #42') });
    const unknown = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: vault, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
    let review;
    configure({}, [(r) => ((review = r), false)]);
    await rejection(
        W.getLazorkitClient().signAndSend({
            instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...transfer(1), transferChecked, ata, memo, approve, unknown],
        }),
    );
    const rows = review.rows;
    assert.deepEqual(rows.map((r) => r.kind), ['compute-budget', 'transfer', 'token-transfer', 'create-token-account', 'memo', 'gives-control', 'unrecognized']);
    assert.equal(rows[0].muted, true);
    assert.equal(rows[2].text, `Send 2.5 USDC (devnet) to ${recipientOwner.toBase58().slice(0, 8)}…${recipientOwner.toBase58().slice(-8)}`);
    assert.equal(rows[2].warning, undefined);
    assert.ok(rows[2].details.some((d) => d.includes(destination.toBase58())));
    assert.equal(rows[4].text, 'Memo: "order #42"');
    assert.equal(rows[5].danger, true);
    assert.match(rows[6].text, /^Unrecognized instruction · program \w{8}…\w{8} · 1 account$/);
});

test('a token transfer to an account that is not a token account of that mint is flagged', async () => {
    const source = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const data = Buffer.alloc(165);
    USDC_DEVNET.toBuffer().copy(data, 0);
    vault.toBuffer().copy(data, 32);
    chain.state.accounts.set(source.toBase58(), { owner: TOKEN.toBase58(), data, lamports: 1 });
    const mintData = Buffer.alloc(82);
    mintData[44] = 6;
    chain.state.accounts.set(USDC_DEVNET.toBase58(), { owner: TOKEN.toBase58(), data: mintData, lamports: 1 });
    const plain = new TransactionInstruction({
        programId: TOKEN,
        keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: destination, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([3, ...Buffer.from(new BigUint64Array([1_000_000n]).buffer)]),
    });
    let review;
    configure({}, [(r) => ((review = r), false)]);
    await rejection(W.getLazorkitClient().signAndSend({ instructions: [plain] }));
    assert.match(review.rows[0].text, /^Send 1 USDC \(devnet\) to /, 'decimals read from the mint');
    assert.equal(review.rows[0].warning, "The recipient's token account does not exist yet.");
});

test('the app changing its instruction objects while the review is open changes nothing that is signed', async () => {
    const recipient = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const instructions = [SystemProgram.transfer({ fromPubkey: vault, toPubkey: recipient, lamports: 7 })];
    configure({}, [
        () => {
            instructions[0].keys[1].pubkey = attacker;
            instructions[0].data = Buffer.from(instructions[0].data).fill(9, 4);
            return true;
        },
    ]);
    await W.getLazorkitClient().signAndSend({ instructions });
    const keys = chain.state.sent[0].message.staticAccountKeys.map((k) => k.toBase58());
    assert.ok(keys.includes(recipient.toBase58()), 'the reviewed recipient is in the sent transaction');
    assert.ok(!keys.includes(attacker.toBase58()), 'the swapped one is not');
});

test('the built-in sheet: rows as text, Approve signs, Cancel rejects (data-lk hooks)', async () => {
    configure({ ui: undefined });
    const sending = W.getLazorkitClient().signAndSend({ instructions: transfer(1) });
    const dialog = await new Promise((resolve) => {
        const look = () => {
            const d = document.querySelector('dialog[data-lk="review"]');
            if (d) resolve(d);
            else setTimeout(look, 5);
        };
        look();
    });
    assert.equal(dialog.querySelector('h2').textContent, 'Review transaction');
    assert.match(dialog.textContent, /Send 0\.000000001 SOL to/);
    assert.match(dialog.textContent, /Network fee: paid by Test App/);
    dialog.querySelector('[data-lk="approve"]').click();
    await sending;
    assert.equal(document.querySelector('dialog[data-lk="review"]'), null, 'closed');
    assert.equal(chain.state.sent.length, 1);

    const cancelled = W.getLazorkitClient().signAndSend({ instructions: transfer(1) });
    await new Promise((resolve) => {
        const look = () => (document.querySelector('[data-lk="cancel"]') ? resolve() : setTimeout(look, 5));
        look();
    });
    document.querySelector('[data-lk="cancel"]').click();
    const error = await rejection(cancelled);
    assert.equal(error.reason, 'review-cancelled');
});

test('the status is signing for the whole send, with its steps', async () => {
    const steps = [];
    configure({}, [true]);
    const unsubscribe = W.useWalletStore.subscribe((s) => {
        const status = W.deriveStatus(s);
        const entry = `${status}:${s.step}`;
        if (steps[steps.length - 1] !== entry) steps.push(entry);
    });
    await W.getLazorkitClient().signAndSend({ instructions: transfer() });
    unsubscribe();
    assert.deepEqual(steps, ['signing:preparing', 'signing:reviewing', 'signing:preparing', 'signing:awaiting-passkey', 'signing:submitted', 'connected:null']);
});

// ─── A v1 wallet (gate G4: usable until v1 is retired) ──────────────────────

test('a v1 wallet restored in Embedded mode: sent through the v1 relayer, its authority read with no scan; 4018 is V1WalletRetiredError, sent once', async () => {
    const V1 = W.PROGRAM_ID_DEVNET_V1;
    const V1_PAYMASTER = 'http://paymaster-v1.test/';
    const old = credential({ rpId: RP_ID, userHandle: randomBytes(16) });
    authenticator.add(old);
    const credentialIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', old.rawId));
    // v1's PDA seeds have no `lk2:` prefix.
    const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), V1)[0];
    const walletV1 = pda('wallet', randomBytes(32));
    const vaultV1 = pda('vault', walletV1.toBuffer());
    const authorityV1 = pda('authority', walletV1.toBuffer(), credentialIdHash);
    // v1's layout: Authority discriminator 2, Secp256r1 at 1, Owner, counter
    // at 8, wallet at 16, credential hash at 48, key at 80.
    const authority = Buffer.alloc(145);
    authority[0] = 2;
    authority[1] = 1;
    authority.writeUInt32LE(4, 8);
    walletV1.toBuffer().copy(authority, 16);
    Buffer.from(credentialIdHash).copy(authority, 48);
    old.key.compressed.copy(authority, 80);
    chain.state.accounts.set(authorityV1.toBase58(), { owner: V1.toBase58(), data: authority, lamports: 1_000_000 });
    chain.state.accounts.set(walletV1.toBase58(), { owner: V1.toBase58(), data: Buffer.from([1, 0xfe, 0, 0, 1, 0, 0, 0]), lamports: 1_000_000 });

    // The record Embedded mode keeps, for a v1 wallet this passkey reached through the 3.3 lookup.
    localStorage.setItem(
        `lazorkit:embedded:${RP_ID}:store`,
        JSON.stringify({
            state: {
                wallet: {
                    credentialId: Buffer.from(old.rawId).toString('base64'),
                    passkeyPubkey: [...old.key.compressed],
                    expo: 'web',
                    platform: '',
                    walletDevice: '',
                    smartWallet: walletV1.toBase58(),
                    vaultPda: vaultV1.toBase58(),
                    protocolVersion: 1,
                    mode: 'embedded',
                    rpId: RP_ID,
                    programId: V1.toBase58(),
                    how: 'adopted',
                    connectedAt: new Date().toISOString(),
                },
            },
            version: 0,
        }),
    );
    const paid = [];
    let retired = false;
    globalThis.fetch = async (url, init) => {
        if (String(url) !== V1_PAYMASTER) return chain.fetch(url, init);
        const body = JSON.parse(init.body);
        paid.push(body.method);
        if (retired && body.method === 'signAndSendTransaction') {
            return new Response(
                JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32002, message: 'Transaction simulation failed: custom program error: 0xfb2', data: { logs: [] } } }),
                { status: 200 },
            );
        }
        return chain.fetch(PAYMASTER, init);
    };

    const page = await freshPage();
    const client = page.createLazorkitClient(
        embeddedConfig({ ui: scriptedUi(), confirm: false, v1PaymasterConfig: { paymasterUrl: V1_PAYMASTER } }),
    );
    assert.equal(client.getState().wallet?.smartWallet, walletV1.toBase58(), 'a v1 record of this rpId is restored');
    const toSelf = [SystemProgram.transfer({ fromPubkey: vaultV1, toPubkey: vaultV1, lamports: 0 })];

    const signature = await client.signAndSend({ instructions: toSelf });
    assert.equal(typeof signature, 'string');
    assert.ok(paid.includes('signAndSendTransaction'), 'sent through the v1 relayer');
    const sent = chain.state.sent[chain.state.sent.length - 1];
    const keys = sent.message.staticAccountKeys.map((k) => k.toBase58());
    assert.ok(keys.includes(V1.toBase58()), "v1's program");
    assert.ok(!keys.includes(chain.PROGRAM.toBase58()), "not v2's");
    assert.equal(chain.calls('getProgramAccounts').length, 0, 'no scan');
    assert.ok(chain.calls('getAccountInfo').some((c) => c.params[0] === authorityV1.toBase58()), 'the v1 authority, read where it is');

    // The v1 program retired: the relayer's 4018 is V1WalletRetiredError, and is sent once.
    retired = true;
    paid.length = 0;
    const error = await rejection(client.signAndSend({ instructions: toSelf }));
    assert.ok(error instanceof page.V1WalletRetiredError, String(error));
    assert.equal(paid.filter((m) => m === 'signAndSendTransaction').length, 1, '4018 is not retried');
    assert.equal(page.userMessage(error), "This wallet's old version is retired. Move it to the new version to continue.");
});

void RPC;
