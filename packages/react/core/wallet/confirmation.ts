/**
 * What an app (or the SDK's own chooser) sees when a passkey's wallet cannot
 * be adopted without the user.
 *
 * `connect` adopts a wallet on its own only when sdk-legacy's `pickOwnWallet`
 * says so: the one wallet this passkey has signed for, with nothing untrusted
 * able to spend from it. Anything else — the user's own wallet before its
 * first transaction, a wallet someone added the passkey to, two wallets the
 * passkey has signed for (one count may be a replayed copy) — goes to the
 * user, as `WalletChoice`s. On chain a key the user added and one an attacker
 * added look the same, so only the user can tell which wallet is theirs, and
 * only by recognising it.
 */
import { PublicKey } from '@solana/web3.js';
import type { WalletFacts } from '../program';
import { expiryIsSlot } from './sessionExpiry';

/** A wallet the passkey is proven to hold, offered for the user to recognise. */
export interface WalletChoice {
    /** The wallet PDA — an internal account. */
    wallet: string;
    /** The vault PDA — where the funds are, and the address users recognise. Show this one. */
    vault: string;
    /** 1 = a wallet made before LazorKit v2, not migrated yet; 2 = since. */
    version: 1 | 2;
    /** Vault balance, lamports. */
    lamports: number;
    /** Times this passkey has signed for the wallet; 0 = not used with this passkey yet. */
    signatureCount: number;
    /**
     * `false`: the vault was handed to another program, and the passkey no
     * longer controls what leaves it (or what is sent to it). Its balance is
     * not the user's to spend.
     */
    vaultIsSystemAccount: boolean;
    /** Every authority on the wallet besides this passkey. */
    otherAuthorities: {
        /** The authority account. */
        address: string;
        /** `passkey`: another passkey (secp256r1). `key`: an Ed25519 key, e.g. an app's backend. */
        type: 'passkey' | 'key';
        role: 'owner' | 'admin' | 'spender' | 'unknown';
        /** `key` only: the Ed25519 public key. */
        key?: string;
        /** `passkey` only: created under the same relying party (the same portal) as this passkey. */
        sameRelyingParty?: boolean;
        /** The key is one of the app's `trustedAuthorities`. A passkey never is. */
        trusted: boolean;
    }[];
    /** Session keys that can still sign. */
    liveSessions: {
        /** The session account. */
        address: string;
        /** `null` when the session account is too short to read. */
        sessionKey: string | null;
        /**
         * Approximate expiry, ms since the epoch: the session's own Unix time
         * (v2), read on the cluster clock, or its slot at 400 ms a slot (v1,
         * and a v2 session written before sessions were measured in
         * seconds); `null` when unreadable.
         */
        approxExpiresAt: number | null;
        /** The key is one of the app's `trustedAuthorities`. */
        trusted: boolean;
    }[];
    /**
     * Authorized transactions still waiting to be executed — possibly the
     * user's own half-finished two-step transaction. Never trusted: the
     * program does not tie one to the key that authorized it.
     */
    pendingDeferred: {
        /** The deferred-execution account. */
        address: string;
        /** Approximate expiry, ms since the epoch; `null` when unreadable. */
        approxExpiresAt: number | null;
    }[];
    /** Rights over the vault's token accounts held by someone else. */
    tokenGrants: {
        tokenAccount: string;
        tokenProgram: string;
        /** `null` when the account is too short to read. */
        mint: string | null;
        /**
         * `delegate`: someone may spend its tokens. `closeAuthority`: someone
         * other than the vault may close it. `owner`: the vault's own account
         * for a watched mint was handed to someone else, and what is sent to
         * it goes to them. `unreadable`: too short to read.
         */
        kind: 'delegate' | 'closeAuthority' | 'owner' | 'unreadable';
        /** Who holds the right; `null` when unreadable. */
        grantee: string | null;
        /** The grantee is one of the app's `trustedAuthorities`. */
        trusted: boolean;
    }[];
}

export interface ConfirmWalletRequest {
    /** The passkey's credential id (base64), as the portal reported it. */
    credentialId: string;
    /** In the order found. The order is not a recommendation: never pre-select one. */
    candidates: WalletChoice[];
}

/**
 * Asks the user which wallet is theirs. Resolve with the chosen wallet's
 * `vault` (or `wallet`), or `null` when they recognise none. A throw is
 * passed on as `connect`'s error.
 */
export type ConfirmWalletHandler = (
    request: ConfirmWalletRequest,
) => Promise<{ wallet: string } | null> | { wallet: string } | null;

