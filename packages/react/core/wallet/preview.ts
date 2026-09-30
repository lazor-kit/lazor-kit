/**
 * The transaction the portal shows (and simulates) while the user approves a
 * passkey signature: the caller's instructions, paid by the fee payer, as a
 * v0 transaction with empty signatures, base64. The portal reads that as it
 * always has.
 *
 * It is compiled without lookup tables whenever that fits in a packet (1232
 * bytes), as it always was: the portal reads the accounts from the message
 * itself, so it shows the recipient of a transfer and watches the balances
 * the transaction changes. It cannot resolve lookup-table entries, so a
 * transaction compiled with them would hide those accounts from the review.
 *
 * Only a payload that does not fit that way (a Jupiter route, say, several
 * hundred bytes over) is compiled with the caller's address lookup tables, as
 * the transaction that is sent will be. web3.js `serialize()` throws
 * "encoding overruns Uint8Array" on a message over the limit, which failed
 * the whole flow before the passkey prompt. A preview that is still over the
 * limit is serialized without that cap: it is only ever read back (the portal
 * parses it fine; its own simulation of it may fail, and it says so), never
 * sent.
 */
import { Buffer } from 'buffer';
import {
    AddressLookupTableAccount,
    MessageV0,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';

export function buildPreviewTransactionBase64(params: {
    feePayer: PublicKey;
    recentBlockhash: string;
    instructions: TransactionInstruction[];
    addressLookupTables?: AddressLookupTableAccount[];
}): string {
    const compile = (tables: AddressLookupTableAccount[]) =>
        new TransactionMessage({
            payerKey: params.feePayer,
            recentBlockhash: params.recentBlockhash,
            instructions: params.instructions,
        }).compileToV0Message(tables);
    const tables = params.addressLookupTables ?? [];
    let message = compile([]);
    let bytes = serializeWithinPacket(message);
    if (!bytes && tables.length > 0) {
        message = compile(tables);
        bytes = serializeWithinPacket(message);
    }
    return Buffer.from(bytes ?? serializeV0TransactionUnbounded(message)).toString('base64');
}

/** web3.js's serialization, or undefined when the message is over the packet limit. */
function serializeWithinPacket(message: MessageV0): Uint8Array | undefined {
    try {
        return new VersionedTransaction(message).serialize();
    } catch (error) {
        if (!(error instanceof RangeError) && !/overruns/i.test(String((error as Error)?.message))) throw error;
        return undefined;
    }
}

function pushLength(out: number[], length: number): void {
    // Solana's compact-u16 ("shortvec").
    let rest = length;
    for (;;) {
        const low = rest & 0x7f;
        rest >>= 7;
        if (rest === 0) {
            out.push(low);
            return;
        }
        out.push(low | 0x80);
    }
}

function pushBytes(out: number[], bytes: Uint8Array | number[]): void {
    for (const b of bytes) out.push(b);
}

/**
 * The wire format of a v0 transaction with all-zero signatures, as web3.js
 * writes it, but with no 1232-byte buffer behind it.
 */
export function serializeV0TransactionUnbounded(message: MessageV0): Uint8Array {
    const out: number[] = [];
    const signatures = message.header.numRequiredSignatures;
    pushLength(out, signatures);
    for (let i = 0; i < signatures * 64; i++) out.push(0);
    out.push(0x80); // version 0
    out.push(
        message.header.numRequiredSignatures,
        message.header.numReadonlySignedAccounts,
        message.header.numReadonlyUnsignedAccounts,
    );
    pushLength(out, message.staticAccountKeys.length);
    for (const key of message.staticAccountKeys) pushBytes(out, key.toBytes());
    pushBytes(out, new PublicKey(message.recentBlockhash).toBytes());
    pushLength(out, message.compiledInstructions.length);
    for (const ix of message.compiledInstructions) {
        out.push(ix.programIdIndex);
        pushLength(out, ix.accountKeyIndexes.length);
        pushBytes(out, ix.accountKeyIndexes);
        pushLength(out, ix.data.length);
        pushBytes(out, ix.data);
    }
    pushLength(out, message.addressTableLookups.length);
    for (const lookup of message.addressTableLookups) {
        pushBytes(out, lookup.accountKey.toBytes());
        pushLength(out, lookup.writableIndexes.length);
        pushBytes(out, lookup.writableIndexes);
        pushLength(out, lookup.readonlyIndexes.length);
        pushBytes(out, lookup.readonlyIndexes);
    }
    return Uint8Array.from(out);
}
