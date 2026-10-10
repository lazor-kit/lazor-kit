/**
 * Typed approval requests (v1): the check of what the portal answers. The
 * same as the web SDK's; only the channel differs (a redirect here, whose
 * `typed*` parameters `parseTypedReplyParams` reads).
 *
 * For CreateSession, RevokeSession and RemoveAuthority on a v2 wallet the
 * protocol SDK's `prepareX` returns, beside the challenge, `request`: the
 * operation's parameters in the v1 envelope. The SDK sends it to the portal
 * in the URL fragment (`#/?lk1=…`, `withApprovalFragment`), so the portal can
 * show exactly what the passkey approves ("Let … spend up to 0.002 SOL per
 * payment …"). The query is what 2.x sent, so a portal that does not read
 * typed requests signs as before.
 *
 * A portal that reads them recomputes the challenge from the parameters it
 * shows, picks the slot it signs when the user taps Approve (and the counter
 * from the chain), and names both in its reply (`typed`). Before anything is
 * sent, the reply is checked here against what this SDK prepared:
 *
 * - `clientDataJSON` is a `webauthn.get`;
 * - with a `typed` block: its kind and sysvar index are this request's, its
 *   counter is not below the one prepared, and the passkey signed the
 *   challenge of this request at the portal's slot and counter
 *   (`verifyApprovalReply`). The transaction is then finalized at that slot
 *   and counter (`finalizeX(prepared, response, binding)`), which recomputes
 *   the challenge from this SDK's own prepared inputs and checks it again;
 * - without one (a portal that does not read typed requests, or a v1 wallet,
 *   which sends none): the passkey signed the challenge this SDK prepared.
 *
 * Anything else is `PortalReplyMismatchError`, and nothing is sent.
 */
import { Buffer } from 'buffer';
import {
  PortalReplyMismatchError,
  verifyApprovalReply,
  type ApprovalBinding,
  type ApprovalKind,
  type ApprovalRequest,
  type TypedReply,
} from '@lazorkit/sdk-legacy/approval';

export type { ApprovalBinding };

/** Bytes as base64url without padding: how a challenge appears in clientDataJSON. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientDataBytes(clientDataJsonBase64: unknown): Uint8Array {
  if (typeof clientDataJsonBase64 !== 'string' || !clientDataJsonBase64) {
    throw new PortalReplyMismatchError('no clientDataJSON');
  }
  return new Uint8Array(Buffer.from(clientDataJsonBase64, 'base64'));
}

/** The challenge in `clientDataJSON`, after checking it is a `webauthn.get`. */
function signedChallenge(clientDataJson: Uint8Array): string {
  let clientData: unknown;
  try {
    clientData = JSON.parse(Buffer.from(clientDataJson).toString('utf8'));
  } catch {
    throw new PortalReplyMismatchError('clientDataJSON is not JSON');
  }
  const { type, challenge } = (clientData ?? {}) as { type?: unknown; challenge?: unknown };
  if (type !== 'webauthn.get') throw new PortalReplyMismatchError('clientDataJSON type is not webauthn.get');
  if (typeof challenge !== 'string') throw new PortalReplyMismatchError('clientDataJSON has no challenge');
  return challenge;
}

/**
 * Checks a portal reply against what this SDK prepared, and returns the slot
 * and counter to finalize with: the portal's when it answered with a `typed`
 * block, `undefined` (the prepared ones) when it did not.
 *
 * - `prepared`: the prepared operation: its `challenge`, and its `request`
 *   when the portal was sent one.
 * - `typed`: the reply's `typed` block, parsed (`parseTypedReply`,
 *   `parseTypedReplyParams`), or undefined when it has none.
 *
 * Throws `PortalReplyMismatchError` on any difference; nothing may be sent then.
 */
export function bindingForReply(params: {
  kind: ApprovalKind;
  prepared: { challenge: Uint8Array; request?: ApprovalRequest };
  clientDataJsonBase64: unknown;
  typed: TypedReply | undefined;
}): ApprovalBinding | undefined {
  const { kind, prepared, typed } = params;
  const clientDataJson = clientDataBytes(params.clientDataJsonBase64);
  const request = prepared.request;

  if (!request) {
    // Nothing typed was sent (a v1 wallet): the prepared challenge, as 2.x.
    if (typed !== undefined) throw new PortalReplyMismatchError('a typed reply to a request that was not typed');
    if (signedChallenge(clientDataJson) !== toBase64Url(prepared.challenge)) {
      throw new PortalReplyMismatchError('the passkey signed another challenge');
    }
    return undefined;
  }
  if (request.kind !== kind) throw new PortalReplyMismatchError(`the request is ${request.kind}, not ${kind}`);

  const verified = verifyApprovalReply(request, { clientDataJson, ...(typed !== undefined ? { typed } : {}) });
  if (!verified.typed && toBase64Url(verified.challenge) !== toBase64Url(prepared.challenge)) {
    throw new PortalReplyMismatchError('the request does not describe what this SDK prepared');
  }
  return verified.typed ? verified.binding : undefined;
}
