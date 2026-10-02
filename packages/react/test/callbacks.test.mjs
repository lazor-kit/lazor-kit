// When an action's onSuccess / onFail run, and what they can change, through
// the built package (`pnpm build` first): the store against a scripted RPC
// and paymaster where every transaction lands, no network. The contract, the
// same as the mobile adapter's:
// - C1 the callback runs once `isSigning` / `isConnecting` is false again,
//   right before the promise settles;
// - C2 exactly one callback per call, agreeing with the promise, refusals
//   included;
// - C3 what a callback throws changes nothing (a landed transaction is never
//   reported as failed);
// - C4 a send started from a callback runs;
// - C5 every declared callback is honoured (disconnect, removeAuthority);
// - C6 a throwing adapter / Wallet Standard listener does not fail connect,
//   nor stop the listeners after it.
// A call refused because another is running is the one exception to C1: its
// onFail runs at once, while the running call still holds the flag. And
// disconnect leaves `isSigning` to an action still running, as on mobile.
// Run with `pnpm test`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Connection, Keypair } from '@solana/web3.js';

// A browser-ish global scope: localStorage for the wallet's storage, and a
// window and document (the adapter is "Installed" only with both) on which
// `registerWallet` hands over the Wallet Standard wallet.
const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
};
let standardWallet;
globalThis.window = {
    dispatchEvent: (event) => event.detail({ register: (wallet) => (standardWallet = wallet) }),
    addEventListener: () => {},
};
globalThis.document = {};
const W = await import('../dist/index.mjs');

const PAYMASTER = 'http://paymaster.test/';
const RPC = 'http://rpc.test/';
const feePayer = Keypair.generate().publicKey;
const LAZORKIT = W.PROGRAM_ID_DEVNET.toBase58();
/** DeferredExec accounts that exist, with an authorization still open. */
const openAuthorizations = new Set();
let sends = 0;
/** The paymaster answers a send once this settles (see `holdSends`). */
let sendGate = Promise.resolve();
let heldSends = 0;

const rpcFetch = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    if (method === 'getLatestBlockhash') {
        return reply({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1e9 } });
    }
    if (method === 'getAccountInfo' && openAuthorizations.has(params[0])) {
        const data = Buffer.alloc(176);
        data.writeBigUInt64LE(1000n, 168);
        return reply({
            context: { slot: 500 },
            value: { data: [data.toString('base64'), 'base64'], executable: false, lamports: 2_000_000, owner: LAZORKIT, rentEpoch: 0, space: 176 },
        });
    }
    if (method === 'getAccountInfo') return reply({ context: { slot: 1 }, value: null });
    if (method === 'getMultipleAccounts') return reply({ context: { slot: 1 }, value: params[0].map(() => null) });
    // Every transaction lands, successfully.
    if (method === 'getSignatureStatuses') {
        return reply({ context: { slot: 2000 }, value: params[0].map(() => ({ slot: 600, confirmations: 1, err: null, confirmationStatus: 'confirmed' })) });
    }
    throw new Error(`unscripted RPC ${method}`);
};
globalThis.fetch = async (url, init) => {
    assert.equal(String(url), PAYMASTER);
    const { id, method } = JSON.parse(init.body);
    const answer = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status: 200 });
    if (method === 'getPayerSigner') return answer({ result: { signer_address: feePayer.toBase58() } });
    if (method === 'signAndSendTransaction') {
        sends++;
        heldSends++;
        await sendGate;
        return answer({ result: { signature: Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58() } });
    }
    throw new Error(`unscripted paymaster ${method}`);
};

// What a callback throws is logged; keep the output to the assertions.
const logged = [];
console.error = (...args) => logged.push(args);

const store = W.useWalletStore;
const storedWallet = () => ({
    credentialId: 'dGVzdA==',
    passkeyPubkey: [2, ...new Array(32).fill(1)],
    smartWallet: Keypair.generate().publicKey.toBase58(),
    walletDevice: '',
    vaultPda: Keypair.generate().publicKey.toBase58(),
    protocolVersion: 2,
});

