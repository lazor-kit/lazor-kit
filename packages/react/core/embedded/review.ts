/**
 * What the review sheet shows before an Easy `signAndSend` in Embedded mode
 * (D14): the app's instructions decoded into lines a person can check, and a
 * simulation on the app's own cluster with the vault's balance change.
 *
 * It exists to catch the app's mistakes (a wrong amount, a wrong recipient),
 * not a malicious app: the app draws this page, and the passkey prompt shows
 * nothing about the transaction. Decoded: System transfers (and anything that
 * hands the vault to another program), SPL Token and Token-2022 transfers,
 * approvals, authority changes and closes, associated token account creation,
 * compute budget and memos. Anything else is shown as an unrecognized
 * instruction with its program and accounts.
 *
 * Built before the challenge is prepared: a passkey challenge names a slot
 * and the program accepts it for about 150 slots, so a person reading this
 * sheet must not hold a challenge open.
 */
import { Buffer } from 'buffer';
import {
    type AccountInfo,
    type AddressLookupTableAccount,
    type Connection,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { MINT_NAMES } from '../portal/WalletChoiceView';
import type { TxReview, TxReviewRow } from './types';

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const MEMO = ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'];

/**
 * A copy of the instructions and lookup tables as they are now: the sheet
 * reviews it, and the same copy is prepared, signed and sent. An app that
 * reuses or changes its instruction objects afterwards changes nothing.
 */
export function snapshotInstructions(instructions: readonly TransactionInstruction[]): TransactionInstruction[] {
    return instructions.map(
        (ix) =>
            new TransactionInstruction({
                programId: new PublicKey(ix.programId.toBytes()),
                keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey.toBytes()), isSigner: k.isSigner, isWritable: k.isWritable })),
                data: Buffer.from(ix.data),
            }),
    );
}

/** An address as the sheet shows it: the first and last 8 characters; the full one is in the details. */
export const showAddress = (address: string): string =>
    address.length > 20 ? `${address.slice(0, 8)}…${address.slice(-8)}` : address;

