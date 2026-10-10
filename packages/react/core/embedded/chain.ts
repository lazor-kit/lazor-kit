/**
 * What Embedded mode reads from the chain without a `getProgramAccounts`
 * scan:
 *
 * - `userHandleWallet`: a passkey this SDK created has the wallet's seed as
 *   its `user.id`, so its wallet is at `findWallet(userHandle)` and its
 *   authority at `findAuthority(wallet, sha256(rawId))`. One read of both.
 * - `createdByThisPasskey` (R32): whether a wallet this passkey never signed
 *   for was created by this passkey alone, in one transaction whose only
 *   LazorKit instruction (besides `RegisterPayer`) is that `CreateWallet`.
 *   Such a wallet cannot hold anything else: every change to it needs the
 *   passkey's signature, and its counter says there was none.
 * - `verifyCreatedWallet`: after a creation, that the wallet on chain is this
 *   passkey's: one Owner, this passkey's key, credential and relying party.
 * - `passkeyAuthorityOf`: the connected wallet's passkey authority for a send,
 *   derived and read, not looked up by a scan.
 *
 * A read that fails throws `NetworkError`: nothing is concluded from it.
 */
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { type AccountInfo, type Connection, PublicKey } from '@solana/web3.js';
import {
    DISC_CREATE_WALLET,
    DISC_REGISTER_PAYER,
    type LazorKitClient,
    type OwnershipProof,
    type PasskeyWalletCandidate,
    type WalletFacts,
    verifyOwnershipProof,
} from '../program';
import { NetworkError, WalletVerificationError } from '../errors';
import { bytesEqual, sha256Bytes } from './webauthn';

const WALLET_DISCRIMINATOR = 0x21;
const AUTHORITY_DISCRIMINATOR = 0x22;
const SECP256R1 = 1;
const ROLE_OWNER = 0;
/** getSignaturesForAddress's page: a wallet with this many has a history too long to tell. */
const HISTORY_LIMIT = 1000;

/** A Secp256r1 authority account, as v2 lays it out. */
export interface PasskeyAuthorityAccount {
    role: number;
    counter: number;
    wallet: PublicKey;
    credentialIdHash: Uint8Array;
    /** 33-byte compressed P-256 key. */
    publicKey: Uint8Array;
    rpIdHash: Uint8Array;
}

/**
 * A v2 Secp256r1 authority of `programId`: discriminator 0x22, type at 1, role
 * at 2, counter at 8, wallet at 16, credential hash at 48, key at 80, rpId
 * hash at 113. `null` for anything else.
 */
export function readPasskeyAuthority(info: AccountInfo<Buffer> | null | undefined, programId: PublicKey): PasskeyAuthorityAccount | null {
    if (!info || !info.owner.equals(programId)) return null;
    const data = Buffer.from(info.data);
    if (data.length < 145 || data[0] !== AUTHORITY_DISCRIMINATOR || data[1] !== SECP256R1) return null;
    return {
        role: data[2],
        counter: data.readUInt32LE(8),
        wallet: new PublicKey(data.subarray(16, 48)),
        credentialIdHash: new Uint8Array(data.subarray(48, 80)),
        publicKey: new Uint8Array(data.subarray(80, 113)),
        rpIdHash: new Uint8Array(data.subarray(113, 145)),
    };
}

/** How many Owners a v2 wallet account has (`owner_count`, u32 at 4), or `null` when it is not one. */
export function walletOwnerCount(info: AccountInfo<Buffer> | null | undefined, programId: PublicKey): number | null {
    if (!info || !info.owner.equals(programId)) return null;
    const data = Buffer.from(info.data);
    if (data.length < 8 || data[0] !== WALLET_DISCRIMINATOR) return null;
    return data.readUInt32LE(4);
}

/** A read that failed: a network error, never "not there". */
export async function chainRead<T>(what: string, read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (error) {
        throw new NetworkError(`Couldn't read ${what} from the network: ${(error as Error)?.message ?? error}`, error);
    }
}

/** Whether `authority` is this passkey's Owner seat on `wallet`, created under `rpId`. */
function isOwnSeat(
    authority: PasskeyAuthorityAccount | null,
    wallet: PublicKey,
    credentialIdHash: Uint8Array,
    rpId: string,
): authority is PasskeyAuthorityAccount {
    return (
        !!authority &&
        authority.role === ROLE_OWNER &&
        authority.wallet.equals(wallet) &&
        bytesEqual(authority.credentialIdHash, credentialIdHash) &&
        bytesEqual(authority.rpIdHash, sha256Bytes(new Uint8Array(Buffer.from(rpId, 'utf8'))))
    );
}