beforeEach(() => {
    logged.length = 0;
    store.setState({
        connection: new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch, disableRetryOnRateLimit: true }),
        config: { portalUrl: 'http://portal.test', paymasterConfig: { paymasterUrl: PAYMASTER }, rpcUrl: RPC },
        wallet: null,
        isSigning: false,
        isConnecting: false,
        error: null,
    });
});

/** A serialized deferred payload whose authorization is open: executeDeferred sends it, and it lands. */
function deferredPayload() {
    const deferredExecPda = Keypair.generate().publicKey;
    openAuthorizations.add(deferredExecPda.toBase58());
    return W.serializeDeferredPayload({
        walletPda: Keypair.generate().publicKey,
        deferredExecPda,
        compactInstructions: [],
        remainingAccounts: [],
    });
}

/** Holds the paymaster's sends until the returned function is called. */
function holdSends() {
    let release;
    sendGate = new Promise((resolve) => (release = resolve));
    heldSends = 0;
    return () => {
        sendGate = Promise.resolve();
        release();
    };
}

async function until(condition, what) {
    for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(condition(), `timed out waiting for ${what}`);
}

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('resolved');
}

test('C1: onSuccess runs once isSigning is false, right before the promise resolves', async () => {
    const order = [];
    let signingInCallback;
    const signature = await store
        .getState()
        .executeDeferred({
            deferredPayload: deferredPayload(),
            onSuccess: (result) => {
                signingInCallback = store.getState().isSigning;
                order.push(['onSuccess', result]);
            },
        })
        .then((result) => {
            order.push(['resolved', result]);
            return result;
        });
    assert.equal(signingInCallback, false);
    assert.deepEqual(order, [['onSuccess', signature], ['resolved', signature]]);
});

test('C1, C2: onFail runs once isSigning is false, with the error the promise rejects with', async () => {
    const calls = [];
    const error = await rejection(
        store.getState().executeDeferred({
            deferredPayload: 'not a payload',
            onSuccess: () => calls.push('onSuccess'),
            onFail: (e) => calls.push(['onFail', e, store.getState().isSigning]),
        }),
    );
    assert.deepEqual(calls, [['onFail', error, false]]);
    assert.equal(store.getState().error, error);
});

test('C4: a send started from onSuccess runs', async () => {
    let nested;
    await store.getState().executeDeferred({
        deferredPayload: deferredPayload(),
        onSuccess: () => {
            nested = store.getState().executeDeferred({ deferredPayload: deferredPayload() });
        },
    });
    assert.equal(typeof (await nested), 'string');
    assert.equal(store.getState().isSigning, false);
});

test('C3: a throwing onSuccess does not turn a landed transaction into a failure', async () => {
    const before = sends;
    const failures = [];
    const signature = await store.getState().executeDeferred({
        deferredPayload: deferredPayload(),
        onSuccess: () => {
            throw new Error('app bug in onSuccess');
        },
        onFail: (error) => failures.push(error),
    });
    assert.equal(sends - before, 1);
    assert.equal(typeof signature, 'string');
    assert.deepEqual(failures, []);
    assert.equal(store.getState().error, null);
    assert.equal(logged.length, 1);
});

test("C3: a throwing onFail does not replace the action's error", async () => {
    const error = await rejection(
        store.getState().executeDeferred({
            deferredPayload: 'not a payload',
            onFail: () => {
                throw new Error('app bug in onFail');
            },
        }),
    );
    assert.notEqual(error.message, 'app bug in onFail');
    assert.equal(store.getState().error, error);
});

