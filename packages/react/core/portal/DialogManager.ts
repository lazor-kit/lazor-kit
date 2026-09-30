/**
 * Dialog Manager - Web Portal Connection
 * Handles portal communication via iframe/popup dialogs for web
 */

import { EventEmitter } from 'eventemitter3';
import { API_ENDPOINTS } from '../../config';
import { CredentialManager } from './CredentialManager';
import { getDialogStyles } from './styles/DialogStyles';
import { ensureChoiceStyles, renderWalletChoices } from './WalletChoiceView';
import { Logger } from '../../utils/logger';
import type { WalletChoice } from '../wallet/confirmation';

/** A WebAuthn assertion as the portal sends it (base64 fields, like a sign reply). */
export interface PortalAssertion {
  readonly signature: string;
  readonly clientDataJsonBase64: string;
  readonly authenticatorDataBase64: string;
}

export interface DialogResult {
  readonly publicKey: string;
  readonly credentialId: string;
  readonly isCreated: boolean;
  readonly connectionType: 'create' | 'get';
  readonly timestamp: number;
  readonly accountName?: string;
  /**
   * What the portal did, when it says: `created` — registered the passkey
   * just now, so `publicKey` is its own; `asserted` — signed in with it, so
   * `publicKey` came from the portal's storage.
   */
  readonly kind?: 'created' | 'asserted';
  /** An assertion over the `challenge` the connect URL carried, when the portal made one. */
  readonly assertion?: PortalAssertion;
}

/**
 * The user closed the portal — the dialog's X, Escape, a click outside it, or
 * the popup window — before it answered, or the app disconnected while a
 * connect was still going. Nothing was signed, and nothing was saved.
 */
export class PortalCancelledError extends Error {
  constructor(message = 'The LazorKit portal was closed before it finished, so nothing was signed.') {
    super(message);
    this.name = 'PortalCancelledError';
  }
}

/**
 * Once the popup is gone, how long a reply it posted just before closing gets
 * to arrive before the pending action counts as cancelled.
 */
const POPUP_CLOSED_GRACE_MS = 500;

export interface SignResult {
  readonly signature: string;
  readonly clientDataJsonBase64: string;
  readonly authenticatorDataBase64: string;
  readonly signedPayload: string;
  /**
   * The credential (base64) the portal says it signed with, when it says. The
   * portal signs with the `credentialId` the sign URL names (as the only
   * `allowCredentials` entry) and names it back here.
   */
  readonly credentialId?: string;
}

export interface DialogManagerConfig {
  readonly portalUrl: string;
  readonly rpcUrl?: string;
  readonly paymasterUrl?: string;
}

export type DialogAction = 'connect' | 'sign' | string;

/**
 * Dialog Manager for Web Portal Connection
 * Provides abstraction over iframe/popup portal communication
 */
export class DialogManager extends EventEmitter {
  private config: DialogManagerConfig;
  private dialogRef: HTMLDialogElement | null = null;
  private iframeRef: HTMLIFrameElement | null = null;
  private popupWindow: Window | null = null;
  private popupCloseInterval: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;
  private isDestroyed = false;
  private credentialManager: CredentialManager;
  private logger = new Logger('DialogManager');
  private _currentAction: DialogAction | null = null;
  /** Rejects the portal action in flight with PortalCancelledError; null when none is. */
  private pendingCancel: (() => void) | null = null;
  /** Answers the open wallet chooser with `null`; null when none is open. */
  private pendingChoice: (() => void) | null = null;
  /** Settles when the dialog being closed is gone, so the next one does not reuse it mid-close. */
  private closing: Promise<void> | null = null;

  constructor(config: DialogManagerConfig) {
    super();
    this.config = config;
    this.credentialManager = new CredentialManager();
    this.logger.debug('Created dialog manager');
    this.setupMessageListener();
  }

