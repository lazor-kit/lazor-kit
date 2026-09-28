/**
 * State that lives between `connect` calls while the user picks a wallet.
 *
 * In memory only, never persisted: the facts come from a proof verified in
 * this JS context, and are worth nothing after a restart.
 */
import { selectWalletByAddress, type WalletFacts } from '@lazorkit/sdk-legacy';
import type { WalletInfo } from '../../types';

// ─── Remembered candidates (onConfirmWallet: 'throw') ──────────────

/** How long a `WalletNeedsConfirmationError`'s candidates can be confirmed without the portal. */
export const PENDING_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

interface Remembered {
  /** Which program, cluster and relying party the facts were read for. */
  scope: string;
  /** The connect reply they came from. */
  data: WalletInfo;
  facts: WalletFacts[];
  at: number;
}

let remembered: Remembered | null = null;

/**
 * Keep what `connect` found, so that a `connect({ confirmWallet })` right
 * after `WalletNeedsConfirmationError` does not need another trip through the
 * portal. Replaces anything remembered before.
 */
export function rememberCandidates(
  scope: string,
  data: WalletInfo,
  facts: WalletFacts[],
  now: number = Date.now(),
): void {
  remembered = { scope, data, facts, at: now };
}

/**
 * The remembered candidate at `address` (its vault or wallet PDA), if it was
 * remembered for this scope less than two minutes ago. Taking it forgets
 * everything remembered: it is used once.
 */
export function takeRememberedCandidate(
  scope: string,
  address: string,
  now: number = Date.now(),
): { data: WalletInfo; facts: WalletFacts } | null {
  const entry = remembered;
  if (!entry) return null;
  // A clock that went backwards counts as expired too.
  if (now - entry.at > PENDING_CONFIRMATION_TTL_MS || now < entry.at) {
    remembered = null;
    return null;
  }
  if (entry.scope !== scope) return null;
  const facts = selectWalletByAddress(entry.facts, address);
  if (!facts) return null;
  remembered = null;
  return { data: entry.data, facts };
}

/**
 * Forget the remembered candidates: on disconnect, when a connect opens the
 * portal, and once a wallet is connected.
 */
export function forgetCandidates(): void {
  remembered = null;
}

// ─── The built-in chooser's host ───────────────────────────────────

let chooserHosts = 0;

/**
 * Called by the component that draws the built-in chooser, while it is
 * mounted. Returns the unregister function.
 */
export function registerChooserHost(): () => void {
  chooserHosts += 1;
  let registered = true;
  return () => {
    if (registered) chooserHosts -= 1;
    registered = false;
  };
}

/**
 * Whether something can draw the built-in chooser. Without it, waiting for
 * the user's answer would wait forever.
 */
export function hasChooserHost(): boolean {
  return chooserHosts > 0;
}