/** Every action that takes callbacks, called with `callbacks`. */
const actions = {
    signAndSendTransaction: (callbacks) => store.getState().signAndSendTransaction({ instructions: [], ...callbacks }),
    signMessage: (callbacks) => store.getState().signMessage('hello', callbacks),
    createSession: (callbacks) => store.getState().createSession({ unrestricted: true, ...callbacks }),
    revokeSession: (callbacks) => store.getState().revokeSession({ ...callbacks }),
    signAndSendWithSession: (callbacks) => store.getState().signAndSendWithSession({ instructions: [], ...callbacks }),
    addAuthority: (callbacks) => store.getState().addAuthority({ unrestricted: true, ...callbacks }),
    removeAuthority: (callbacks) => store.getState().removeAuthority(Keypair.generate().publicKey.toBase58(), callbacks),
    signAndSendWithAuthority: (callbacks) => store.getState().signAndSendWithAuthority({ instructions: [], ...callbacks }),
    authorizeAndExecute: (callbacks) => store.getState().authorizeAndExecute({ instructions: [], ...callbacks }),
    authorizeDeferred: (callbacks) => store.getState().authorizeDeferred({ instructions: [], ...callbacks }),
    executeDeferred: (callbacks) => store.getState().executeDeferred({ deferredPayload: deferredPayload(), ...callbacks }),
};
const needsWallet = ['signAndSendTransaction', 'signMessage', 'createSession', 'revokeSession', 'addAuthority', 'removeAuthority', 'authorizeAndExecute', 'authorizeDeferred'];

test('C2: a call refused while another is signing calls its onFail at once, and leaves error and isSigning (the running call\'s) alone', async () => {
    for (const [name, call] of Object.entries(actions)) {
        const running = new Error('the running call');
        store.setState({ isSigning: true, error: running, wallet: storedWallet() });
        const calls = [];
        const error = await rejection(
            call({ onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push([e, store.getState().isSigning]) }),
        );
        assert.equal(error.message, 'Already signing', name);
        assert.deepEqual(calls, [[error, true]], name);
        assert.equal(store.getState().error, running, name);
        assert.equal(store.getState().isSigning, true, name);
    }
});

test('C2: a call refused for want of a wallet calls its onFail, and records the error', async () => {
    for (const name of needsWallet) {
        store.setState({ isSigning: false, error: null, wallet: null });
        const calls = [];
        const error = await rejection(actions[name]({ onSuccess: () => calls.push('onSuccess'), onFail: (e) => calls.push(e) }));
        assert.equal(error.message, 'No wallet connected', name);
        assert.deepEqual(calls, [error], name);
        assert.equal(store.getState().error, error, name);
        assert.equal(store.getState().isSigning, false, name);
    }
});

test('C1, C3: connect calls onSuccess once isConnecting is false, and a throwing one does not fail it', async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    let connectingInCallback;
    const connected = await store.getState().connect({
        onSuccess: (result) => {
            connectingInCallback = store.getState().isConnecting;
            assert.equal(result.smartWallet, wallet.smartWallet);
        },
    });
    assert.equal(connected.smartWallet, wallet.smartWallet);
    assert.equal(connectingInCallback, false);

    store.setState({ wallet: null });
    const failures = [];
    const again = await store.getState().connect({
        onSuccess: () => {
            throw new Error('app bug in onSuccess');
        },
        onFail: (error) => failures.push(error),
    });
    assert.equal(again.smartWallet, wallet.smartWallet);
    assert.deepEqual(failures, []);
    assert.equal(store.getState().error, null);
    assert.equal(store.getState().wallet.smartWallet, wallet.smartWallet);
    await W.StorageManager.clearWallet();
});

test("C2: a connect refused while one runs calls its onFail at once, and leaves error and isConnecting alone", async () => {
    const running = new Error('the running connect');
    store.setState({ isConnecting: true, error: running });
    const calls = [];
    const error = await rejection(store.getState().connect({ onFail: (e) => calls.push([e, store.getState().isConnecting]) }));
    assert.equal(error.message, 'Already connecting');
    assert.deepEqual(calls, [[error, true]]);
    assert.equal(store.getState().error, running);
    assert.equal(store.getState().isConnecting, true);
});

test('disconnect leaves isSigning to the action still running: a second one is refused, and the first calls back once it is over', async () => {
    const release = holdSends();
    store.setState({ wallet: storedWallet() });
    const order = [];
    let nested;
    const first = store.getState().executeDeferred({
        deferredPayload: deferredPayload(),
        onSuccess: () => {
            order.push(['first onSuccess', store.getState().isSigning]);
            nested = store.getState().executeDeferred({ deferredPayload: deferredPayload() });
        },
    });
    await until(() => heldSends === 1, 'the first send to reach the paymaster');

    await store.getState().disconnect();
    assert.equal(store.getState().wallet, null);
    assert.equal(store.getState().isSigning, true);
    const refused = await rejection(store.getState().executeDeferred({ deferredPayload: deferredPayload() }));
    assert.equal(refused.message, 'Already signing');
    assert.equal(heldSends, 1);

    release();
    assert.equal(typeof (await first), 'string');
    assert.deepEqual(order, [['first onSuccess', false]]);
    assert.equal(typeof (await nested), 'string');
    assert.equal(store.getState().isSigning, false);
});