export type UserHandleWallet =
    /** This passkey's own wallet, to use without asking. */
    | { kind: 'adopt'; candidate: PasskeyWalletCandidate }
    /** This passkey's wallet, but the user has to confirm it (described). */
    | { kind: 'choose'; facts: WalletFacts }
    /** No wallet at the seed yet: create it there. */
    | { kind: 'absent' }
    /** The seed's wallet is not this passkey's (or nothing provable): create at another seed. */
    | { kind: 'taken' };

/**
 * The wallet a 32-byte `userHandle` names, for the passkey that made `proof`.
 * Adopted without asking when this passkey has signed for it and nothing
 * untrusted can spend from it (described, with `describe`), or when it never
 * signed for it but created it alone (`createdByThisPasskey`, no description
 * needed). Any other wallet there goes to the user.
 */
export async function userHandleWallet(params: {
    connection: Connection;
    client: LazorKitClient;
    userHandle: Uint8Array;
    credentialIdHash: Uint8Array;
    proof: OwnershipProof;
    rpId: string;
    describe: (candidates: PasskeyWalletCandidate[]) => Promise<WalletFacts[]>;
}): Promise<UserHandleWallet> {
    const { connection, client, credentialIdHash, rpId } = params;
    const [walletPda] = client.findWallet(params.userHandle);
    const [vaultPda] = client.findVault(walletPda);
    const [authorityPda] = client.findAuthority(walletPda, credentialIdHash);
    const [walletInfo, authorityInfo] = await chainRead('the wallet', () =>
        connection.getMultipleAccountsInfo([walletPda, authorityPda], 'confirmed'),
    );
    if (!walletInfo) return { kind: 'absent' };
    const authority = readPasskeyAuthority(authorityInfo, client.programId);
    if (!isOwnSeat(authority, walletPda, credentialIdHash, rpId)) return { kind: 'taken' };
    const candidate: PasskeyWalletCandidate = {
        version: 2,
        programId: client.programId,
        walletPda,
        vaultPda,
        authorityPda,
        publicKey: authority.publicKey,
    };
    if (!verifyOwnershipProof([candidate], params.proof, rpId).length) return { kind: 'taken' };

    if (
        authority.counter === 0 &&
        walletOwnerCount(walletInfo, client.programId) === 1 &&
        (await createdByThisPasskey(connection, client.programId, walletPda, authorityPda))
    ) {
        return { kind: 'adopt', candidate };
    }
    const [facts] = await chainRead('who controls the wallet', () => params.describe([candidate]));
    if (!facts) return { kind: 'taken' };
    if (facts.controlledAlone && facts.signatureCount > 0) return { kind: 'adopt', candidate };
    return { kind: 'choose', facts };
}

type AnyInstruction = { programId: PublicKey; accounts: PublicKey[]; data: Uint8Array };

/**
 * R32: whether `wallet`'s first successful transaction is exactly one
 * LazorKit `CreateWallet` (a `RegisterPayer` beside it allowed), for this
 * wallet with this passkey's authority as its owner seat, and no other
 * LazorKit instruction, top level or inner. False whenever that cannot be
 * told (no history, a history of 1000 or more, an unreadable transaction):
 * the user is asked instead, and nothing is created.
 *
 * Why the creating instruction must be alone: a plant can create the wallet
 * under its own key, move a token account off the vault, add this passkey as
 * Owner and remove itself, all in one transaction. The passkey's seat, its
 * key and "controlled alone" all check out, and even the wallet's and the
 * seat's first transaction are the same one. Only the extra instructions give
 * it away.
 */