  /**
   * Open portal connection dialog
   * @param options.challenge - base64url bytes for the portal to sign with the
   *   passkey (a portal that does not know the parameter ignores it)
   * @returns Promise that resolves with connection result
   */
  async openConnect(options: { challenge?: string } = {}): Promise<DialogResult> {
    let connectUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.CONNECT}`;
    if (options.challenge) {
      connectUrl += `&challenge=${encodeURIComponent(options.challenge)}`;
    }
    return this.awaitPortal<DialogResult>('connect-result', 'Connection timed out after 60 seconds', () => {
      this._currentAction = API_ENDPOINTS.CONNECT;
      return this.shouldUsePopup('connect') ? this.openPopup(connectUrl) : this.openModal(connectUrl);
    });
  }

  /**
   * Open portal signing dialog
   * @param message - Message to sign
   * @returns Promise that resolves with signature result
   */
  async openSign(message: string, transaction: string, credentialId: string, clusterSimulation?: 'devnet' | 'mainnet'): Promise<SignResult> {
    const encodedMessage = encodeURIComponent(message);
    let signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}&transaction=${encodeURIComponent(transaction)}&credentialId=${encodeURIComponent(credentialId)}`;
    if (clusterSimulation) {
      signUrl += `&clusterSimulation=${clusterSimulation}`;
    }
    return this.awaitPortal<SignResult>('sign-result', 'Signing timed out after 60 seconds', () => {
      this._currentAction = API_ENDPOINTS.SIGN;
      return this.shouldUsePopup('sign') ? this.openPopup(signUrl) : this.openSignDialog(signUrl);
    });
  }

  /**
   * Open portal message signing dialog
   * @param message - Message to sign
   * @param credentialId - Credential ID
   * @returns Promise that resolves with signature result
   */
  async openSignMessage(message: string, credentialId: string): Promise<SignResult> {
    const encodedMessage = encodeURIComponent(message);
    const signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}&credentialId=${encodeURIComponent(credentialId)}`;
    return this.awaitPortal<SignResult>('sign-result', 'Signing timed out after 60 seconds', () => {
      this._currentAction = API_ENDPOINTS.SIGN;
      return this.shouldUsePopup('sign') ? this.openPopup(signUrl) : this.openSignDialog(signUrl);
    });
  }

  /**
   * Wait for the portal's answer to the action `open` starts: its result, its
   * error, the user closing it (PortalCancelledError, at once), or 60 s.
   */
  private awaitPortal<T>(resultEvent: 'connect-result' | 'sign-result', timeoutMessage: string, open: () => Promise<void>): Promise<T> {
    // Destroyed (a disconnect mid-connect): open nothing more.
    if (this.isDestroyed) return Promise.reject(new PortalCancelledError());
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        finish();
        reject(new Error(timeoutMessage));
      }, 60000);
      const finish = () => {
        clearTimeout(timeoutId);
        this.off(resultEvent, onResult);
        this.off('error', onError);
        if (this.pendingCancel === onCancel) this.pendingCancel = null;
      };
      const onResult = (data: T) => {
        finish();
        resolve(data);
      };
      const onError = (error: Error) => {
        finish();
        reject(error);
      };
      const onCancel = () => {
        finish();
        reject(new PortalCancelledError());
      };

      this.on(resultEvent, onResult);
      this.on('error', onError);
      this.pendingCancel = onCancel;

      open().catch(onError);
    });
  }

  /**
   * Show the SDK's wallet chooser ("Which wallet is yours?") in the portal
   * dialog's shell — drawn here, not in the portal's iframe. Resolves with the
   * wallet the user picked, or `null` for "None of these", the X, Escape, a
   * click outside, or `destroy()`. Nothing is pre-selected.
   */
  async openWalletChoice(choices: WalletChoice[]): Promise<{ wallet: string } | null> {
    if (this.isDestroyed) return null;
    if (this.dialogRef && !this.isClosing) this.closeDialog();
    if (this.closing) await this.closing;
    if (this.isDestroyed) return null;
    ensureChoiceStyles();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (wallet: string | null) => {
        if (settled) return;
        settled = true;
        this.pendingChoice = null;
        this.closeDialog();
        resolve(wallet === null ? null : { wallet });
      };
      this.pendingChoice = () => settle(null);
      const { body, footer, title } = renderWalletChoices(choices, settle);
      const { dialog, panel } = this.createShell({ onDismiss: () => settle(null), themed: false });
      dialog.setAttribute('data-content', 'choice');
      dialog.setAttribute('aria-labelledby', title.id);
      dialog.setAttribute('aria-describedby', 'lazorkit-choice-intro');
      // Sized to its rows rather than to the portal's frame; the rows scroll.
      Object.assign(panel.style, { height: 'auto', maxHeight: this.isMobileDevice() ? '85vh' : '90vh' });
      panel.append(body, footer);
      this.showDialog();
      // Focus the title, not a row's button: pressing Enter must not choose a wallet.
      title.focus();
    });
  }

  private ensureFonts() {
    const id = 'lazorkit-font-roboto-flex';
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&display=swap';
    document.head.appendChild(link);
  }

  private ensureDialogBackdropCSS() {
    const id = 'lazorkit-dialog-backdrop-style';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
    /* ===== Backdrop (overlay nhẹ) ===== */
    dialog#lazorkit-dialog::backdrop {
      background: rgba(0,0,0,0);
      animation: lazor-backdrop-in 160ms ease-out forwards;
    }

    dialog#lazorkit-dialog[data-state="closing"]::backdrop {
      animation: lazor-backdrop-out 140ms ease-in forwards;
    }

    @keyframes lazor-backdrop-in {
      from { background: rgba(0,0,0,0); }
      to   { background: rgba(0,0,0,0.12); } /* ✅ overlay nhẹ */
    }

    @keyframes lazor-backdrop-out {
      from { background: rgba(0,0,0,0.12); }
      to   { background: rgba(0,0,0,0); }
    }

    /* ===== Panel animations ===== */
    @keyframes lazor-drawer-in {
      from { transform: translateY(16px); opacity: 0.98; }
      to   { transform: translateY(0); opacity: 1; }
    }

    @keyframes lazor-drawer-out {
      from { transform: translateY(0); opacity: 1; }
      to   { transform: translateY(16px); opacity: 0.98; }
    }

    @keyframes lazor-float-in {
      from { transform: scale(0.985) translateY(4px); opacity: 0; }
      to   { transform: scale(1) translateY(0); opacity: 1; }
    }

    @keyframes lazor-float-out {
      from { transform: scale(1) translateY(0); opacity: 1; }
      to   { transform: scale(0.985) translateY(4px); opacity: 0; }
    }

    #lazorkit-panel {
      will-change: transform, opacity;
      transform-origin: center;
    }

    dialog#lazorkit-dialog[data-variant="drawer"][data-state="opening"] #lazorkit-panel {
      animation: lazor-drawer-in 180ms cubic-bezier(.2,.9,.2,1) forwards;
    }

    dialog#lazorkit-dialog[data-variant="drawer"][data-state="closing"] #lazorkit-panel {
      animation: lazor-drawer-out 150ms ease-in forwards;
    }

    dialog#lazorkit-dialog[data-variant="floating"][data-state="opening"] #lazorkit-panel {
      animation: lazor-float-in 170ms cubic-bezier(.2,.9,.2,1) forwards;
    }

    dialog#lazorkit-dialog[data-variant="floating"][data-state="closing"] #lazorkit-panel {
      animation: lazor-float-out 140ms ease-in forwards;
    }

    /* ===== Reduced motion ===== */
    @media (prefers-reduced-motion: reduce) {
      dialog#lazorkit-dialog::backdrop {
        animation: none !important;
        background: rgba(0,0,0,0.12) !important;
      }
      dialog#lazorkit-dialog[data-state="closing"]::backdrop {
        background: rgba(0,0,0,0) !important;
      }
      dialog#lazorkit-dialog #lazorkit-panel {
        animation: none !important;
      }
    }
  `;
    document.head.appendChild(style);
  }

  private createCloseButton(
    onClose: () => void,
    colors = { idle: 'rgba(255, 255, 255, 0.6)', hover: '#ffffff', hoverBackground: 'rgba(255,255,255,0.1)' },
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';

    // <ButtonArea title="Close Dialog" ... />
    btn.title = 'Close Dialog';
    btn.setAttribute('aria-label', 'Close Dialog');

    // ButtonArea feel
    Object.assign(btn.style, {
      width: '36px',
      height: '36px',
      borderRadius: '10px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      color: colors.idle,
      outline: 'none', // Force remove browser default focus ring
      webkitTapHighlightColor: 'transparent',
    });

    // hover/focus (ButtonArea UX) - Modified: Removed blue outline, kept hover bg
    btn.addEventListener('mouseenter', () => {
      btn.style.background = colors.hoverBackground;
      btn.style.color = colors.hover;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = colors.idle;
    });
    // Removed focus outline event listeners as requested

    btn.onclick = onClose;

    // <LucideX />
    btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg"
      width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  `;

    return btn;
  }


  /**
   * Open signing dialog (always iframe to avoid popup blocking)
   */
  private async openSignDialog(url: string): Promise<void> {
    await this.openModal(url);

    // Setup credential sync for iframe
    if (this.iframeRef) {
      this.credentialManager.setIframeRef(this.iframeRef);

      // Sync credentials after iframe loads
      setTimeout(() => {
        this.credentialManager.syncCredentials(true);
      }, 500);
    }
  }

  /**
   * Check if the current device is a mobile device
   */
  private isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Check if the browser is Safari
   */
  private isSafari(): boolean {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  /**
   * Determine if popup should be used instead of modal
   */
  private shouldUsePopup(action?: DialogAction): boolean {
    const isMobile = this.isMobileDevice();
    const isSafari = this.isSafari();

    // On Safari, always use popup for connect (iframe has WebAuthn issues)
    if (isSafari && action === 'connect') {
      return true;
    }

    // On mobile devices, use popup for connect
    if (isMobile && action === 'connect') {
      return true;
    }

    // Default to iframe/dialog
    return false;
  }

  /**
   * Get popup window dimensions
   */
  private getPopupDimensions() {
    if (!window.top) {
      return {
        width: 450,
        height: 600,
        top: 0,
        left: 0
      };
    }
    const width = 450;
    const height = 600;
    const left = window.top!.outerWidth / 2 + window.top!.screenX - width / 2;
    const top = window.top!.outerHeight / 2 + window.top!.screenY - height / 2;

    return {
      width,
      height,
      top,
      left
    };
  }

  /**
   * Open popup window
   */
  private async openPopup(url: string): Promise<void> {
    // Close any existing popup
    if (this.popupWindow && !this.popupWindow.closed) {
      try {
        this.popupWindow.close();
      } catch (e) {
        // Ignore errors
      }
    }

    // Get popup dimensions
    const dimensions = this.getPopupDimensions();

    // Open popup window
    this.popupWindow = window.open(
      url,
      'lazorkit-popup',
      `width=${dimensions.width},height=${dimensions.height},top=${dimensions.top},left=${dimensions.left},resizable,scrollbars,status`
    );

    // Start monitoring popup
    this.startPopupMonitor();

    if (!this.popupWindow) {
      this.logger.error('Popup was blocked by browser');
      throw new Error('Popup was blocked by browser');
    }
  }

  /**
   * Start monitoring for popup window close
   */
  private startPopupMonitor(): void {
    if (this.popupCloseInterval) {
      clearInterval(this.popupCloseInterval);
    }

    this.popupCloseInterval = setInterval(() => {
      if (this.popupWindow?.closed) {
        // Clear popup references but don't close dialog
        this.popupWindow = null;
        if (this.popupCloseInterval) {
          clearInterval(this.popupCloseInterval);
          this.popupCloseInterval = null;
        }
        // Closed without answering: give up on the action it was opened for
        // now rather than at the timeout. Only that action — one started
        // after it (a sign right after a connect) is not the popup's.
        const cancel = this.pendingCancel;
        if (cancel) {
          setTimeout(() => {
            if (this.pendingCancel === cancel) cancel();
          }, POPUP_CLOSED_GRACE_MS);
        }
      }
    }, 500);
  }

  /**
   * Open modal dialog with iframe
   */
  private async openModal(url: string): Promise<void> {
    if (this.closing) await this.closing;
    // Destroyed while the last dialog was closing: its action has already
    // been cancelled, and a portal shown now would answer no one.
    if (this.isDestroyed) return;

    // Create dialog if it doesn't exist
    if (!this.dialogRef) {
      this.createModal();
    }

    // Set iframe source
    if (this.iframeRef) {
      this.iframeRef.src = url;
    }

    this.showDialog();
  }

  /** Show the dialog, with its opening animation. */
  private showDialog(): void {
    if (this.dialogRef && !this.dialogRef.open) {
      // trigger opening animation
      this.dialogRef.setAttribute('data-state', 'opening');

      this.dialogRef.showModal();

      // reset state after animation
      window.setTimeout(() => {
        if (this.dialogRef?.open) this.dialogRef.setAttribute('data-state', 'idle');
      }, 220);
    }
  }

  /**
   * Create modal dialog with iframe
   */
  private createModal(): void {
    const { panel } = this.createShell({
      // X, Escape or a click outside: the user walked away from the portal.
      onDismiss: () => {
        this.closeDialog();
        this.emit('close');
        this.pendingCancel?.();
      },
      themed: true,
    });

    const isMobile = this.isMobileDevice();
    const styles = getDialogStyles(isMobile);
    const iframeContainer = document.createElement('div');
    Object.assign(iframeContainer.style, styles.iframeContainer);
    Object.assign(iframeContainer.style, { flex: '1 1 auto' });
    Object.assign(iframeContainer.style, {
      background: 'var(--background-color-th_base, #191919)',
    });

    // iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'lazorkit-iframe';
    Object.assign(iframe.style, styles.iframe);

    iframe.allow = `publickey-credentials-get ${this.config.portalUrl}; publickey-credentials-create ${this.config.portalUrl}; clipboard-write; camera; microphone`;

    const sandbox = iframe.sandbox;
    sandbox.add('allow-forms');
    sandbox.add('allow-scripts');
    sandbox.add('allow-same-origin');
    sandbox.add('allow-popups');
    sandbox.add('allow-popups-to-escape-sandbox');
    sandbox.add('allow-modals');

    iframe.setAttribute('aria-label', 'Lazor Wallet');
    iframe.tabIndex = 0;
    iframe.title = 'Lazor';

    iframeContainer.appendChild(iframe);
    panel.appendChild(iframeContainer);

    this.iframeRef = iframe;
  }

  /**
   * The dialog every LazorKit surface is drawn in: overlay, panel and a header
   * with a close button. `onDismiss` runs for the close button, Escape and a
   * click outside the panel. `themed` keeps the portal's dark frame; without
   * it the palette comes from the content's stylesheet (light or dark).
   */
  private createShell(options: { onDismiss: () => void; themed: boolean }): {
    dialog: HTMLDialogElement;
    panel: HTMLDivElement;
  } {
    this.ensureFonts();
    this.ensureDialogBackdropCSS();

    const dialog = document.createElement('dialog');

    dialog.id = 'lazorkit-dialog';
    if (options.themed) {
      dialog.style.colorScheme = 'dark';
      dialog.setAttribute('data-theme', 'dark');
    }
    const isMobile = this.isMobileDevice();
    const styles = getDialogStyles(isMobile);

    // 1) overlay style cho <dialog>
    Object.assign(dialog.style, styles.overlay);
    if (options.themed) {
      Object.assign(dialog.style, {
        // Porto dark
        '--background-color-th_base': '#191919',
        '--background-color-th_frame': '#191919',
        '--text-color-th_base': '#eeeeee',
        '--border-color-th_frame': 'rgba(255,255,255,0.10)',
      } as any);
    }
    // 2) panel wrapper
    const panel = document.createElement('div');
    const variant = isMobile ? 'drawer' : 'floating';
    dialog.setAttribute('data-variant', variant);
    dialog.setAttribute('data-state', 'idle');
    panel.id = 'lazorkit-panel';
    Object.assign(panel.style, styles.panel);
    Object.assign(panel.style, {
      display: 'flex',
      flexDirection: 'column',
    });
    Object.assign(panel.style, {
      background: 'var(--background-color-th_base, #191919)',
      color: 'var(--text-color-th_base, #eeeeee)',
      fontFamily: '"Roboto Flex", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      height: '32px',
      flex: '0 0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: '0 12px',
      boxSizing: 'border-box',
      background: 'var(--background-color-th_frame, #191919)',
      color: 'var(--text-color-th_base, #eeeeee)',
      borderBottom: '1px solid var(--border-color-th_frame, rgba(255,255,255,0.10))',
    });

    // close button
    const closeButton = this.createCloseButton(
      options.onDismiss,
      options.themed
        ? undefined
        : { idle: 'var(--lk-muted)', hover: 'var(--lk-fg)', hoverBackground: 'var(--lk-hover)' },
    );
    Object.assign(closeButton.style, {
      position: 'static',
      top: '',
      right: '',
    });
    closeButton.id = 'lazorkit-dialog-close';
    closeButton.ariaLabel = 'Close';
    Object.assign(closeButton.style, styles.closeButton);

    dialog.addEventListener('cancel', (e) => {
      // Escape: close with our animation, and say so.
      e.preventDefault();
      options.onDismiss();
    });
    // Outside the panel only when the press began outside too: a text
    // selection dragged out of the panel (the full vault address, say) ends
    // in a click on the dialog itself, and must not dismiss it.
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && pressedOutside) options.onDismiss();
      pressedOutside = false;
    });

    header.appendChild(closeButton);
    panel.appendChild(header);
    dialog.appendChild(panel);

    document.body.appendChild(dialog);

    this.dialogRef = dialog;
    return { dialog, panel };
  }

  /**
   * Setup message listener for portal communication
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      // Only the portal, and only the dialog this manager opened. A substring
      // match on the hostname let `portal.lazor.sh.attacker.example` speak for
      // the portal — and connect now trusts the key the portal reports.
      if (event.origin !== new URL(this.config.portalUrl).origin) {
        return;
      }
      const fromOurDialog =
        (this.iframeRef !== null && event.source === this.iframeRef.contentWindow) ||
        (this.popupWindow !== null && event.source === this.popupWindow);
      if (!fromOurDialog) {
        return;
      }

      const { type, data, error } = event.data;

      if (error) {
        this.emit('error', new Error(portalErrorText(event.data)));
        return;
      }

      switch (type) {
        case 'connect-result':
        case 'WALLET_CONNECTED':
          // Transform portal data to match DialogResult interface
          const transformedData: DialogResult = {
            publicKey: data.publickey || data.publicKey || '',
            credentialId: data.credentialId,
            isCreated: data.connectionType === 'create' || !!data.publickey,
            connectionType: data.connectionType || (data.publickey ? 'create' : 'get'),
            timestamp: data.timestamp || Date.now(),
            accountName: data.accountName,
            kind: data.kind === 'created' || data.kind === 'asserted' ? data.kind : undefined,
            // Same field names as a sign reply.
            assertion:
              data.normalized && data.authenticatorDataReturn && data.clientDataJSONReturn
                ? {
                  signature: data.normalized,
                  authenticatorDataBase64: data.authenticatorDataReturn,
                  clientDataJsonBase64: data.clientDataJSONReturn,
                }
                : undefined,
          };

          this.emit('connect-result', transformedData);
          this.closeDialog();
          break;
        case 'sign-result':
        case 'SIGNATURE_CREATED':
          const transformedDataSignResult: SignResult = {
            signature: data.normalized,
            clientDataJsonBase64: data.clientDataJSONReturn,
            authenticatorDataBase64: data.authenticatorDataReturn,
            signedPayload: data.msg,
            credentialId: typeof data.credentialId === 'string' && data.credentialId ? data.credentialId : undefined,
          };
          this.emit('sign-result', transformedDataSignResult);
          this.closeDialog();
          break;
        case 'error':
          this.emit('error', new Error(portalErrorText(event.data)));
          break;
        case 'close':
          // The portal closed itself without an answer.
          this.closeDialog();
          this.pendingCancel?.();
          break;
      }
    });
  }

  /**
   * Close any open dialogs or popups
   */
  closeDialog(): void {
    if (this.isClosing) return;
    this.isClosing = true;

    const dialog = this.dialogRef;
    const iframe = this.iframeRef;
    let closed!: () => void;
    this.closing = new Promise<void>((resolve) => (closed = resolve));
    const done = () => {
      this.isClosing = false;
      this.closing = null;
      closed();
    };

    try {
      if (dialog) {
        dialog.setAttribute('data-state', 'closing');
      }

      window.setTimeout(() => {
        try {
          if (iframe) {
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
            this.iframeRef = null;
          }

          if (dialog) {
            try {
              if (dialog.open) dialog.close();
            } catch { }

            if (dialog.parentNode) {
              dialog.parentNode.removeChild(dialog);
            }
            this.dialogRef = null;
          }

          if (this.popupWindow) {
            try {
              this.popupWindow.close();
            } catch { }
            this.popupWindow = null;
          }

          if (this.popupCloseInterval) {
            clearInterval(this.popupCloseInterval);
            this.popupCloseInterval = null;
          }

          this.logger.debug('Closed dialog (animated)');
        } catch (error) {
          this.logger.error('Error during animated close:', error);
        } finally {
          done();
        }
      }, 170); // ⏱ match lazor-drawer-out / lazor-float-out
    } catch (error) {
      this.logger.error('Error closing dialog:', error);
      done();
    }
  }

  /**
   * Get the iframe reference
   */
  getIframeRef(): HTMLIFrameElement | null {
    return this.iframeRef;
  }

  /**
   * Get the dialog reference
   */
  getDialogRef(): HTMLDialogElement | null {
    return this.dialogRef;
  }

  /**
   * Get the popup window reference
   */
  getPopupWindow(): Window | null {
    return this.popupWindow;
  }

  /**
   * Get the current action
   */
  getCurrentAction(): DialogAction | null {
    return this._currentAction;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    // Whatever still waits on the dialog ends now — a portal action with
    // PortalCancelledError, the chooser with null — rather than at the 60 s
    // timeout, or never.
    this.pendingCancel?.();
    this.pendingChoice?.();
    this.closeDialog();
    this.credentialManager.destroy();
    this.removeAllListeners();
    this.logger.debug('Destroyed dialog manager');
  }
}

/**
 * The portal's own words for what went wrong. It has sent them as
 * `{ error: 'text', details }`, `{ error: { message } }` and
 * `{ type: 'error', data: { message } }`.
 */
function portalErrorText(message: { error?: unknown; details?: unknown; data?: { message?: unknown } }): string {
  const { error, details, data } = message;
  const text =
    typeof error === 'string'
      ? error
      : typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : typeof data?.message === 'string'
          ? data.message
          : '';
  const extra = typeof details === 'string' && details && details !== text ? details : '';
  if (text && extra) return `${text}: ${extra}`;
  return text || extra || 'The LazorKit portal reported an error without a message';
}
