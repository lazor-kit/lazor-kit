/**
 * Which wallet a key the SDK keeps signs for, and the refusal when another
 * wallet, or none, is connected.
 *
 * Every session or authority key the SDK keeps (see ../keys) is bound to the
 * wallet it was registered for: its record holds that wallet's PDA, the
 * session or authority PDA, and a session's expiry. `signAndSendWithSession`,
 * `signAndSendWithAuthority` and `revokeSession()` use the key only while
 * that same wallet is connected. Otherwise they throw `KeyWalletMismatchError`
 * before anything is signed or sent, and the key itself checks again when it
 * signs, so a disconnect or a switch while a send is being built still stops
 * it.
 *
 * An entry moved from an earlier release (the plaintext in localStorage)
 * names its wallet, but nothing checked it. On its first use it is bound to
 * that wallet if the program derives the entry's PDA from that wallet and the
 * key, or else to the wallet the PDA's account on chain names, if that account
 * is LazorKit's and names this key. An entry that is neither stays unbound: it
 * is never used, and the send is refused with reason `'unbound'`.
 *
 * A stored session key whose session has expired is deleted when it is read.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { type KeySigner, type KeySlot, type KeyStorage, type StoredKey, forgetKey, loadKey, updateKeyInfo } from '../keys';
import { clientFor, v1Client, v2Client } from '../program';
import { chainHasError } from '../program/errorShape';
import type { WalletState } from '../types';

/**
 * Why a kept key was not used:
 * - `'no-wallet'`: no wallet is connected;
 * - `'other-wallet'`: a different wallet is connected;
 * - `'unbound'`: a key an earlier release kept, whose wallet could not be
 *   confirmed (see the module header).
 */
export type KeyWalletMismatchReason = 'no-wallet' | 'other-wallet' | 'unbound';

/**
 * A session or authority key the SDK keeps was not used, because the wallet
 * it signs for is not the connected one (`reason`). Nothing was signed or
 * sent. Connect `keyWallet` to use the key, or create a session (add an
 * authority) for the connected wallet. An `'unbound'` key is never used: call
 * `forgetStoredKeys()` and create it again.
 */
export class KeyWalletMismatchError extends Error {
    /** Matched with `name` by `isKeyWalletMismatchError`, across copies of the package. */
    readonly code = 'KEY_WALLET_MISMATCH';
    constructor(
        /** Which kept key: the session key or the authority key. */
        readonly slot: KeySlot,
        readonly reason: KeyWalletMismatchReason,
        /** The wallet PDA the key signs for; `undefined` when it is unbound. */
        readonly keyWallet: string | undefined,
        /** The connected wallet's PDA; `undefined` when none is connected. */
        readonly connectedWallet: string | undefined,
    ) {
        super(mismatchMessage(slot, reason, keyWallet, connectedWallet));
        this.name = 'KeyWalletMismatchError';
    }
}

function mismatchMessage(
    slot: KeySlot,
    reason: KeyWalletMismatchReason,
    keyWallet: string | undefined,
    connectedWallet: string | undefined,
): string {
    const create = slot === 'session' ? 'create a session' : 'add an authority';
    if (reason === 'unbound') {
        return (
            `The stored ${slot} key was kept by an earlier release, and the wallet it belongs to could not be ` +
            `confirmed: its ${slot} PDA does not derive from the wallet it names, and no LazorKit account on chain ` +
            `names the key. It is not used. Call forgetStoredKeys(), then ${create} again. Nothing was signed or sent.`
        );
    }
    const which =
        reason === 'no-wallet' ? 'no wallet is connected' : `the connected wallet is ${connectedWallet}`;
    return (
        `The stored ${slot} key signs only for wallet ${keyWallet}, and ${which}. Connect that wallet to use it, ` +
        `or ${create} for the connected one. Nothing was signed or sent.`
    );
}

/**
 * True for a `KeyWalletMismatchError`, also one from another copy of this
 * package (by `name` and `code`), and one wrapped in `cause` or in a
 * wallet-adapter `WalletError`'s `error`.
 */
export function isKeyWalletMismatchError(error: unknown): boolean {
    return chainHasError(error, KeyWalletMismatchError, 'KeyWalletMismatchError', 'KEY_WALLET_MISMATCH');
}

/**
 * The key the SDK keeps in `slot`, for the wallet connected now: null when
 * there is none. Throws when the stored session has expired (and deletes its
 * key), and `KeyWalletMismatchError` when the key is not the connected
 * wallet's. The signer it returns checks again when it signs.
 */
