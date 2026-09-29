/**
 * LazorKit Wallet Mobile Adapter - Browser Result Parser
 *
 * Parses the deep-link redirect URL returned by the LazorKit portal after a
 * sign operation and extracts the WebAuthn signature pieces.
 */

import { BrowserResult, LazorKitError } from '../../types';
import { logger } from '../logger';

/** Longest portal error text passed on; the redirect is not a place for essays. */
const MAX_PORTAL_ERROR_LENGTH = 500;

/**
 * The failure the portal reported on its redirect (`error=<text>`), as an
 * error carrying that text — or `null` when it reported none. Checked before
 * anything else, so the app sees why the portal failed rather than which
 * field was missing.
 */
export const portalErrorOf = (url: string): LazorKitError | null => {
  let text: string | null;
  try {
    text = new URL(url).searchParams.get('error');
  } catch {
    return null;
  }
  if (!text || !text.trim()) return null;
  return new LazorKitError(text.trim().slice(0, MAX_PORTAL_ERROR_LENGTH), 'PORTAL_ERROR');
};

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

    return {
      signature,
      clientDataJsonBase64,
      authenticatorDataBase64,
      message,
    };
  } catch (error) {
    logger.error('Failed to handle browser result:', error, { url });
    throw error;
  }
};