/**
 * How `connect` asks the user to confirm a wallet it will not adopt on its own:
 * - `'builtin'` (default): the SDK's own chooser, in the portal dialog.
 * - a function: your own UI (see `ConfirmWalletHandler`).
 * - `'throw'`: `connect` throws `WalletNeedsConfirmationError`; call
 *   `connect({ confirmWallet })` within 2 minutes with the user's choice.
 */
export type OnConfirmWallet = ConfirmWalletHandler | 'builtin' | 'throw';

/**
 * Thrown by `connect` with `onConfirmWallet: 'throw'`: the passkey is proven
 * to hold these wallets, and none can be adopted without the user. Show them
 * (their `vault` addresses) and call `connect({ confirmWallet })` with the one
 * the user recognises — within 2 minutes that needs no second passkey prompt.
 */
export class WalletNeedsConfirmationError extends Error {
    readonly credentialId: string;
    readonly candidates: WalletChoice[];

    constructor(credentialId: string, candidates: WalletChoice[]) {
        super(
            'Confirm which wallet is yours. Anyone can add a passkey to their own wallet, so one is ' +
                'used without asking only when this passkey has signed for it and nothing else can ' +
                'spend from it. Show the candidates (their vault addresses) and connect again with ' +
                'confirmWallet set to the one the user recognises.',
        );
        this.name = 'WalletNeedsConfirmationError';
        this.credentialId = credentialId;
        this.candidates = candidates;
    }
}

/** The user recognised none of the wallets offered. Nothing was connected or saved. */
export class WalletConfirmationDeclinedError extends Error {
    constructor() {
        super('None of the wallets this passkey is on was chosen, so no wallet was connected.');
        this.name = 'WalletConfirmationDeclinedError';
    }
}

/** The expiry of an account too short to read: sdk-legacy counts it live, forever. */
const UNREADABLE_EXPIRY = 0xffff_ffff_ffff_ffffn;
/** Target slot time. Only for an "until ~14:30" hint; slots run slower under load. */
const SLOT_MS = 400;

/** A slot's approximate time, ms since the epoch. */
const approxSlotTime = (expiresAtSlot: bigint, slot: bigint, now: number): number | null =>
    expiresAtSlot === UNREADABLE_EXPIRY ? null : now + Number(expiresAtSlot - slot) * SLOT_MS;

/**
 * A session's approximate expiry, ms since the epoch: a v2 session's Unix
 * time, offset by how far this device's clock is from the cluster's; a slot
 * (v1, or a v2 session from before time-based expiry) as `approxSlotTime`.
 */
function approxSessionExpiry(facts: WalletFacts, expiresAt: bigint, now: number): number | null {
    if (expiresAt === UNREADABLE_EXPIRY) return null;
    if (facts.version === 1 || expiryIsSlot(expiresAt)) return approxSlotTime(expiresAt, facts.slot, now);
    return now + Number(expiresAt - facts.unixTimestamp) * 1000;
}

/** A described wallet as the UI sees it: base58 strings, times instead of slots. */
export function toWalletChoice(facts: WalletFacts, now: number = Date.now()): WalletChoice {
    return {
        wallet: facts.walletPda.toBase58(),
        vault: facts.vaultPda.toBase58(),
        version: facts.version,
        lamports: facts.lamports,
        signatureCount: facts.signatureCount,
        vaultIsSystemAccount: facts.vaultIsSystemAccount,
        otherAuthorities: facts.otherAuthorities.map((a) => ({
            address: a.authorityPda.toBase58(),
            type: a.type === 'secp256r1' ? ('passkey' as const) : ('key' as const),
            role: a.role,
            ...(a.publicKey ? { key: a.publicKey.toBase58() } : {}),
            ...(a.sameRelyingParty !== undefined ? { sameRelyingParty: a.sameRelyingParty } : {}),
            trusted: a.trusted,
        })),
        liveSessions: facts.liveSessions.map((s) => ({
            address: s.sessionPda.toBase58(),
            // An unreadable session reports the all-zero key; it is no key.
            sessionKey: s.sessionKey.equals(PublicKey.default) ? null : s.sessionKey.toBase58(),
            approxExpiresAt: approxSessionExpiry(facts, s.expiresAt, now),
            trusted: s.trusted,
        })),
        pendingDeferred: facts.pendingDeferred.map((d) => ({
            address: d.deferredPda.toBase58(),
            approxExpiresAt: approxSlotTime(d.expiresAtSlot, facts.slot, now),
        })),
        tokenGrants: facts.tokenGrants.map((g) => ({
            tokenAccount: g.tokenAccount.toBase58(),
            tokenProgram: g.tokenProgram.toBase58(),
            mint: g.mint ? g.mint.toBase58() : null,
            kind: g.kind,
            grantee: g.grantee ? g.grantee.toBase58() : null,
            trusted: g.trusted,
        })),
    };
}
