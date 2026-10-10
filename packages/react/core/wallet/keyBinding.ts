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
 * signs, and again right before each attempt to send what it signed, so a
 * disconnect or a switch while a send is being built still stops it.
 *
 * A send that loaded its key before a disconnect never signs or sends after
 * it, whichever way the disconnect came (the store's `disconnect`,
 * `LazorkitWalletAdapter.disconnect`, the Wallet Standard
 * `standard:disconnect`; see ./disconnects), and even if the same wallet is
 * connected again by then (`'disconnected'`): with `keepSessionKeys` the key
 * is kept, but the send started before the sign-out is not finished.
 *
 * An entry moved from an earlier release (the plaintext in localStorage)
 * names its wallet, but nothing checked it. On its first use it is bound to
 * that wallet if the program derives the entry's PDA from that wallet and the
 * key, or else to the wallet the PDA's account on chain names, if that account
 * is LazorKit's and names this key. An entry that is neither stays unbound: it
 * is never used, and the send is refused with reason `'unbound'`.
 *
 * A bound record is not taken on trust either: on every use its session or
 * authority PDA must derive from the wallet it names and the key (offline, a
 * few PDA derivations). One that does not (a record altered in IndexedDB, or
 * made on another cluster) is checked as an earlier release's entry is.
 *
 * A stored session key whose session has expired is deleted when it is read.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { type KeySigner, type KeySlot, type KeyStorage, type StoredKey, forgetKey, loadKey, updateKeyInfo } from '../keys';
import { clientFor, v1Client, v2Client } from '../program';
import { chainHasError } from '../program/errorShape';
import type { WalletState } from '../types';
import { disconnectMark } from './disconnects';
import { expiryIsSlot } from './sessionExpiry';

/**
 * Why a kept key was not used:
 * - `'no-wallet'`: no wallet is connected;
 * - `'other-wallet'`: a different wallet is connected;
 * - `'unbound'`: a key whose wallet could not be confirmed: an earlier
 *   release's entry, or a record whose PDA does not derive from the wallet it
 *   names (see the module header);
 * - `'disconnected'`: the key's wallet is connected, but a disconnect ran
 *   after this send loaded the key: a send started before a sign-out is not
 *   finished after it. Send again.
 */
export type KeyWalletMismatchReason = 'no-wallet' | 'other-wallet' | 'unbound' | 'disconnected';

/**
 * A session or authority key the SDK keeps was not used, because the wallet
 * it signs for is not the connected one, or was disconnected during the send
 * (`reason`). Nothing was sent. Connect `keyWallet` to use the key, or create
 * a session (add an authority) for the connected wallet. An `'unbound'` key
 * is never used: create the session (add the authority) again, which
 * replaces it.
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
        /**
         * `'send'`: refused after the key had signed, right before the
         * transaction would have been sent (it was not). Default `'sign'`:
         * nothing was signed.
         */
        stage: 'sign' | 'send' = 'sign',
    ) {
        super(mismatchMessage(slot, reason, keyWallet, connectedWallet, stage));
        this.name = 'KeyWalletMismatchError';
    }
}

