/**
 * LazorKit Wallet Mobile Adapter - Browser Result Parser
 *
 * Parses the deep-link redirect URL returned by the LazorKit portal after a
 * sign operation and extracts the WebAuthn signature pieces.
 */

import { BrowserResult } from '../../types';
import { logger } from '../logger';

/**
 * Extracts signature and authenticator data from redirect URL.
 */
export const handleBrowserResult = (url: string): BrowserResult => {
  try {
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