test('C5: disconnect and removeAuthority honour their callbacks', async () => {
    store.setState({ wallet: storedWallet() });
    const calls = [];
    await store.getState().disconnect({ onSuccess: () => calls.push('disconnect onSuccess'), onFail: () => calls.push('onFail') });
    assert.deepEqual(calls, ['disconnect onSuccess']);
    assert.equal(store.getState().wallet, null);

    const error = await rejection(
        store.getState().removeAuthority(Keypair.generate().publicKey.toBase58(), { onFail: (e) => calls.push(e) }),
    );
    assert.equal(calls.at(-1), error);
});

test('C6: a throwing adapter listener does not fail connect or disconnect', async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    const adapter = new W.LazorkitWalletAdapter({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER } });
    const errors = [];
    adapter.on('error', (error) => errors.push(error));
    adapter.on('connect', () => {
        throw new Error('app bug in a connect listener');
    });
    adapter.on('disconnect', () => {
        throw new Error('app bug in a disconnect listener');
    });
    await adapter.connect();
    assert.equal(adapter.connected, true);
    assert.equal(adapter.publicKey.toBase58(), wallet.vaultPda);
    await adapter.disconnect();
    assert.equal(adapter.connected, false);
    assert.deepEqual(errors, []);
    assert.equal(logged.length, 2);
});

test('C6: a throwing adapter listener does not stop the listeners after it, which run as emit runs them', async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    const adapter = new W.LazorkitWalletAdapter({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER } });
    const calls = [];
    const context = { name: 'the context given to on' };
    for (const event of ['connect', 'disconnect']) {
        adapter.on(event, () => {
            throw new Error(`app bug in a ${event} listener`);
        });
        // As wallet-adapter-react's WalletProvider registers its own.
        adapter.on(event, (...args) => calls.push([event, 'after the throwing one', ...args.map(String)]));
        adapter.once(event, () => calls.push([event, 'once']));
        adapter.on(event, function () {
            calls.push([event, 'with a context', this]);
        }, context);
    }
    await adapter.connect();
    await adapter.disconnect();
    await W.StorageManager.saveWallet(wallet); // disconnect forgot it
    await adapter.connect();
    assert.deepEqual(calls, [
        ['connect', 'after the throwing one', wallet.vaultPda],
        ['connect', 'once'],
        ['connect', 'with a context', context],
        ['disconnect', 'after the throwing one'],
        ['disconnect', 'once'],
        ['disconnect', 'with a context', context],
        ['connect', 'after the throwing one', wallet.vaultPda],
        ['connect', 'with a context', context],
    ]);
    assert.equal(adapter.listenerCount('connect'), 3);
    assert.equal(logged.length, 3);
    await adapter.disconnect();
    await W.StorageManager.clearWallet();
});

test("C6: a throwing Wallet Standard listener does not fail standard:connect, nor stop the other listeners", async () => {
    const wallet = storedWallet();
    await W.StorageManager.saveWallet(wallet);
    W.registerLazorkitWallet({ rpcUrl: RPC, paymasterConfig: { paymasterUrl: PAYMASTER } });
    assert.ok(standardWallet);
    const changes = [];
    standardWallet.features['standard:events'].on('change', () => {
        throw new Error('app bug in a change listener');
    });
    standardWallet.features['standard:events'].on('change', (change) => changes.push(change.accounts.length));
    const { accounts } = await standardWallet.features['standard:connect'].connect();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].address, wallet.vaultPda);
    assert.deepEqual(changes, [1]);
    await standardWallet.features['standard:disconnect'].disconnect();
    assert.deepEqual(changes, [1, 0]);
    await W.StorageManager.clearWallet();
});
