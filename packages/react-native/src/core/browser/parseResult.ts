/**
 * LazorKit Wallet Mobile Adapter - Browser Result Parser
 *
 * Parses the deep-link redirect URL returned by the LazorKit portal after a
 * sign operation and extracts the WebAuthn signature pieces.
 */

import { BrowserResult, LazorKitError } from '../../types';
import { logger } from '../logger';
import { portalRefusal } from '../approval/errors';

/** Longest portal error text passed on; the redirect is not a place for essays. */
const MAX_PORTAL_ERROR_LENGTH = 500;

/**
 * The failure the portal reported on its redirect — or `null` when it
 * reported none. Checked before anything else, so the app sees why the portal
 * failed rather than which field was missing.
 *
 * - A typed request's refusal (`type=error&code=<code>`):
 *   `RequestOutOfDateError` for `stale-counter`, `PortalRefusedError` with the
 *   code for the others. The passkey signed nothing.
 * - Any other `error=<text>`: a `LazorKitError` carrying that text.
 */
export const portalErrorOf = (url: string): Error | null => {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const text = (params.get('error') ?? '').trim().slice(0, MAX_PORTAL_ERROR_LENGTH);
  const refusal = portalRefusal(params.get('code'), text);
  if (refusal) return refusal;
  if (!text) return null;
  return new LazorKitError(text, 'PORTAL_ERROR');
};

/** The `typed*` parameters of a redirect, as they arrived, or undefined when it has none. */
function typedOf(params: URLSearchParams): BrowserResult['typed'] {
  const names = ['typedV', 'typedKind', 'typedSlot', 'typedCounter', 'typedSysvarIx'];
  if (!names.some((name) => params.has(name))) return undefined;
  return Object.fromEntries(names.map((name) => [name, params.get(name)]));
}

/**
 * Extracts signature and authenticator data from redirect URL.
 */
export const handleBrowserResult = (url: string): BrowserResult => {
  try {
    const portalError = portalErrorOf(url);
    if (portalError) throw portalError;

    const parsed = new URL(url);
    if (parsed.searchParams.get('success') !== 'true') {
      logger.error('Browser result failed: success parameter is not true', { url });
      throw new Error('Sign failed: success parameter is not true');
    }

    const signature = parsed.searchParams.get('signature');
    const clientDataJsonBase64 = parsed.searchParams.get('clientDataJSONReturn');
    const authenticatorDataBase64 = parsed.searchParams.get('authenticatorDataReturn');
    const message = parsed.searchParams.get('msg');
    if (!signature || !clientDataJsonBase64 || !authenticatorDataBase64 || !message) {
      logger.error('Browser result failed: missing signature data', {
        url,
        hasSignature: !!signature,
        hasClientData: !!clientDataJsonBase64,
        hasAuthData: !!authenticatorDataBase64,
        hasMessage: !!message,
      });
      throw new Error('Missing signature or message from redirect');
    }

    const typed = typedOf(parsed.searchParams);
    return {
      signature,
      clientDataJsonBase64,
      authenticatorDataBase64,
      message,
      credentialId: parsed.searchParams.get('credentialId') || undefined,
      ...(typed ? { typed } : {}),
    };
  } catch (error) {
    logger.error('Failed to handle browser result:', error, { url });
    throw error;
  }
};
