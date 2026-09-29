/**
 * State that lives between `connect` calls while the user picks a wallet.
 *
 * In memory only, never persisted: the facts come from a proof verified in
 * this JS context, and are worth nothing after a restart.
 */
import { selectWalletByAddress, type WalletFacts } from '@lazorkit/sdk-legacy';
import { PortalCancelledError, type WalletInfo } from '../../types';

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
 * everything remembered: it is used once. `null` when nothing is remembered
 * for this scope. Throws when something is, and `address` names none of it —
 * leaving it remembered, so that the right address still needs no portal.
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
  if (!facts) throw notOffered(address, entry.facts);
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

/** A `confirmWallet` (or a chooser's answer) that names none of the wallets offered. Never ignored. */
export function notOffered(address: string, offered: readonly WalletFacts[]): Error {
  const vaults = offered.map((f) => f.vaultPda.toBase58());
  return new Error(
    `${address} is not a wallet this passkey is proven to hold, so no wallet was connected. ` +
      (vaults.length
        ? `Pass the vault (or wallet) address of one of: ${vaults.join(', ')}.`
        : 'This passkey holds no wallet that could be confirmed.'),
  );
}

/**
 * What a connect rejects with once `disconnect` has abandoned it. The same
 * type as the user closing the portal, so an app treats both as a cancel.
 */
export function connectAbandoned(): PortalCancelledError {
  return new PortalCancelledError('disconnect was called while connecting, so no wallet was connected.');
}

// ─── The built-in chooser's hosts ──────────────────────────────────

/**
 * A mounted component that can draw the built-in chooser. `LazorKitProvider`
 * mounts one as the fallback; an app can mount `<WalletChooser />` inside its
 * own top-most modal (on iOS nothing else can appear over that), and while it
 * is mounted it draws instead.
 */
interface ChooserHost {
  readonly fallback: boolean;
}

let hosts: ChooserHost[] = [];
const hostListeners = new Set<() => void>();

/**
 * Called by a component that draws the built-in chooser, while it is mounted.
 * Returns the host and its unregister function.
 */
export function registerChooserHost(fallback: boolean): { host: ChooserHost; unregister: () => void } {
  const host: ChooserHost = { fallback };
  hosts = [...hosts, host];
  hostListeners.forEach((listener) => listener());
  return {
    host,
    unregister: () => {
      if (!hosts.includes(host)) return;
      hosts = hosts.filter((h) => h !== host);
      hostListeners.forEach((listener) => listener());
    },
  };
}

/** The host that draws: the last one an app mounted, else the provider's. */
export function activeChooserHost(): ChooserHost | null {
  for (let i = hosts.length - 1; i >= 0; i -= 1) if (!hosts[i].fallback) return hosts[i];
  return hosts[hosts.length - 1] ?? null;
}

/** Told whenever a host mounts or unmounts. Returns the unsubscribe function. */
export function subscribeChooserHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/**
 * Whether something can draw the built-in chooser. Without it, waiting for
 * the user's answer would wait forever.
 */
export function hasChooserHost(): boolean {
  return hosts.length > 0;
}
