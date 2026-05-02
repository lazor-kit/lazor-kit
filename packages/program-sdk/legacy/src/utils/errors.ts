/**
 * Error code map for LazorKit program errors.
 */

/** Map of error code → human-readable name */
export const ERROR_NAMES: Record<number, string> = {
  3001: 'InvalidAuthorityPayload',
  3002: 'PermissionDenied',
  3003: 'InvalidInstruction',
  3004: 'InvalidPubkey',
  3005: 'InvalidMessageHash',
  3006: 'SignatureReused',
  3007: 'InvalidSignatureAge',
  3008: 'InvalidSessionDuration',
  3009: 'SessionExpired',
  3010: 'AuthorityDoesNotSupportSession',
  3011: 'InvalidAuthenticationKind',
  3012: 'InvalidMessage',
  3013: 'SelfReentrancyNotAllowed',
  3014: 'DeferredAuthorizationExpired',
  3015: 'DeferredHashMismatch',
  3016: 'InvalidExpiryWindow',
  3017: 'UnauthorizedReclaim',
  3018: 'DeferredAuthorizationNotExpired',
  3019: 'InvalidSessionAccount',
  // Session action errors
  3020: 'ActionBufferInvalid',
  3021: 'ActionProgramNotWhitelisted',
  3022: 'ActionProgramBlacklisted',
  3023: 'ActionSolMaxPerTxExceeded',
  3024: 'ActionSolLimitExceeded',
  3025: 'ActionSolRecurringLimitExceeded',
  3026: 'ActionTokenLimitExceeded',
  3027: 'ActionTokenRecurringLimitExceeded',
  3028: 'ActionWhitelistBlacklistConflict',
  3029: 'ActionTokenMaxPerTxExceeded',
};

/**
 * Look up error name from code.
 */
export function errorFromCode(code: number): string | undefined {
  return ERROR_NAMES[code];
}

/**
 * Extracts the custom program error code from a Solana SendTransactionError.
 * Returns null if the error is not a custom program error.
 */
export function extractErrorCode(err: unknown): number | null {
  const msg = String(err);
  const match = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (match) return parseInt(match[1], 16);
  const match2 = msg.match(/Custom\((\d+)\)/);
  if (match2) return parseInt(match2[1], 10);
  return null;
}
