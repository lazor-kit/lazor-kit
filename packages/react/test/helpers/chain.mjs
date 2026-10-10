// A scripted Solana devnet and paymaster, for tests through the built
// package. No network. The paymaster signs as a real fee payer and "lands"
// what LazorKit's CreateWallet and Execute would change (a wallet account, a
// passkey authority, its counter), so reads after a send see it, and records
// every transaction so `getSignaturesForAddress` / `getTransaction` give it
// back. What is scripted: accounts, a transaction history, simulation
// results, and paymaster misbehaviour (`paymaster.mode`).
import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import {
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    TransactionInstruction,
    TransactionMessage,
    VersionedMessage,
    VersionedTransaction,
} from '@solana/web3.js';

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

export const RPC = 'http://rpc.test/';
export const PAYMASTER = 'http://paymaster.test/';
export const FEE_PAYER = Keypair.fromSeed(new Uint8Array(32).fill(7));
const BLOCKHASH = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
const SYSVAR_OWNER = 'Sysvar1111111111111111111111111111111111111';

/**
 * The chain. `W` is the package under test (for its program ids and PDA
 * helpers). Install with `globalThis.fetch = chain.fetch`.
 */
export function scriptedChain(W) {
    const PROGRAM = W.PROGRAM_ID_DEVNET;
    const state = {
        /** address → { owner, data: Buffer, lamports } */
        accounts: new Map(),
        /** Every transaction landed, oldest first: { signature, slot, tx, err } */
        history: [],
        /** Extra history per address (newest first), as getSignaturesForAddress rows. */
        extraHistory: new Map(),
        slot: 5000,
        /** The Clock sysvar's unix_timestamp, in seconds (sessions expire by it). */
        unixTimestamp: 1_790_000_000n,
        /** Every RPC call: { method, params }. */
        rpcCalls: [],
        /** Every transaction the paymaster was asked to send. */
        sent: [],
        /** `null`, or 'fail' (refuse every send), 'foreign-signature' (land it, return another signature), 'rpc-down' (every RPC 500). */
        mode: null,
        /** What `simulateTransaction` answers: { err, logs, vaultLamportsAfter }. */
        simulation: { err: null, logs: [] },
    };

    const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    const accountJson = (a) =>
        a
            ? { data: [Buffer.from(a.data).toString('base64'), 'base64'], executable: false, lamports: a.lamports ?? 2_000_000, owner: a.owner, rentEpoch: 0, space: a.data.length }
            : null;
    const ctx = () => ({ slot: state.slot });

    /** The Clock sysvar at the current slot: slot, epoch start, epoch, leader epoch, unix_timestamp. */
    function clockAccount() {
        const data = Buffer.alloc(40);
        data.writeBigUInt64LE(BigInt(state.slot), 0);
        data.writeBigInt64LE(state.unixTimestamp, 32);
        return { owner: SYSVAR_OWNER, data };
    }
    const accountAt = (address) => (address === CLOCK_SYSVAR ? clockAccount() : state.accounts.get(address));

    function matches(account, filters = []) {
        return filters.every((f) => {
            if (f.dataSize !== undefined) return account.data.length === f.dataSize;
            const { offset, bytes, encoding } = f.memcmp;
            const want = encoding === 'base64' ? Buffer.from(bytes, 'base64') : Buffer.from(bs58.decode(bytes));
            return account.data.length >= offset + want.length && Buffer.from(account.data.subarray(offset, offset + want.length)).equals(want);
        });
    }

    function txJson(entry) {
        const message = entry.tx.message;
        const keys = message.staticAccountKeys.map((k) => k.toBase58());
        return {
            slot: entry.slot,
            blockTime: null,
            version: 0,
            transaction: {
                signatures: [entry.signature],
                message: {
                    header: message.header,
                    accountKeys: keys,
                    recentBlockhash: message.recentBlockhash,
                    instructions: message.compiledInstructions.map((ix) => ({
                        programIdIndex: ix.programIdIndex,
                        accounts: ix.accountKeyIndexes,
                        data: bs58.encode(ix.data),
                    })),
                    addressTableLookups: [],
                },
            },
            meta: {
                err: entry.err ?? null,
                fee: 5000,
                preBalances: keys.map(() => 0),
                postBalances: keys.map(() => 0),
                innerInstructions: entry.inner ?? [],
                logMessages: [],
                loadedAddresses: { writable: [], readonly: [] },
                preTokenBalances: [],
                postTokenBalances: [],
                rewards: [],
                status: { Ok: null },
            },
        };
    }

    async function rpc(body) {
        const { id, method, params } = body;
        state.rpcCalls.push({ method, params });
        if (state.mode === 'rpc-down') return new Response('{"error":"down"}', { status: 500 });
        switch (method) {
            case 'getSlot':
                return reply(id, state.slot);
            case 'getEpochInfo':
                return reply(id, { absoluteSlot: state.slot, blockHeight: 1, epoch: 1, slotIndex: 1, slotsInEpoch: 432000, transactionCount: 1 });
            case 'getLatestBlockhash':
                return reply(id, { context: ctx(), value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1e9 } });
            case 'getAccountInfo':
                return reply(id, { context: ctx(), value: accountJson(accountAt(params[0])) });
            case 'getBalance':
                return reply(id, { context: ctx(), value: state.accounts.get(params[0])?.lamports ?? 0 });
            case 'getMultipleAccounts':
                return reply(id, { context: ctx(), value: params[0].map((a) => accountJson(accountAt(a))) });
            case 'getProgramAccounts': {
                const rows = [...state.accounts]
                    .filter(([, a]) => a.owner === params[0] && matches(a, params[1]?.filters))
                    .map(([pubkey, a]) => ({ pubkey, account: accountJson(a) }));
                return reply(id, params[1]?.withContext ? { context: ctx(), value: rows } : rows);
            }
            case 'getTokenAccountsByOwner':
                return reply(id, { context: ctx(), value: [] });
            case 'getSignatureStatuses':
                return reply(id, {
                    context: ctx(),
                    value: params[0].map((sig) => {
                        const entry = state.history.find((h) => h.signature === sig);
                        return entry ? { slot: entry.slot, confirmations: null, err: entry.err ?? null, confirmationStatus: 'finalized' } : null;
                    }),
                });
            case 'getSignaturesForAddress': {
                const address = params[0];
                const extra = state.extraHistory.get(address);
                if (extra) return reply(id, extra);
                const rows = state.history
                    .filter((h) => h.tx.message.staticAccountKeys.some((k) => k.toBase58() === address))
                    .reverse()
                    .map((h) => ({ signature: h.signature, slot: h.slot, err: h.err ?? null, memo: null, blockTime: null, confirmationStatus: 'finalized' }));
                return reply(id, rows.slice(0, params[1]?.limit ?? 1000));
            }
            case 'getTransaction': {
                const entry = state.history.find((h) => h.signature === params[0]);
                return reply(id, entry ? txJson(entry) : null);
            }
            case 'simulateTransaction': {
                const config = params[1] ?? {};
                const addresses = config.accounts?.addresses ?? [];
                return reply(id, {
                    context: ctx(),
                    value: {
                        err: state.simulation.err ?? null,
                        logs: state.simulation.logs ?? [],
                        accounts: addresses.length
                            ? addresses.map((a) => {
                                  const before = state.accounts.get(a);
                                  const lamports = state.simulation.vaultLamportsAfter ?? before?.lamports ?? 0;
                                  return { lamports, owner: before?.owner ?? SystemProgram.programId.toBase58(), data: ['', 'base64'], executable: false, rentEpoch: 0 };
                              })
                            : null,
                        unitsConsumed: 1000,
                        returnData: null,
                    },
                });
            }
            default:
                throw new Error(`unscripted RPC ${method}`);
        }
    }

    /** What LazorKit's instructions in `tx` change, applied to the accounts. */
    function land(tx) {
        const keys = tx.message.staticAccountKeys;
        for (const ix of tx.message.compiledInstructions) {
            if (!keys[ix.programIdIndex].equals(PROGRAM)) continue;
            const accounts = ix.accountKeyIndexes.map((i) => keys[i]);
            const data = Buffer.from(ix.data);
            if (data[0] === 0) {
                const [, wallet, , authority] = accounts;
                if (state.accounts.has(wallet.toBase58())) throw new Error('AccountAlreadyInitialized');
                const seedOffset = 1;
                const authType = data[seedOffset + 32];
                const bump = data[seedOffset + 33];
                const credentialOrKey = data.subarray(41, 73);
                const key = data.subarray(73, 106);
                const rpIdLength = data[106];
                const rpId = data.subarray(107, 107 + rpIdLength).toString('utf8');
                putWallet(wallet, { ownerCount: 1, bump: 0xfe });
                if (authType === 1) {
                    putPasskeyAuthority(authority, { wallet, credentialIdHash: credentialOrKey, publicKey: key, rpId, counter: 0, bump });
                }
            } else if (data[0] === 4) {
                bump(accounts[2]);
            } else if (data[0] === 5) {
                // CreateSession: payer, wallet, admin authority, session. Data: key (32), expires_at (8).
                const session = Buffer.alloc(80);
                session[0] = 0x23;
                accounts[1].toBuffer().copy(session, 8);
                data.copy(session, 40, 1, 33);
                data.copy(session, 72, 33, 41);
                state.accounts.set(accounts[3].toBase58(), { owner: PROGRAM.toBase58(), data: session, lamports: 1_000_000 });
                bump(accounts[2]);
            }
        }
    }

    /** A passkey authority signed: its counter moves on. */
    function bump(address) {
        const authority = state.accounts.get(address.toBase58());
        if (authority && authority.data[1] === 1) authority.data.writeUInt32LE(authority.data.readUInt32LE(8) + 1, 8);
    }

    /** Record `tx` as landed (signed by the fee payer), and return its signature. */
    function record(tx, { err, inner } = {}) {
        state.slot += 2;
        const signature = bs58.encode(tx.signatures[0]);
        state.history.push({ signature, slot: state.slot, tx, err, inner });
        return signature;
    }

    async function paymaster(body) {
        const { id, method, params } = body;
        const answer = (b) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...b }), { status: 200 });
        if (method === 'getPayerSigner') return answer({ result: { signer_address: FEE_PAYER.publicKey.toBase58() } });
        if (method !== 'signAndSendTransaction') throw new Error(`unscripted paymaster ${method}`);
        const tx = VersionedTransaction.deserialize(Buffer.from(params.transaction, 'base64'));
        state.sent.push(tx);
        if (state.mode === 'fail') return answer({ error: { code: -32000, message: 'the paymaster refused this transaction' } });
        tx.sign([FEE_PAYER]);
        try {
            land(tx);
        } catch (error) {
            return answer({ error: { code: -32002, message: `Transaction simulation failed: ${error.message}` } });
        }
        const signature = record(tx);
        if (state.mode === 'foreign-signature') {
            // Its own transfer, landed, reported as this one.
            const other = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: FEE_PAYER.publicKey,
                    recentBlockhash: BLOCKHASH,
                    instructions: [SystemProgram.transfer({ fromPubkey: FEE_PAYER.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
                }).compileToV0Message(),
            );
            other.sign([FEE_PAYER]);
            return answer({ result: { signature: record(other) } });
        }
        return answer({ result: { signature } });
    }

    function putWallet(wallet, { ownerCount = 1, bump = 0xfe } = {}) {
        const data = Buffer.alloc(8);
        data[0] = 0x21;
        data[1] = bump;
        data[2] = 1;
        data.writeUInt32LE(ownerCount, 4);
        state.accounts.set(wallet.toBase58(), { owner: PROGRAM.toBase58(), data, lamports: 1_000_000 });
    }

    function putPasskeyAuthority(authority, { wallet, credentialIdHash, publicKey, rpId, counter = 0, role = 0, bump = 0xfd }) {
        const data = Buffer.alloc(145);
        data[0] = 0x22;
        data[1] = 1;
        data[2] = role;
        data[3] = bump;
        data[4] = 1;
        data.writeUInt32LE(counter, 8);
        wallet.toBuffer().copy(data, 16);
        Buffer.from(credentialIdHash).copy(data, 48);
        Buffer.from(publicKey).copy(data, 80);
        sha256(rpId).copy(data, 113);
        state.accounts.set(authority.toBase58(), { owner: PROGRAM.toBase58(), data, lamports: 1_000_000 });
    }

    /** A CreateWallet instruction as sdk-legacy builds it (no fee accounts). */
    function createWalletIx({ seed, wallet, authority, credentialIdHash, publicKey, rpId, authType = 1 }) {
        const [vault] = W.findVaultPda(wallet, PROGRAM);
        const rp = Buffer.from(rpId, 'utf8');
        const data = Buffer.concat([
            Buffer.from([0]),
            Buffer.from(seed),
            Buffer.from([authType, 0xfd]),
            Buffer.alloc(6),
            Buffer.from(credentialIdHash),
            Buffer.from(publicKey),
            Buffer.from([rp.length]),
            rp,
        ]);
        return new TransactionInstruction({
            programId: PROGRAM,
            keys: [
                { pubkey: FEE_PAYER.publicKey, isSigner: true, isWritable: true },
                { pubkey: wallet, isSigner: false, isWritable: true },
                { pubkey: vault, isSigner: false, isWritable: true },
                { pubkey: authority, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            ],
            data,
        });
    }

    /** A LazorKit instruction with only a discriminator and these accounts (an AddAuthority, say). */
    const lazorkitIx = (disc, accounts) =>
        new TransactionInstruction({
            programId: PROGRAM,
            keys: accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
            data: Buffer.from([disc, ...randomBytes(8)]),
        });

    /** Record a landed transaction with these instructions (history only; accounts unchanged). */
    function recordTransaction(instructions) {
        const tx = new VersionedTransaction(
            new TransactionMessage({ payerKey: FEE_PAYER.publicKey, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message(),
        );
        tx.sign([FEE_PAYER]);
        return record(tx);
    }

    /**
     * A wallet on chain at `seed` (random by default) whose Owner is
     * `cred`'s passkey under `rpId`. `created`: its creation is in the
     * history, made by this passkey alone (R32), or as a plant ('plant').
     */
    function walletFor(cred, { rpId, seed = randomBytes(32), counter = 0, ownerCount = 1, created = null, key } = {}) {
        const [wallet] = W.findWalletPda(seed, PROGRAM);
        const credentialIdHash = sha256(cred.rawId);
        const [authority] = W.findAuthorityPda(wallet, credentialIdHash, PROGRAM);
        const [vault] = W.findVaultPda(wallet, PROGRAM);
        putWallet(wallet, { ownerCount });
        putPasskeyAuthority(authority, { wallet, credentialIdHash, publicKey: key ?? cred.key.compressed, rpId, counter });
        if (created === 'alone') {
            recordTransaction([createWalletIx({ seed, wallet, authority, credentialIdHash, publicKey: key ?? cred.key.compressed, rpId })]);
        } else if (created === 'plant') {
            const attacker = Keypair.generate().publicKey;
            const [attackerAuthority] = W.findAuthorityPda(wallet, attacker.toBytes(), PROGRAM);
            recordTransaction([
                createWalletIx({ seed, wallet, authority: attackerAuthority, credentialIdHash: attacker.toBytes(), publicKey: Buffer.alloc(33), rpId, authType: 0 }),
                lazorkitIx(4, [FEE_PAYER.publicKey, wallet, attackerAuthority, vault]),
                lazorkitIx(1, [FEE_PAYER.publicKey, wallet, attackerAuthority, authority]),
                lazorkitIx(2, [FEE_PAYER.publicKey, wallet, attackerAuthority, attackerAuthority]),
            ]);
        }
        return { seed: Buffer.from(seed), wallet, vault, authority };
    }

    return {
        state,
        PROGRAM,
        putWallet,
        putPasskeyAuthority,
        walletFor,
        recordTransaction,
        createWalletIx,
        reset() {
            state.accounts.clear();
            state.history.length = 0;
            state.extraHistory.clear();
            state.rpcCalls.length = 0;
            state.sent.length = 0;
            state.mode = null;
            state.simulation = { err: null, logs: [] };
        },
        /** RPC calls of `method` so far. */
        calls: (method) => state.rpcCalls.filter((c) => c.method === method),
        async fetch(url, init) {
            const body = JSON.parse(init.body);
            if (String(url) === PAYMASTER) return paymaster(body);
            if (String(url) === RPC) {
                if (Array.isArray(body)) throw new Error('batch RPC is not scripted');
                return rpc(body);
            }
            throw new Error(`unexpected fetch ${url}`);
        },
        /** The message a sent transaction signs, for checking what was sent. */
        messageOf: (tx) => VersionedMessage.deserialize(tx.message.serialize()),
    };
}