export async function createdByThisPasskey(
    connection: Connection,
    programId: PublicKey,
    wallet: PublicKey,
    authority: PublicKey,
): Promise<boolean> {
    try {
        const signatures = await connection.getSignaturesForAddress(wallet, { limit: HISTORY_LIMIT }, 'confirmed');
        if (signatures.length === 0 || signatures.length >= HISTORY_LIMIT) return false;
        // Newest first: the oldest that succeeded created the wallet.
        const first = [...signatures].reverse().find((s) => !s.err);
        if (!first) return false;
        const tx = await connection.getTransaction(first.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!tx?.meta || tx.meta.err) return false;
        const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined });
        const at = (index: number) => {
            const key = keys.get(index);
            if (!key) throw new Error('account index out of range');
            return key;
        };
        const instructions: AnyInstruction[] = [];
        for (const ix of tx.transaction.message.compiledInstructions) {
            instructions.push({ programId: at(ix.programIdIndex), accounts: ix.accountKeyIndexes.map(at), data: ix.data });
        }
        for (const inner of tx.meta.innerInstructions ?? []) {
            for (const ix of inner.instructions) {
                instructions.push({
                    programId: at(ix.programIdIndex),
                    accounts: ix.accounts.map(at),
                    data: new Uint8Array(bs58.decode(ix.data)),
                });
            }
        }
        const lazorkit = instructions.filter((ix) => ix.programId.equals(programId));
        const creates = lazorkit.filter((ix) => ix.data[0] === DISC_CREATE_WALLET);
        const others = lazorkit.filter((ix) => ix.data[0] !== DISC_CREATE_WALLET && ix.data[0] !== DISC_REGISTER_PAYER);
        if (creates.length !== 1 || others.length !== 0) return false;
        const [create] = creates;
        // Accounts: payer, wallet, vault, authority, ... Data: discriminator,
        // seed (32), auth type (1).
        return (
            create.accounts.length >= 4 &&
            create.accounts[1].equals(wallet) &&
            create.accounts[3].equals(authority) &&
            create.data.length > 33 &&
            create.data[33] === SECP256R1
        );
    } catch {
        return false;
    }
}

/**
 * After a creation landed: the wallet is this passkey's alone. Its account is
 * a v2 wallet with exactly one Owner, and the authority this passkey's seat
 * derives to is that Owner, holding this passkey's key, credential hash and
 * rpId hash. Throws `WalletVerificationError` otherwise (nothing is saved),
 * `NetworkError` when it cannot be read.
 */
export async function verifyCreatedWallet(params: {
    connection: Connection;
    programId: PublicKey;
    wallet: PublicKey;
    authority: PublicKey;
    credentialIdHash: Uint8Array;
    publicKey: Uint8Array;
    rpId: string;
    /** The slot the creation landed in: read from a node at or past it. */
    minContextSlot?: number;
}): Promise<void> {
    const { connection, programId, wallet } = params;
    const [walletInfo, authorityInfo] = await chainRead('the new wallet', () =>
        connection.getMultipleAccountsInfo([wallet, params.authority], {
            commitment: 'confirmed',
            ...(params.minContextSlot !== undefined ? { minContextSlot: params.minContextSlot } : {}),
        }),
    );
    const owners = walletOwnerCount(walletInfo, programId);
    const authority = readPasskeyAuthority(authorityInfo, programId);
    const problem =
        owners === null
            ? 'there is no wallet account'
            : owners !== 1
              ? `it has ${owners} Owners`
              : !isOwnSeat(authority, wallet, params.credentialIdHash, params.rpId)
                ? "this passkey's Owner seat is not on it"
                : !bytesEqual(authority.publicKey, params.publicKey)
                  ? "its Owner holds another key than this passkey's"
                  : null;
    if (problem) {
        throw new WalletVerificationError(
            `The wallet the relayer created (${wallet.toBase58()}) is not this passkey's: ${problem}. Nothing was saved.`,
            wallet.toBase58(),
        );
    }
}

/**
 * The passkey seat a send signs with, for a stored wallet: derived from the
 * wallet and the credential, and read in one `getAccountInfo` (no scan). Its
 * key comes from the chain, never from storage. `null` when the seat is not
 * there (removed, or the wallet migrated).
 */
export async function passkeySeatOf(params: {
    connection: Connection;
    client: LazorKitClient;
    wallet: PublicKey;
    credentialIdHash: Uint8Array;
}): Promise<{ authorityPda: PublicKey; publicKey: Uint8Array | null } | null> {
    const { client, wallet } = params;
    const [authorityPda] = client.findAuthority(wallet, params.credentialIdHash);
    const info = await params.connection.getAccountInfo(authorityPda, 'confirmed');
    if (!info || !info.owner.equals(client.programId)) return null;
    const data = Buffer.from(info.data);
    // Wallet at 16 and type at 1, the same in v1 and v2.
    if (data.length < 48 || data[1] !== SECP256R1 || !new PublicKey(data.subarray(16, 48)).equals(wallet)) return null;
    const v2 = readPasskeyAuthority(info, client.programId);
    return { authorityPda, publicKey: v2 ? v2.publicKey : null };
}
