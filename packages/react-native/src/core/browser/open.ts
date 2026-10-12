/**
 * LazorKit Wallet Mobile Adapter - Browser Helpers
 *
 * Cross-platform helpers for opening the system browser (Expo WebBrowser) and
 * listening for deep-link redirects.
 */

import { AppState, Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { logger } from '../logger';
import { PortalCancelledError, PortalTimeoutError, type BrowserOptions } from '../../types';
import { watchForDismissal } from './dismissal';

/** How long the browser may stay open without an answer, by default (see `BrowserOptions.timeoutMs`). */
export const BROWSER_TIMEOUT_MS = 120_000;

/** A typed approval's floor: its portal picks the slot at Approve, so reading the screen costs the transaction nothing. */
export const APPROVAL_TIMEOUT_MS = 10 * 60_000;

/**
 * iOS: how long after one authentication session ends the next may start.
 * `ASWebAuthenticationSession.start()` fails while the last one is still
 * being dismissed, and expo-web-browser ignores that failure: the promise
 * never settles (an ownership proof right after the connect reply did that).
 */
export const AUTH_SESSION_GAP_MS = 750;

let options: Required<BrowserOptions> = { preferEphemeralSession: true, timeoutMs: BROWSER_TIMEOUT_MS };
let lastSessionEndedAt = 0;

/** Set by the store from the provider's `browserOptions` (see `BrowserOptions`). */
export function configureBrowser(next: BrowserOptions | undefined): void {
  options = {
    preferEphemeralSession: next?.preferEphemeralSession ?? true,
    timeoutMs: next?.timeoutMs && next.timeoutMs > 0 ? next.timeoutMs : BROWSER_TIMEOUT_MS,
  };
}

/** What the browser trip came back with. */
export interface BrowserReply {
  /** The redirect URL. */
  url: string;
  /**
   * It came through the iOS authentication session, which hands its callback
   * to the session that opened it and to no other app. A deep link (Android)
   * can come from any app that can open the scheme.
   */
  authSession: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the system browser for authentication or signing and resolves with
 * the final redirect URL. Rejects with `PortalCancelledError` when the user
 * closes the browser before the portal redirects, and with
 * `PortalTimeoutError` when nothing comes back within the timeout (the
 * browser is closed then).
 */
export const openBrowser = async (url: string, redirectUrl: string, call: { timeoutMs?: number } = {}): Promise<string> =>
  (await openBrowserSession(url, redirectUrl, call)).url;

/** `openBrowser`, saying whether the reply came through the iOS authentication session. */
export const openBrowserSession = async (
  url: string,
  redirectUrl: string,
  call: { timeoutMs?: number } = {},
): Promise<BrowserReply> => {
  const timeoutMs = Math.max(options.timeoutMs, call.timeoutMs ?? 0);
  try {
    if (Platform.OS === 'ios') {
      const gap = lastSessionEndedAt + AUTH_SESSION_GAP_MS - Date.now();
      if (gap > 0) await sleep(gap);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            WebBrowser.dismissAuthSession();
          } catch {
            // swallow: it may never have opened
          }
          reject(new PortalTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await Promise.race([
          WebBrowser.openAuthSessionAsync(url, redirectUrl, {
            preferEphemeralSession: options.preferEphemeralSession,
          }),
          timedOut,
        ]);
      } finally {
        clearTimeout(timer);
        lastSessionEndedAt = Date.now();
      }
      if (result.type === 'success') return { url: result.url, authSession: true };
      if (result.type === 'cancel' || result.type === 'dismiss') throw new PortalCancelledError();
      logger.error('iOS browser session failed:', result.type, { url, redirectUrl });
      throw new Error(`Failed to open browser: ${result.type}`);
    }

    // ──────────────────────────────────────────────
    // Android & default fall-back
    // ──────────────────────────────────────────────
    const redirected = await new Promise<string>((resolve, reject) => {
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
      const timer = setTimeout(() => {
        finish();
        try {
          WebBrowser.dismissBrowser();
        } catch {
          // swallow
        }
        reject(new PortalTimeoutError(timeoutMs));
      }, timeoutMs);
      function finish() {
        clearTimeout(timer);
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
    return { url: redirected, authSession: false };
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
