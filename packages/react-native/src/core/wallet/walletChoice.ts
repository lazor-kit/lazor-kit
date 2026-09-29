/**
 * What a wallet chooser shows about a wallet, from the facts the SDK read.
 *
 * Pure: no React, no RPC. The built-in chooser and `WalletNeedsConfirmationError`
 * both take their rows from here, so an app's own chooser gets the same facts
 * the built-in one draws.
 */
import { PublicKey } from '@solana/web3.js';
import type { WalletFacts } from '@lazorkit/sdk-legacy';
import type { WalletChoice } from '../../types';

/** The expiry the SDK reports for a session or deferred execution it cannot read. */
const UNREADABLE_EXPIRY = 2n ** 64n - 1n;

/** Roughly how long a slot lasts. Expiries are slots; people read clocks. */
const MS_PER_SLOT = 400;

/** An expiry slot as an approximate time, or `null` when it could not be read. */
function approxTime(expiresAtSlot: bigint, slot: bigint, now: number): number | null {
  if (expiresAtSlot === UNREADABLE_EXPIRY) return null;
  return now + Number(expiresAtSlot - slot) * MS_PER_SLOT;
}

/** A wallet's facts in the shape a chooser shows: base58 strings, times instead of slots. */
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
      type: a.type === 'ed25519' ? ('key' as const) : ('passkey' as const),
      role: a.role,
      ...(a.publicKey ? { key: a.publicKey.toBase58() } : {}),
      ...(a.sameRelyingParty !== undefined ? { sameRelyingParty: a.sameRelyingParty } : {}),
      trusted: a.trusted,
    })),
    liveSessions: facts.liveSessions.map((s) => ({
      address: s.sessionPda.toBase58(),
      // The SDK reports an unreadable session's key as the all-zero address,
      // which is nobody's key and must not be shown as one.
      sessionKey: s.sessionKey.equals(PublicKey.default) ? null : s.sessionKey.toBase58(),
      approxExpiresAt: approxTime(s.expiresAtSlot, facts.slot, now),
      trusted: s.trusted,
    })),
    pendingDeferred: facts.pendingDeferred.map((d) => ({
      address: d.deferredPda.toBase58(),
      approxExpiresAt: approxTime(d.expiresAtSlot, facts.slot, now),
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

// ─── Chooser wording ────────────────────────────────────────────────

export const CHOOSER_TEXT = {
  title: 'Which wallet is yours?',
  intro:
    'Anyone can add your passkey to their own wallet, so only choose a wallet you recognise.',
  notUsedYet:
    'Not used with this passkey yet. Continue only if you created it, for example just now or ' +
    'on the LazorKit migration page.',
  vaultHandedAway:
    "This wallet's vault was handed to another program. Your passkey can no longer move what " +
    'is in it or what is sent to it.',
  legacy: 'Legacy (v1)',
  use: 'Use this wallet',
  none: 'None of these',
} as const;

/** The mints `describeWalletCandidates` always watches, by the names people know them by. */
const MINT_NAMES: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'wSOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC (devnet)',
};

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Lamports as SOL, to four places; a dust balance is not shown as zero. */
export function formatSol(lamports: number): string {
  if (lamports > 0 && lamports < 100_000) return '< 0.0001';
  return (lamports / 1e9).toFixed(4).replace(/\.?0+$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * " until ~14:30" (today), " until ~3 Oct, 14:30", or " (expiry unknown)".
 * Hand-rolled: Hermes may ship without Intl.
 */
export function formatExpiry(approxExpiresAt: number | null, now: number = Date.now()): string {
  if (approxExpiresAt === null) return ' (expiry unknown)';
  const at = new Date(approxExpiresAt);
  // A readable expiry can still be set so far out that no Date holds it.
  if (Number.isNaN(at.getTime())) return ' (no practical expiry)';
  const today = new Date(now);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (at.toDateString() === today.toDateString()) return ` until ~${time}`;
  const year = at.getFullYear() === today.getFullYear() ? '' : ` ${at.getFullYear()}`;
  return ` until ~${at.getDate()} ${MONTHS[at.getMonth()]}${year}, ${time}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', spender: 'Spender', unknown: 'unknown role' };

/**
 * Who else can spend from the wallet, counted, for "Also controlled by: …".
 * Only what is not trusted: a key the app declared in `trustedAuthorities` is
 * its own. Empty when nothing is.
 */
export function alsoControlledBy(choice: WalletChoice, now: number = Date.now()): string[] {
  const items: string[] = [];

  const others = choice.otherAuthorities.filter((a) => !a.trusted);
  const passkeys = others.filter((a) => a.type === 'passkey').length;
  if (passkeys) items.push(plural(passkeys, 'other passkey', 'other passkeys'));
  for (const role of ['owner', 'admin', 'spender', 'unknown'] as const) {
    const keys = others.filter((a) => a.type === 'key' && a.role === role).length;
    if (keys) items.push(`${plural(keys, 'backend key', 'backend keys')} (${ROLE_LABEL[role]})`);
  }

  const sessions = choice.liveSessions.filter((s) => !s.trusted);
  if (sessions.length) {
    // When they all stop is what matters; one unreadable expiry means nobody knows.
    const last = sessions.some((s) => s.approxExpiresAt === null)
      ? null
      : Math.max(...sessions.map((s) => s.approxExpiresAt as number));
    const expiry = formatExpiry(last, now);
    items.push(
      sessions.length === 1
        ? `1 session key${expiry}`
        : `${sessions.length} session keys${last === null ? expiry : `${expiry} at the latest`}`,
    );
  }

  // Never trusted, and often the user's own half-finished two-step
  // transaction: so "pending", not "someone else's".
  const pending = choice.pendingDeferred.length;
  if (pending) items.push(plural(pending, 'pending transaction', 'pending transactions'));

  const grants = choice.tokenGrants.filter((g) => !g.trusted);
  const count = (kind: WalletChoice['tokenGrants'][number]['kind']) =>
    grants.filter((g) => g.kind === kind);
  const delegates = count('delegate').length;
  if (delegates) items.push(plural(delegates, 'token spending approval', 'token spending approvals'));
  const closers = count('closeAuthority').length;
  if (closers) {
    items.push(
      plural(closers, 'token account someone else can close', 'token accounts someone else can close'),
    );
  }
  const handed = count('owner');
  if (handed.length) {
    // Only watched mints are ever reported this way: the four defaults, by
    // name, or one of the app's own watchMints, by address.
    const mints = [...new Set(handed.map((g) => (g.mint ? (MINT_NAMES[g.mint] ?? shortAddress(g.mint)) : null)))]
      .filter((m): m is string => m !== null);
    items.push(
      plural(handed.length, 'token account handed to someone else', 'token accounts handed to someone else') +
        (mints.length ? ` (${mints.join(', ')})` : ''),
    );
  }
  const unreadable = count('unreadable').length;
  if (unreadable) items.push(plural(unreadable, 'unreadable token account', 'unreadable token accounts'));

  return items;
}
