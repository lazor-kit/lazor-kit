/**
 * LazorKit Wallet Mobile Adapter - Browser Helpers
 *
 * Cross-platform helpers for opening the system browser (Expo WebBrowser) and
 * listening for deep-link redirects.
 */

import { AppState, Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { logger } from '../logger';
import { PortalCancelledError } from '../../types';
import { watchForDismissal } from './dismissal';

/**
 * Opens the system browser for authentication or signing and resolves with the
 * final redirect URL. Rejects with `PortalCancelledError` when the user closes
 * the browser before the portal redirects.
 */
export const openBrowser = async (url: string, redirectUrl: string): Promise<string> => {
  try {
    if (Platform.OS === 'ios') {
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
      if (result.type === 'success') return result.url;
      if (result.type === 'cancel' || result.type === 'dismiss') throw new PortalCancelledError();
      logger.error('iOS browser session failed:', result.type, { url, redirectUrl });
      throw new Error(`Failed to open browser: ${result.type}`);
    }

    // ──────────────────────────────────────────────
    // Android & default fall-back
    // ──────────────────────────────────────────────
    return await new Promise<string>((resolve, reject) => {
      // Without this, closing the Custom Tab left the caller waiting for a
      // redirect that never comes.
      const watcher = watchForDismissal({
        onDismissed: () => {
          finish();
          reject(new PortalCancelledError());
        },
      });

      const handleUrl = (event: { url: string }) => {
        // Only the redirect this request asked for. Any app can fire a deep
        // link into this scheme; an unrelated one is not the portal's answer.
        if (!event.url.startsWith(redirectUrl)) return;
        try {
          WebBrowser.dismissBrowser();
        } catch (_dismissError) {
          // swallow
        }
        finish();
        resolve(event.url);
      };

      const subscription = Linking.addEventListener('url', handleUrl);
      const appStateSubscription = AppState.addEventListener('change', watcher.appStateChanged);
      function finish() {
        watcher.settle();
        subscription.remove();
        appStateSubscription.remove();
      }

      WebBrowser.openBrowserAsync(url).catch((error: any) => {
        logger.error('Android browser open failed:', error, { url, redirectUrl });
        finish();
        reject(error);
      });
    });
  } catch (error) {
    if (!(error instanceof PortalCancelledError)) {
      logger.error('Browser opening error:', error, { url, redirectUrl });
    }
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
