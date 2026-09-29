/**
 * Telling a closed Android Custom Tab from one that is about to redirect.
 *
 * `openBrowserAsync` on Android returns as soon as the tab is open, and the
 * tab says nothing when the user closes it. What the app sees is its own
 * AppState going back to 'active' — which also happens, first, when the
 * portal's redirect brings it back: the 'url' event can land a moment after
 * the state change. So coming back only counts as a dismissal once no
 * redirect has followed for a short while.
 */

/** How long after the app is back in front a redirect may still arrive. */
export const REDIRECT_GRACE_MS = 1500;

export interface DismissalWatcher {
  /** Feed every AppState change. */
  appStateChanged: (state: string) => void;
  /** The flow is over (a redirect arrived, or it failed): stop watching. */
  settle: () => void;
}

export function watchForDismissal(params: {
  onDismissed: () => void;
  graceMs?: number;
  /** Injectable for tests. */
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  };
}): DismissalWatcher {
  const graceMs = params.graceMs ?? REDIRECT_GRACE_MS;
  const timers = params.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  // Only a return from elsewhere counts: an 'active' before the app ever left
  // (RN may report the current state as a change) is not the tab closing.
  let away = false;
  let timer: unknown = null;
  let settled = false;

  const stopTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  return {
    appStateChanged: (state) => {
      if (settled) return;
      if (state !== 'active') {
        // Gone again before the grace ran out: the flow is still going.
        away = true;
        stopTimer();
        return;
      }
      if (!away || timer !== null) return;
      timer = timers.set(() => {
        timer = null;
        if (settled) return;
        settled = true;
        params.onDismissed();
      }, graceMs);
    },
    settle: () => {
      settled = true;
      stopTimer();
    },
  };
}