export async function keyForConnectedWallet<S extends KeySlot>(params: {
    get: () => WalletState;
    slot: S;
    storage: KeyStorage;
    connection: Connection;
}): Promise<StoredKey<S> | null> {
    const { get, slot, storage, connection } = params;
    const stored = await loadKey(storage, slot);
    if (!stored) return null;
    let info = stored.info;
    const publicKey = stored.signer.publicKey;

    if (slot === 'session') await pruneIfExpired(storage, connection, stored as StoredKey<'session'>);

    let walletPda: string | null = info.bound ? info.walletPda : null;
    if (!walletPda) {
        walletPda = await walletOfKey(connection, slot, publicKey, info);
        if (!walletPda) throw new KeyWalletMismatchError(slot, 'unbound', undefined, get().wallet?.smartWallet);
        info = { ...info, walletPda, bound: true };
        await updateKeyInfo(storage, slot, publicKey, info);
    }

    const bound = walletPda;
    const check = () => {
        const connected = get().wallet?.smartWallet;
        if (connected !== bound) {
            throw new KeyWalletMismatchError(slot, connected ? 'other-wallet' : 'no-wallet', bound, connected);
        }
    };
    check();
    return { signer: checkedSigner(stored.signer, check), info };
}

/** Signs only while `check` passes. */
function checkedSigner(signer: KeySigner, check: () => void): KeySigner {
    return {
        publicKey: signer.publicKey,
        async signTransaction(tx) {
            check();
            await signer.signTransaction(tx);
        },
    };
}

/**
 * Deletes the stored session key once the chain is past its session's expiry
 * (the program refuses a session once the slot is past `expires_at`), and
 * throws. Read at the connection's commitment, which trails the tip: a key is
 * never deleted while its session can still sign.
 */
async function pruneIfExpired(storage: KeyStorage, connection: Connection, stored: StoredKey<'session'>): Promise<void> {
    const { expiresAt, sessionPda } = stored.info;
    if (expiresAt === undefined || !/^\d+$/.test(expiresAt)) return;
    const current = await connection.getSlot();
    if (BigInt(current) <= BigInt(expiresAt)) return;
    await forgetKey(storage, 'session', (info) => info.sessionPda === sessionPda);
    throw new Error(
        `No session key found: the stored session ${sessionPda} expired after slot ${expiresAt} ` +
            `(the chain is at slot ${current}), so its key was deleted. Create a session first.`,
    );
}

/**
 * The wallet PDA a kept key belongs to, or null when that cannot be
 * confirmed: the wallet the entry names if its PDA derives from that wallet
 * and the key (v2 or v1, on this connection's cluster), else the wallet the
 * PDA's account names, if a LazorKit program owns it and it names this key.
 */
export async function walletOfKey(
    connection: Connection,
    slot: KeySlot,
    publicKey: PublicKey,
    info: { readonly walletPda: string; readonly sessionPda?: string; readonly authorityPda?: string },
): Promise<string | null> {
    const pda = new PublicKey(slot === 'session' ? info.sessionPda! : info.authorityPda!);
    if (derives(connection, slot, new PublicKey(info.walletPda), publicKey, pda)) return info.walletPda;

    const account = await connection.getAccountInfo(pda);
    if (!account) return null;
    const owners = [v2Client(connection).programId, v1Client(connection).programId];
    if (!owners.some((owner) => owner.equals(account.owner))) return null;
    // Session: wallet at 8, session key at 40 (80-byte header). Authority:
    // type at 1 (0 = Ed25519), wallet at 16, the Ed25519 key at 48. The same
    // in v1 and v2.
    const data = account.data;
    if (data.length < 80) return null;
    let wallet: PublicKey;
    if (slot === 'session') {
        if (!new PublicKey(data.subarray(40, 72)).equals(publicKey)) return null;
        wallet = new PublicKey(data.subarray(8, 40));
    } else {
        if (data[1] !== 0 || !new PublicKey(data.subarray(48, 80)).equals(publicKey)) return null;
        wallet = new PublicKey(data.subarray(16, 48));
    }
    return derives(connection, slot, wallet, publicKey, pda) ? wallet.toBase58() : null;
}

/** `pda` is the session or authority PDA the program derives for `wallet` and `key`, under v2 or v1. */
function derives(connection: Connection, slot: KeySlot, wallet: PublicKey, key: PublicKey, pda: PublicKey): boolean {
    return ([2, 1] as const).some((version) => {
        const client = clientFor(version, connection);
        const [derived] =
            slot === 'session' ? client.findSession(wallet, key.toBytes()) : client.findAuthority(wallet, key.toBytes());
        return derived.equals(pda);
    });
}
