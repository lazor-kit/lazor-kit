/**
 * LazorKit Wallet Mobile Adapter - Built-in wallet chooser
 *
 * Asks the user which wallet is theirs when `connect` cannot tell
 * (`onConfirmWallet: 'builtin'`). `LazorKitProvider` renders one, and it is
 * shown while the store holds a `pendingWalletConfirmation`.
 *
 * On iOS a `Modal` is presented by the screen it is rendered in, and not while
 * that screen already presents another: while the app has its own `<Modal>`
 * or a modal screen open, the provider's chooser cannot be shown over it. An app that connects from such a modal renders
 * `<WalletChooser />` inside it; while that one is mounted it draws instead of
 * the provider's. If the chooser still does not appear, `connect` rejects with
 * `WalletChooserNotShownError` rather than waiting for an answer that cannot
 * be given.
 *
 * Nothing here recommends a wallet. The order is the SDK's display order —
 * partly by balance, which anyone can raise by funding a vault — so no row is
 * pre-selected or marked as verified, safe or recommended.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useWalletStore } from './store';
import {
  WalletChooserNotShownError,
  type PendingWalletConfirmation,
  type WalletChoice,
} from '../types';
import {
  activeChooserHost,
  hasChooserHost,
  registerChooserHost,
  subscribeChooserHosts,
} from '../core/wallet/confirmation';
import {
  CHOOSER_TEXT,
  alsoControlledBy,
  formatSol,
  shortAddress,
} from '../core/wallet/walletChoice';

/**
 * How long iOS gets to show the chooser (`onShow`) once it is rendered, while
 * the app is in the foreground. Presenting takes a fraction of this; when iOS
 * refuses (another modal is up), nothing else would ever tell.
 */
const SHOW_TIMEOUT_MS = 3000;

const LIGHT = {
  backdrop: 'rgba(0, 0, 0, 0.5)',
  surface: '#ffffff',
  row: '#f4f4f5',
  text: '#18181b',
  muted: '#52525b',
  warningBg: '#fef2f2',
  warningText: '#991b1b',
  tagBg: '#e4e4e7',
  primary: '#18181b',
  onPrimary: '#ffffff',
  border: '#d4d4d8',
};

const DARK: typeof LIGHT = {
  backdrop: 'rgba(0, 0, 0, 0.7)',
  surface: '#18181b',
  row: '#27272a',
  text: '#fafafa',
  muted: '#a1a1aa',
  warningBg: '#450a0a',
  warningText: '#fecaca',
  tagBg: '#3f3f46',
  primary: '#fafafa',
  onPrimary: '#18181b',
  border: '#3f3f46',
};

type Palette = typeof LIGHT;

/**
 * The built-in wallet chooser, for an app that connects from inside its own
 * `<Modal>` or modal screen: render it there (once), and while it is mounted it
 * draws the chooser instead of `LazorKitProvider`'s — on iOS the provider's
 * cannot appear over an open modal. Renders nothing until `connect` asks.
 */
export const WalletChooser = (): React.JSX.Element | null => <ChooserHostView fallback={false} />;

/** The one `LazorKitProvider` renders: it draws only while no `<WalletChooser />` is mounted. */
export const BuiltinWalletChooser = (): React.JSX.Element | null => <ChooserHostView fallback />;

