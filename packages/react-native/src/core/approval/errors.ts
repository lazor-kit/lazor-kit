/**
 * The portal's refusals of a typed request. Each says the passkey signed
 * nothing. `stale-counter` (the portal's node was behind this SDK's view of
 * the passkey's counter) is `RequestOutOfDateError`, which is retryable: a
 * new request may go through. The others are `PortalRefusedError`, with the
 * portal's `code`.
 */
import {
  APPROVAL_REFUSAL_CODES,
  RequestOutOfDateError,
  type ApprovalRefusalCode,
} from '@lazorkit/sdk-legacy/approval';

/** The portal refused a typed request; the passkey signed nothing. */
export class PortalRefusedError extends Error {
  constructor(
    /** The portal's code: `typed-malformed`, `typed-unsupported`, `wrong-network`, `challenge-mismatch`, `request-invalid` or `chain-unavailable`. */
    readonly code: ApprovalRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'PortalRefusedError';
  }
}

/**
 * The error for a portal refusal with `code`, or undefined when `code` is not
 * one of the typed-request refusal codes.
 */
export function portalRefusal(code: unknown, message: string): Error | undefined {
  if (typeof code !== 'string' || !(APPROVAL_REFUSAL_CODES as readonly string[]).includes(code)) return undefined;
  const text = message || `The LazorKit portal refused this request (${code}); your passkey signed nothing.`;
  if (code === 'stale-counter') return new RequestOutOfDateError(text);
  return new PortalRefusedError(code as ApprovalRefusalCode, text);
}
