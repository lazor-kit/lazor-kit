/**
 * `<ConnectButton>`: "Continue with passkey" while disconnected (Embedded's
 * flow, or the portal's connect in portal mode); the short vault address with
 * a menu (Copy address, Sign out) once connected. Its label follows the
 * running step. Themed with the same CSS custom properties as the sheets
 * (`--lk-accent`, `--lk-bg`, `--lk-fg`, `--lk-radius`, `--lk-font`), and
 * `className` / `style`. Stable hooks for tests: `data-lk="connect"`,
 * `"menu"`, `"copy"`, `"sign-out"`, `"error"`, `"autofill"`.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import type { WalletInfo } from '../core/storage';
import type { Step, WalletStatus } from '../core/embedded/types';
import { isUserRejection, userMessage } from '../core/errors';
import { deriveStatus, getLazorkitClient } from '../core/client/createClient';
import { shortAddress } from '../core/portal/WalletChoiceView';
import { useWalletStore } from './store';

export interface ConnectButtonProps {
  /** The label while disconnected. Default "Continue with passkey". */
  label?: string;
  /**
   * Embedded: also offer passkey autofill, in an
   * `autocomplete="username webauthn"` field under the button. Default off.
   */
  autofill?: boolean;
  className?: string;
  style?: CSSProperties;
  onConnect?: (wallet: WalletInfo) => void;
  /** A failure (never a user rejection: "Not now" or a closed sheet is no error). */
  onError?: (error: Error) => void;
}

export const CONNECT_BUTTON_TEXT = {
  connect: 'Continue with passkey',
  connecting: 'Connecting…',
  signing: 'Signing…',
  copy: 'Copy address',
  copied: 'Copied',
  signOut: 'Sign out',
  autofill: 'Or pick a passkey',
  steps: {
    'checking-passkey': 'Checking for a passkey…',
    'no-passkey': 'Continue with passkey',
    'creating-passkey': 'Creating passkey…',
    'other-device': 'Waiting for your other device…',
    'finding-wallet': 'Finding your wallet…',
    'choose-wallet': 'Choose your wallet…',
    'one-more-check': 'Confirm once more…',
    'creating-wallet': 'Creating your wallet…',
    reviewing: 'Review the transaction…',
    preparing: 'Preparing…',
    'awaiting-passkey': 'Confirm with your passkey',
    submitted: 'Confirming…',
  } satisfies Record<Step, string>,
} as const;

/** The button's label for a status and step. */
export function connectButtonLabel(status: WalletStatus, step: Step | null, address: string | null, label?: string): string {
  if (step) return step === 'no-passkey' && label ? label : CONNECT_BUTTON_TEXT.steps[step];
  if (status === 'connecting') return CONNECT_BUTTON_TEXT.connecting;
  if (status === 'signing') return CONNECT_BUTTON_TEXT.signing;
  if (status === 'connected' && address) return `${shortAddress(address)} ▾`;
  return label ?? CONNECT_BUTTON_TEXT.connect;
}

const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontFamily: 'var(--lk-font, inherit)',
  fontWeight: 600,
  padding: '10px 16px',
  borderRadius: 'var(--lk-radius, 12px)',
  border: 'none',
  background: 'var(--lk-accent, #2f6fed)',
  color: 'var(--lk-on-accent, #ffffff)',
  cursor: 'pointer',
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  minWidth: '100%',
  padding: 4,
  borderRadius: 'var(--lk-radius, 12px)',
  background: 'var(--lk-bg, #ffffff)',
  color: 'var(--lk-fg, #1d1d1f)',
  boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
};

const itemStyle: CSSProperties = {
  font: 'inherit',
  textAlign: 'left',
  padding: '8px 12px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function ConnectButton(props: ConnectButtonProps): ReactElement {
  const wallet = useWalletStore((state) => state.wallet);
  const isConnecting = useWalletStore((state) => state.isConnecting);
  const isSigning = useWalletStore((state) => state.isSigning);
  const step = useWalletStore((state) => state.step);
  const storeError = useWalletStore((state) => state.error);
  const availability = useWalletStore((state) => state.availability);
  const mode = useWalletStore((state) => state.config.mode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const status = deriveStatus({ wallet, isConnecting, isSigning });
  const address = wallet?.vaultPda ?? null;
  const embedded = mode === 'embedded';

  // Passkey autofill while disconnected, and nothing else is running.
  useEffect(() => {
    if (!props.autofill || !embedded || status !== 'disconnected') return;
    const handle = getLazorkitClient().startAutofill();
    return () => handle?.stop();
  }, [props.autofill, embedded, status]);

  useEffect(() => {
    if (!wallet) setMenuOpen(false);
  }, [wallet]);

  const connect = () => {
    setFailure(null);
    useWalletStore
      .getState()
      .connect()
      .then(
        (connected) => props.onConnect?.(connected),
        (error: Error) => {
          if (isUserRejection(error)) return;
          setFailure(error);
          props.onError?.(error);
        },
      );
  };

  const copy = () => {
    if (!address || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard refused: the address stays in the app's own UI.
      },
    );
  };

  const signOut = () => {
    setMenuOpen(false);
    void useWalletStore.getState().disconnect().catch(() => {});
  };

  const label = connectButtonLabel(status, step, address, props.label);

  if (!wallet) {
    const shown = failure ?? storeError;
    const message =
      availability === 'unavailable'
        ? "Passkeys don't work in this browser view. Open this page in Safari or Chrome."
        : shown
          ? userMessage(shown, 'connect')
          : null;
    return (
      <span className={props.className} style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          data-lk="connect"
          style={{ ...buttonStyle, ...props.style }}
          disabled={status === 'connecting' || availability === 'unavailable'}
          aria-busy={status === 'connecting'}
          onClick={connect}
        >
          {label}
        </button>
        {props.autofill && embedded && (
          <input
            type="text"
            name="username"
            autoComplete="username webauthn"
            placeholder={CONNECT_BUTTON_TEXT.autofill}
            aria-label={CONNECT_BUTTON_TEXT.autofill}
            data-lk="autofill"
            style={{ font: 'inherit', padding: '8px 10px', borderRadius: 'var(--lk-radius, 12px)', border: '1px solid rgba(127,127,127,0.4)' }}
          />
        )}
        {message && (
          <span role="alert" data-lk="error" style={{ fontSize: '0.875em', color: 'var(--lk-error, #b42318)' }}>
            {message}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={props.className} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-lk="menu"
        style={{ ...buttonStyle, ...props.style }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-busy={status === 'signing'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {label}
      </button>
      {menuOpen && (
        <span role="menu" style={menuStyle}>
          <button type="button" role="menuitem" data-lk="copy" style={itemStyle} onClick={copy}>
            {copied ? CONNECT_BUTTON_TEXT.copied : CONNECT_BUTTON_TEXT.copy}
          </button>
          <button type="button" role="menuitem" data-lk="sign-out" style={itemStyle} onClick={signOut}>
            {CONNECT_BUTTON_TEXT.signOut}
          </button>
        </span>
      )}
    </span>
  );
}