/** A whole number of base units as a decimal amount, trailing zeros dropped. */
export function formatUnits(amount: bigint, decimals: number): string {
    const negative = amount < 0n;
    const abs = negative ? -amount : amount;
    const scale = 10n ** BigInt(decimals);
    const whole = abs / scale;
    const fraction = decimals > 0 ? (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
    return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

const sol = (lamports: bigint) => `${formatUnits(lamports, 9)} SOL`;
const u64 = (data: Uint8Array, offset: number): bigint | null =>
    data.length >= offset + 8 ? Buffer.from(data).readBigUInt64LE(offset) : null;
const u32 = (data: Uint8Array, offset: number): number | null =>
    data.length >= offset + 4 ? Buffer.from(data).readUInt32LE(offset) : null;
const keyAt = (data: Uint8Array, offset: number): string | null =>
    data.length >= offset + 32 ? new PublicKey(data.subarray(offset, offset + 32)).toBase58() : null;

const tokenName = (mint: string | null) => (mint ? (MINT_NAMES[mint] ?? `token ${showAddress(mint)}`) : 'tokens');

/** What a token account holds, read from its data: its mint and owner. */
interface TokenAccount {
    mint: string;
    owner: string;
}

function tokenAccountOf(info: AccountInfo<Buffer> | null | undefined): TokenAccount | null {
    if (!info) return null;
    const owner = info.owner.toBase58();
    if ((owner !== TOKEN && owner !== TOKEN_2022) || info.data.length < 165) return null;
    return { mint: new PublicKey(info.data.subarray(0, 32)).toBase58(), owner: new PublicKey(info.data.subarray(32, 64)).toBase58() };
}

function mintDecimals(info: AccountInfo<Buffer> | null | undefined): number | null {
    if (!info) return null;
    const owner = info.owner.toBase58();
    if ((owner !== TOKEN && owner !== TOKEN_2022) || info.data.length < 45) return null;
    return info.data[44];
}

async function readAccounts(connection: Connection, keys: string[]): Promise<Map<string, AccountInfo<Buffer> | null>> {
    const unique = [...new Set(keys)];
    const found = new Map<string, AccountInfo<Buffer> | null>();
    for (let i = 0; i < unique.length; i += 100) {
        const page = unique.slice(i, i + 100);
        const infos = await connection.getMultipleAccountsInfo(page.map((k) => new PublicKey(k)), 'confirmed');
        page.forEach((key, j) => found.set(key, infos[j] ?? null));
    }
    return found;
}

/**
 * The lines for `instructions`, with the chain reads they need: the vault,
 * every token account a transfer names, then the mints whose decimals a
 * plain `Transfer` does not carry.
 */
export async function describeInstructions(
    connection: Connection,
    vault: PublicKey,
    instructions: TransactionInstruction[],
): Promise<{ rows: TxReviewRow[]; vaultInfo: AccountInfo<Buffer> | null }> {
    const vaultAddress = vault.toBase58();
    const tokenAccounts: string[] = [];
    const mints: string[] = [];
    for (const ix of instructions) {
        const program = ix.programId.toBase58();
        if (program !== TOKEN && program !== TOKEN_2022) continue;
        const keys = ix.keys.map((k) => k.pubkey.toBase58());
        if (ix.data[0] === 3 && keys.length >= 2) tokenAccounts.push(keys[0], keys[1]);
        if (ix.data[0] === 12 && keys.length >= 3) {
            tokenAccounts.push(keys[2]);
            mints.push(keys[1]);
        }
    }
    const first = await readAccounts(connection, [vaultAddress, ...tokenAccounts, ...mints]);
    const sourceMints = tokenAccounts
        .map((k) => tokenAccountOf(first.get(k))?.mint)
        .filter((m): m is string => !!m && !first.has(m));
    const infos = sourceMints.length ? new Map([...first, ...(await readAccounts(connection, sourceMints))]) : first;

    const rows = instructions.map((ix) => describeOne(ix, vaultAddress, infos));
    return { rows, vaultInfo: infos.get(vaultAddress) ?? null };
}

function unrecognized(ix: TransactionInstruction, label = 'Unrecognized instruction'): TxReviewRow {
    const program = ix.programId.toBase58();
    return {
        kind: 'unrecognized',
        text: `${label} · program ${showAddress(program)} · ${ix.keys.length} account${ix.keys.length === 1 ? '' : 's'}`,
        details: [`Program ${program}`, ...ix.keys.map((k, i) => `Account ${i + 1}: ${k.pubkey.toBase58()}${k.isWritable ? ' (writable)' : ''}${k.isSigner ? ' (signer)' : ''}`)],
    };
}

function describeOne(ix: TransactionInstruction, vault: string, infos: Map<string, AccountInfo<Buffer> | null>): TxReviewRow {
    const program = ix.programId.toBase58();
    const data = new Uint8Array(ix.data);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());

    if (program === COMPUTE_BUDGET) return { kind: 'compute-budget', text: 'Compute budget', muted: true };
    if (MEMO.includes(program)) {
        return { kind: 'memo', text: `Memo: "${Buffer.from(data).toString('utf8')}"` };
    }
    if (program === SYSTEM) return describeSystem(ix, data, keys, vault);
    if (program === TOKEN || program === TOKEN_2022) return describeToken(ix, data, keys, vault, infos);
    if (program === ATA && (data.length === 0 || data[0] === 0 || data[0] === 1) && keys.length >= 4) {
        return {
            kind: 'create-token-account',
            text: `Create token account for ${showAddress(keys[2])} (${tokenName(keys[3])})`,
            details: [`Token account ${keys[1]}`, `Owner ${keys[2]}`, `Mint ${keys[3]}`],
        };
    }
    return unrecognized(ix);
}

function describeSystem(ix: TransactionInstruction, data: Uint8Array, keys: string[], vault: string): TxReviewRow {
    const index = u32(data, 0);
    switch (index) {
        case 2: {
            const lamports = u64(data, 4);
            if (lamports === null || keys.length < 2) break;
            return {
                kind: 'transfer',
                text: `Send ${sol(lamports)} to ${showAddress(keys[1])}`,
                details: [`To ${keys[1]}`, `From ${keys[0]}${keys[0] === vault ? ' (your wallet)' : ''}`],
                ...(keys[0] !== vault ? { warning: 'Paid from an account that is not your wallet.' } : {}),
            };
        }
        case 0: {
            const lamports = u64(data, 4);
            const owner = keyAt(data, 20);
            if (lamports === null || keys.length < 2) break;
            return {
                kind: 'transfer',
                text: `Fund a new account ${showAddress(keys[1])} with ${sol(lamports)}`,
                details: [`New account ${keys[1]}`, ...(owner ? [`Owned by program ${owner}`] : [])],
            };
        }
        case 1:
        case 10: {
            // Assign: owner at 4. AssignWithSeed: base (32), seed (u64 length + bytes), then owner.
            const seedLength = index === 10 ? Number(u64(data, 36) ?? 0n) : 0;
            const owner = keyAt(data, index === 1 ? 4 : 44 + seedLength);
            if (keys[0] === vault) {
                return {
                    kind: 'gives-control',
                    danger: true,
                    text: `Hands your wallet's account to program ${owner ? showAddress(owner) : 'unknown'}`,
                    details: [`Program ${owner ?? 'unknown'}`, 'After this, that program, not your passkey, decides what leaves your wallet.'],
                };
            }
            break;
        }
        case 8:
        case 9: {
            // Allocate / AllocateWithSeed: gives the account data.
            if (keys[0] === vault) {
                return {
                    kind: 'gives-control',
                    danger: true,
                    text: "Changes your wallet's account (allocates data)",
                    details: ['A wallet account with data is no longer a plain account your passkey controls.'],
                };
            }
            break;
        }
    }
    return unrecognized(ix, `System Program instruction ${index ?? '?'}`);
}

function describeToken(
    ix: TransactionInstruction,
    data: Uint8Array,
    keys: string[],
    vault: string,
    infos: Map<string, AccountInfo<Buffer> | null>,
): TxReviewRow {
    const kind = data[0];
    switch (kind) {
        case 3:
        case 12: {
            // Transfer: source, destination, owner. TransferChecked: source, mint, destination, owner.
            const amount = u64(data, 1);
            const source = keys[0];
            const destination = kind === 3 ? keys[1] : keys[2];
            if (amount === null || !source || !destination) break;
            const sourceAccount = tokenAccountOf(infos.get(source));
            const mint = kind === 12 ? keys[1] : (sourceAccount?.mint ?? null);
            const decimals = kind === 12 ? (data.length >= 10 ? data[9] : null) : mint ? mintDecimals(infos.get(mint)) : null;
            const recipient = infos.get(destination);
            const recipientAccount = tokenAccountOf(recipient);
            let warning: string | undefined;
            if (!recipient) warning = "The recipient's token account does not exist yet.";
            else if (!recipientAccount) warning = 'The recipient is not a token account.';
            else if (mint && recipientAccount.mint !== mint) warning = "The recipient's token account is for another token.";
            const to = recipientAccount?.owner ?? destination;
            const shown = decimals === null ? `${amount.toString()} base units of ${tokenName(mint)}` : `${formatUnits(amount, decimals)} ${tokenName(mint)}`;
            return {
                kind: 'token-transfer',
                text: `Send ${shown} to ${showAddress(to)}`,
                details: [
                    `To ${to}${recipientAccount ? ' (owner of the receiving token account)' : ''}`,
                    `Receiving token account ${destination}`,
                    ...(mint ? [`Mint ${mint}`] : []),
                    `From token account ${source}`,
                ],
                ...(warning ? { warning } : {}),
            };
        }
        case 4:
        case 13: {
            // Approve: source, delegate, owner. ApproveChecked: source, mint, delegate, owner.
            const amount = u64(data, 1);
            const delegate = kind === 4 ? keys[1] : keys[2];
            const owner = kind === 4 ? keys[2] : keys[3];
            return {
                kind: 'gives-control',
                danger: true,
                text: `Lets ${delegate ? showAddress(delegate) : 'someone'} spend ${amount === null ? 'tokens' : `up to ${amount.toString()} base units`} from token account ${showAddress(keys[0] ?? '')}`,
                details: [`Delegate ${delegate ?? 'unknown'}`, `Token account ${keys[0] ?? 'unknown'}`, ...(owner ? [`Owner ${owner}${owner === vault ? ' (your wallet)' : ''}`] : [])],
            };
        }
        case 6: {
            // SetAuthority: account, current authority; type at 1, option at 2, new key at 3.
            const types = ['minting', 'freezing', 'ownership', 'closing'];
            const what = types[data[1]] ?? 'an authority';
            const next = data[2] === 1 ? keyAt(data, 3) : null;
            return {
                kind: 'gives-control',
                danger: keys[1] === vault,
                text: `Gives ${next ? showAddress(next) : 'no one'} ${what} rights over ${showAddress(keys[0] ?? '')}`,
                details: [`Account ${keys[0] ?? 'unknown'}`, `New authority ${next ?? 'none'}`, `Current authority ${keys[1] ?? 'unknown'}`],
            };
        }
        case 9: {
            // CloseAccount: account, destination, owner.
            const toOther = keys[2] === vault && keys[1] !== vault;
            return {
                kind: toOther ? 'gives-control' : 'unrecognized',
                danger: toOther,
                text: toOther
                    ? `Closes token account ${showAddress(keys[0] ?? '')} and sends what it holds to ${showAddress(keys[1] ?? '')}`
                    : `Closes token account ${showAddress(keys[0] ?? '')}`,
                details: [`Token account ${keys[0] ?? 'unknown'}`, `Rent goes to ${keys[1] ?? 'unknown'}`],
            };
        }
    }
    return unrecognized(ix, `Token instruction ${kind ?? '?'}`);
}

/**
 * The full review: lines, then a simulation of the instructions on the
 * app's connection, as the vault would run them (the relayer pays, the vault
 * signs; signatures are not checked), with the vault's balance before and
 * after.
 */
export async function buildReview(params: {
    connection: Connection;
    appName: string;
    feePayer: PublicKey;
    vault: PublicKey;
    instructions: TransactionInstruction[];
    addressLookupTables?: AddressLookupTableAccount[];
}): Promise<TxReview> {
    const { connection, vault } = params;
    const { rows, vaultInfo } = await describeInstructions(connection, vault, params.instructions);
    let simulation: TxReview['simulation'];
    let tx: VersionedTransaction | null = null;
    try {
        const message = new TransactionMessage({
            payerKey: params.feePayer,
            // Replaced by the node (`replaceRecentBlockhash`).
            recentBlockhash: PublicKey.default.toBase58(),
            instructions: params.instructions,
        }).compileToV0Message(params.addressLookupTables ?? []);
        tx = new VersionedTransaction(message);
        tx.serialize();
    } catch {
        tx = null;
    }
    if (!tx) {
        simulation = { status: 'skipped', reason: 'the transaction is too large to preview' };
    } else {
        try {
            const result = await connection.simulateTransaction(tx, {
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: 'confirmed',
                accounts: { encoding: 'base64', addresses: [vault.toBase58()] },
            });
            if (result.value.err) {
                simulation = { status: 'failed', reason: simulationFailure(result.value.err, result.value.logs) };
            } else {
                const before = BigInt(vaultInfo?.lamports ?? 0);
                const afterLamports = result.value.accounts?.[0]?.lamports;
                const change = afterLamports === undefined || afterLamports === null ? 0n : BigInt(afterLamports) - before;
                simulation = {
                    status: 'ok',
                    ...(change !== 0n ? { balanceChange: `${change > 0n ? '+' : '−'}${sol(change > 0n ? change : -change)}` } : {}),
                };
            }
        } catch (error) {
            simulation = { status: 'skipped', reason: `the network could not simulate it (${(error as Error)?.message ?? error})` };
        }
    }
    return {
        appName: params.appName,
        rows,
        simulation,
        feeLine: `Network fee: paid by ${params.appName}`,
    };
}

/** Why a simulation failed: the first failing program's log line, else the error itself. */
function simulationFailure(err: unknown, logs: string[] | null | undefined): string {
    const line = logs?.find((l) => / failed: /.test(l));
    if (line) return line.replace(/^Program \w+ failed: /, '');
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