function mismatchMessage(
    slot: KeySlot,
    reason: KeyWalletMismatchReason,
    keyWallet: string | undefined,
    connectedWallet: string | undefined,
    stage: 'sign' | 'send',
): string {
    const create = slot === 'session' ? 'create a session' : 'add an authority';
    const outcome =
        stage === 'send' ? 'The transaction it had signed was not sent.' : 'Nothing was signed or sent.';
    if (reason === 'unbound') {
        return (
            `The wallet the stored ${slot} key belongs to could not be confirmed: its ${slot} PDA does not ` +
            `derive from the wallet its record names (on this cluster), and no LazorKit account on chain names ` +
            `the key. It is not used: ${create} again, which replaces it (forgetStoredKeys() deletes it too, ` +
            `with the other kept key). ${outcome}`
        );
    }
    if (reason === 'disconnected') {
        return (
            `The wallet was disconnected while this send was in progress, so the stored ${slot} key did not ` +
            `finish it, although its wallet ${keyWallet} is connected again. Send it again. ${outcome}`
        );
    }
    const which =
        reason === 'no-wallet' ? 'no wallet is connected' : `the connected wallet is ${connectedWallet}`;
    return (
        `The stored ${slot} key signs only for wallet ${keyWallet}, and ${which}. Connect that wallet to use it, ` +
        `or ${create} for the connected one. ${outcome}`
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

/** A kept key for the wallet connected when it was loaded (see `keyForConnectedWallet`). */
export interface ConnectedKey<S extends KeySlot> extends StoredKey<S> {
    /**
     * Throws `KeyWalletMismatchError` when what the key signed may no longer
     * be sent: its wallet is not connected any more, or a disconnect ran
     * since the key was loaded. Called right before each attempt to send.
     */
    readonly assertSendable: () => void;
}

/**
 * The key the SDK keeps in `slot`, for the wallet connected now: null when
 * there is none. Throws when the stored session has expired (and deletes its
 * key), and `KeyWalletMismatchError` when the key is not the connected
 * wallet's. The signer it returns checks again when it signs, and
 * `assertSendable` before each attempt to send: both also refuse once a
 * disconnect has run since this call started (see ./disconnects).
 */
export async function keyForConnectedWallet<S extends KeySlot>(params: {
    get: () => WalletState;
    slot: S;
    storage: KeyStorage;
    connection: Connection;
}): Promise<ConnectedKey<S> | null> {
    const { get, slot, storage, connection } = params;
    // Read first: a disconnect while the key loads counts too.
    const mark = disconnectMark();
    const stored = await loadKey(storage, slot);
    if (!stored) return null;
    let info = stored.info;
    const publicKey = stored.signer.publicKey;

    if (slot === 'session') await pruneIfExpired(storage, connection, stored as StoredKey<'session'>);

    // A bound record still has to derive from its wallet: one that does not is
    // checked as an unbound entry is.
    let walletPda: string | null =
        info.bound && derives(connection, slot, new PublicKey(info.walletPda), publicKey, pdaOf(slot, info))
            ? info.walletPda
            : null;
    if (!walletPda) {
        walletPda = await walletOfKey(connection, slot, publicKey, info);
        if (!walletPda) throw new KeyWalletMismatchError(slot, 'unbound', undefined, get().wallet?.smartWallet);
        info = { ...info, walletPda, bound: true };
        await updateKeyInfo(storage, slot, publicKey, info);
    }

    const bound = walletPda;
    const check = (stage: 'sign' | 'send') => {
        const connected = get().wallet?.smartWallet;
        if (connected !== bound) {
            throw new KeyWalletMismatchError(slot, connected ? 'other-wallet' : 'no-wallet', bound, connected, stage);
        }
        if (disconnectMark() !== mark) throw new KeyWalletMismatchError(slot, 'disconnected', bound, connected, stage);
    };
    check('sign');
    return { signer: checkedSigner(stored.signer, () => check('sign')), info, assertSendable: () => check('send') };
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
 * Deletes the stored session key once the chain is past its session's expiry,
 * and throws. A v2 session expires by the cluster clock (the Clock sysvar's
 * Unix time); a v1 session, and a record written before sessions were
 * measured in seconds, by slot (a value below 2020-01-01 is a slot). Read at
 * the connection's commitment, which trails the tip: a key is never deleted
 * while its session can still sign.
 */
async function pruneIfExpired(storage: KeyStorage, connection: Connection, stored: StoredKey<'session'>): Promise<void> {
    const { expiresAt, sessionPda } = stored.info;
    if (expiresAt === undefined || !/^\d+$/.test(expiresAt)) return;
    const expiry = BigInt(expiresAt);
    let passed: string | null;
    if (expiryIsSlot(expiry)) {
        const current = await connection.getSlot();
        passed = BigInt(current) > expiry ? `expired after slot ${expiresAt} (the chain is at slot ${current})` : null;
    } else {
        const { unixTimestamp } = await v2Client(connection).getClusterTime();
        passed =
            unixTimestamp > expiry
                ? `expired at ${new Date(Number(expiry) * 1000).toISOString()} (the cluster clock reads ` +
                  `${new Date(Number(unixTimestamp) * 1000).toISOString()})`
                : null;
    }
    if (passed === null) return;
    await forgetKey(storage, 'session', (info) => info.sessionPda === sessionPda);
    throw new Error(`No session key found: the stored session ${sessionPda} ${passed}, so its key was deleted. Create a session first.`);
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
    const pda = pdaOf(slot, info);
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

/** The session or authority PDA a kept key's record names. */
function pdaOf(slot: KeySlot, info: { readonly sessionPda?: string; readonly authorityPda?: string }): PublicKey {
    return new PublicKey(slot === 'session' ? info.sessionPda! : info.authorityPda!);
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