const ChooserHostView = ({ fallback }: { fallback: boolean }): React.JSX.Element | null => {
  const pending = useWalletStore((state) => state.pendingWalletConfirmation);
  const colors = useColorScheme() === 'dark' ? DARK : LIGHT;
  const [host, setHost] = useState<ReturnType<typeof activeChooserHost>>(null);
  const active = useSyncExternalStore(subscribeChooserHosts, activeChooserHost, activeChooserHost);

  useEffect(() => {
    const registration = registerChooserHost(fallback);
    setHost(registration.host);
    return () => {
      registration.unregister();
      // Unmounted with a question open and nothing left to draw it: nobody
      // can answer it any more, and connect would wait forever.
      if (!hasChooserHost()) useWalletStore.getState().pendingWalletConfirmation?.resolve(null);
    };
  }, [fallback]);

  // Only the active host draws: two Modals for one question would stack.
  const drawing = pending !== null && host !== null && active === host ? pending : null;
  const onShow = useShowWatchdog(drawing);

  if (!drawing) return null;
  const { request, resolve } = drawing;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={onShow}
      // Android back button: the same as "None of these".
      onRequestClose={() => resolve(null)}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View
          style={[styles.sheet, { backgroundColor: colors.surface }]}
          accessibilityViewIsModal>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {CHOOSER_TEXT.title}
          </Text>
          <Text style={[styles.intro, { color: colors.muted }]}>{CHOOSER_TEXT.intro}</Text>
          <ScrollView style={styles.list}>
            {request.candidates.map((choice) => (
              <ChoiceRow
                key={choice.wallet}
                choice={choice}
                colors={colors}
                onUse={() => resolve({ wallet: choice.wallet })}
              />
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => resolve(null)}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text style={[styles.buttonText, { color: colors.text }]}>{CHOOSER_TEXT.none}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

/**
 * On iOS, rejects `pending` with `WalletChooserNotShownError` when its Modal
 * has not been shown (`onShow`) within SHOW_TIMEOUT_MS of rendering, counted
 * while the app is in the foreground: iOS refuses to present a Modal over one
 * already presented, and says nothing. (Android stacks dialogs.) Returns the
 * Modal's `onShow`.
 */
function useShowWatchdog(pending: PendingWalletConfirmation | null): () => void {
  // Which request's Modal has been shown; onShow may even beat the effect.
  const shownFor = useRef<PendingWalletConfirmation | null>(null);
  const watch = useRef<{ pending: PendingWalletConfirmation; shown: () => void } | null>(null);
  useEffect(() => {
    if (!pending || Platform.OS !== 'ios' || shownFor.current === pending) return undefined;
    const watchdog = watchChooserShown(pending, {
      timeoutMs: SHOW_TIMEOUT_MS,
      inForeground: () => AppState.currentState === 'active',
    });
    const current = { pending, shown: watchdog.shown };
    watch.current = current;
    return () => {
      watchdog.cancel();
      if (watch.current === current) watch.current = null;
    };
  }, [pending]);
  return () => {
    shownFor.current = pending;
    if (watch.current?.pending === pending) watch.current.shown();
  };
}

/**
 * Rejects `pending` with `WalletChooserNotShownError` unless `shown` is called
 * within `timeoutMs`. It never fires while the app is in the background
 * (nothing is presented then); it waits another `timeoutMs` instead.
 * Exported for tests.
 */
export function watchChooserShown(
  pending: Pick<PendingWalletConfirmation, 'reject'>,
  options: { timeoutMs: number; inForeground: () => boolean },
): { shown: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const arm = () => {
    timer = setTimeout(() => {
      if (done) return;
      if (!options.inForeground()) {
        arm();
        return;
      }
      done = true;
      pending.reject(new WalletChooserNotShownError());
    }, options.timeoutMs);
  };
  arm();
  const stop = () => {
    done = true;
    clearTimeout(timer);
  };
  return { shown: stop, cancel: stop };
}

const ChoiceRow = ({
  choice,
  colors,
  onUse,
}: {
  choice: WalletChoice;
  colors: Palette;
  onUse: () => void;
}): React.JSX.Element => {
  const others = alsoControlledBy(choice);
  const sol = formatSol(choice.lamports);
  return (
    <View style={[styles.row, { backgroundColor: colors.row }]}>
      {!choice.vaultIsSystemAccount && (
        // First, and on its own: no trusted key makes this one safe.
        <View style={[styles.warning, { backgroundColor: colors.warningBg }]}>
          <Text style={[styles.warningText, { color: colors.warningText }]}>
            {CHOOSER_TEXT.vaultHandedAway}
          </Text>
        </View>
      )}
      <View style={styles.heading}>
        <Text style={[styles.address, { color: colors.text }]}>{shortAddress(choice.vault)}</Text>
        {choice.version === 1 && (
          <View style={[styles.tag, { backgroundColor: colors.tagBg }]}>
            <Text style={[styles.tagText, { color: colors.text }]}>{CHOOSER_TEXT.legacy}</Text>
          </View>
        )}
      </View>
      {/* The whole address, so the user can check it against the one they know. */}
      <Text selectable style={[styles.fullAddress, { color: colors.muted }]}>
        {choice.vault}
      </Text>
      <Text style={[styles.small, { color: colors.text }]}>
        {choice.vaultIsSystemAccount ? `${sol} SOL` : `${sol} SOL, which your passkey cannot move`}
      </Text>
      {choice.signatureCount === 0 && (
        <Text style={[styles.small, { color: colors.muted }]}>{CHOOSER_TEXT.notUsedYet}</Text>
      )}
      {others.length > 0 && (
        <Text style={[styles.small, { color: colors.muted }]}>
          {`Also controlled by: ${others.join(' · ')}`}
        </Text>
      )}
      {choice.vaultIsSystemAccount && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${CHOOSER_TEXT.use} ${choice.vault}`}
          onPress={onUse}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{CHOOSER_TEXT.use}</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    maxHeight: '90%',
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  list: {
    flexGrow: 0,
  },
  // Margins rather than `gap`, which React Native before 0.71 ignores.
  row: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  warning: {
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  address: {
    fontSize: 16,
    fontWeight: '600',
  },
  fullAddress: {
    marginTop: 4,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  tag: {
    marginLeft: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 12,
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
  },
  small: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    marginTop: 6,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    marginTop: 0,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
