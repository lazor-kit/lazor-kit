/**
 * What this release cannot build for a LazorKit v2 wallet.
 *
 * The LazorKit v2 program reads a session's expiry, an action's expiry and a
 * recurring limit's window in Unix seconds (devnet runs that release now,
 * and mainnet v2 will). This 2.x line builds them in slots, as the program
 * read them before (`@lazorkit/sdk-legacy` 1.x). Sent to the program that
 * reads seconds:
 * - a session's expiry in slots (`expiresAtSlot`) is refused on chain with
 *   InvalidSessionDuration (3008), after the user approved with the passkey;
 * - an action's expiry in slots is stored as a time long past: a limit or a
 *   program whitelist then denies everything, and a blacklist entry stops
 *   blocking its program;
 * - a recurring window in slots lasts that many seconds instead.
 *
 * So `createSession` and an `addAuthorityEd25519` whose policy carries an
 * expiry or a recurring window are refused on a v2 wallet before anything is
 * read or the portal opens, with `SdkUpgradeRequiredError`.
 * `@lazorkit/wallet-mobile-adapter` 3.0 builds them in seconds. v1 wallets
 * are unchanged.
 */
import { chainHasError } from '../../program/errorShape';

/** The release that builds these in seconds, and how to install it. */
export const SDK_UPGRADE_HINT =
  '@lazorkit/wallet-mobile-adapter 3.0 (npm install @lazorkit/wallet-mobile-adapter@next)';

/** What a v2 wallet needs `@lazorkit/wallet-mobile-adapter` 3.0 for. */
export type UpgradeRequiredOperation = 'createSession' | 'addAuthorityEd25519';

/**
 * The call needs `@lazorkit/wallet-mobile-adapter` 3.0 on a LazorKit v2
 * wallet: this release would send a time in slots where the program reads
 * seconds. Nothing was read, prompted, signed or sent.
 */
export class SdkUpgradeRequiredError extends Error {
  constructor(
    /** The call that was refused. */
    readonly operation: UpgradeRequiredOperation,
  ) {
    super(
      operation === 'createSession'
        ? `Creating sessions on v2 wallets requires ${SDK_UPGRADE_HINT}. This release ` +
            'sets a session expiry in slots, and the LazorKit v2 program reads it in Unix ' +
            'seconds, so the program would refuse the session (InvalidSessionDuration, 3008) ' +
            'after the passkey prompt. Nothing was signed or sent.'
        : `Adding a key whose policy has an expiry or a recurring limit to a v2 wallet ` +
            `requires ${SDK_UPGRADE_HINT}. This release builds both in slots, and the ` +
            'LazorKit v2 program reads them in Unix seconds: an expiry would be a time long ' +
            'past (a limit or whitelist would deny everything, a blacklist entry would stop ' +
            'blocking) and a window would last that many seconds. A policy with neither ' +
            'still works with this release. Nothing was signed or sent.',
    );
    this.name = 'SdkUpgradeRequiredError';
  }
}

/**
 * True for an `SdkUpgradeRequiredError`, also one from another copy of this
 * package (by `name`) and one wrapped in `cause` or `error`.
 */
export function isSdkUpgradeRequiredError(error: unknown): boolean {
  return chainHasError(error, SdkUpgradeRequiredError, 'SdkUpgradeRequiredError');
}

/** Action header: [type: u8][data_len: u16 LE][expires_at: u64 LE]. */
const ACTION_HEADER_SIZE = 11;
/** `SessionActionType.SolRecurringLimit` and `TokenRecurringLimit`: the actions with a window. */
const RECURRING_ACTION_TYPES = [2, 5];

/**
 * Whether a serialized policy (`serializeActions([...])`) has an action with
 * an expiry of its own or a recurring window: what this release builds in
 * slots. A buffer that does not parse is left to the program, which refuses
 * it (ActionBufferInvalid, 3020) whatever its times; the actions read before
 * the fault still count.
 */
export function policyHasSlotTimes(policy: Uint8Array): boolean {
  let offset = 0;
  while (offset + ACTION_HEADER_SIZE <= policy.length) {
    const type = policy[offset];
    const dataLength = policy[offset + 1] | (policy[offset + 2] << 8);
    for (let i = 3; i < ACTION_HEADER_SIZE; i++) {
      if (policy[offset + i] !== 0) return true; // expires_at ≠ 0
    }
    if (RECURRING_ACTION_TYPES.includes(type)) return true;
    offset += ACTION_HEADER_SIZE + dataLength;
  }
  return false;
}
