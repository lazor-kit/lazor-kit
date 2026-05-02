/**
 * LazorKit Wallet Mobile Adapter - Browser Helpers
 *
 * Cross-platform helpers for opening the system browser (Expo WebBrowser) and
 * listening for deep-link redirects.
 */

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { logger } from '../logger';

/**
 * Opens the system browser for authentication or signing and resolves with the
 * final redirect URL.
 */
export const openBrowser = async (url: string, redirectUrl: string): Promise<string> => {
  try {
    if (Platform.OS === 'ios') {
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
      if (result.type !== 'success') {
        logger.error('iOS browser session failed:', result.type, { url, redirectUrl });
        throw new Error(`Failed to open browser: ${result.type}`);
      }
      return result.url;
    }

    // ──────────────────────────────────────────────
    // Android & default fall-back
    // ──────────────────────────────────────────────
    return new Promise((resolve, reject) => {
      const handleUrl = (event: { url: string }) => {
        try {
          WebBrowser.dismissBrowser();
        } catch (_dismissError) {
          // swallow
        }
        subscription.remove();
        resolve(event.url);
      };

      const subscription = Linking.addEventListener('url', handleUrl);

      WebBrowser.openBrowserAsync(url).catch((error: any) => {
        logger.error('Android browser open failed:', error, { url, redirectUrl });
        subscription.remove();
        reject(error);
      });
    });
  } catch (error) {
    logger.error('Browser opening error:', error, { url, redirectUrl });
    throw error;
  }
};

/**
 * Thin convenience wrapper that automatically calls `openBrowser` and pipes the
 * result to success / error callbacks.
 */
export const openSignBrowser = async (
  url: string,
  redirectUrl: string,
  onSuccess: (result: string) => void,
  onError: (error: Error) => void
): Promise<void> => {
  try {
    const result = await openBrowser(url, redirectUrl);
    onSuccess(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown browser error');
    logger.error('Sign browser error:', err, { url, redirectUrl });
    onError(err);
  }
};
