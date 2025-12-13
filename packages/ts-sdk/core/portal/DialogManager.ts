/**
 * Dialog Manager - Web Portal Connection
 * Handles portal communication via iframe/popup dialogs for web
 */

import { EventEmitter } from 'eventemitter3';
import { API_ENDPOINTS } from '../../config';
import { CredentialManager } from './CredentialManager';
import { getDialogStyles } from './styles/DialogStyles';
import { Logger } from '../../utils/logger';
export interface DialogResult {
  readonly publicKey: string;
  readonly credentialId: string;
  readonly isCreated: boolean;
  readonly connectionType: 'create' | 'get';
  readonly timestamp: number;
  readonly accountName?: string;
}

export interface SignResult {
  readonly signature: string;
  readonly clientDataJsonBase64: string;
  readonly authenticatorDataBase64: string;
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

  constructor(config: DialogManagerConfig) {
    super();
    this.config = config;
    this.credentialManager = new CredentialManager();
    this.logger.debug('Created dialog manager');
    this.setupMessageListener();
  }

  /**
   * Open portal connection dialog
   * @returns Promise that resolves with connection result
   */
  async openConnect(): Promise<DialogResult> {
    return new Promise<DialogResult>((resolve, reject) => {
      const cleanup = () => {
        this.off('connect-result', connectHandler);
        this.off('error', errorHandler);
      };

      const connectHandler = (data: DialogResult) => {
        cleanup();
        resolve(data);
      };

      const errorHandler = (error: Error) => {
        cleanup();
        reject(error);
      };

      // Register event listeners
      this.on('connect-result', connectHandler);
      this.on('error', errorHandler);

      // Set timeout for connection
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timed out after 30 seconds'));
      }, 30000);

      // Clear timeout when resolved/rejected
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };
      reject = (reason) => {
        clearTimeout(timeoutId);
        originalReject(reason);
      };

      // Store current action and open dialog
      this._currentAction = API_ENDPOINTS.CONNECT;
      const shouldUsePopup = this.shouldUsePopup('connect');

      if (shouldUsePopup) {
        const connectUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.CONNECT}`;
        this.openPopup(connectUrl).catch(reject);
      } else {
        this.openConnectDialog().catch(reject);
      }
    });
  }

  /**
   * Open portal signing dialog
   * @param message - Message to sign
   * @returns Promise that resolves with signature result
   */
  async openSign(message: string, transaction: string, credentialId: string): Promise<SignResult> {
    return new Promise<SignResult>((resolve, reject) => {
      const cleanup = () => {
        this.off('sign-result', signHandler);
        this.off('error', errorHandler);
      };

      const signHandler = (data: SignResult) => {
        cleanup();
        resolve(data);
      };

      const errorHandler = (error: Error) => {
        cleanup();
        reject(error);
      };

      // Register event listeners
      this.on('sign-result', signHandler);
      this.on('error', errorHandler);

      // Set timeout
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Signing timed out after 30 seconds'));
      }, 30000);

      // Clear timeout when resolved/rejected
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };
      reject = (reason) => {
        clearTimeout(timeoutId);
        originalReject(reason);
      };

      // Store current action and open dialog
      this._currentAction = API_ENDPOINTS.SIGN;
      const shouldUsePopup = this.shouldUsePopup('sign');

      const encodedMessage = encodeURIComponent(message);
      const signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}&transaction=${encodeURIComponent(transaction)}&credentialId=${encodeURIComponent(credentialId)}`;
      if (shouldUsePopup) {
        this.openPopup(signUrl).catch(reject);
      } else {
        this.openSignDialog(signUrl).catch(reject);
      }
    });
  }

  /**
   * Open connection dialog (modal only - popup handled separately)
   */
  private async openConnectDialog(): Promise<void> {
    const connectUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.CONNECT}`;
    await this.openModal(connectUrl);
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

  private createCloseButton(onClose: () => void): HTMLButtonElement {
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
      color: 'rgba(255, 255, 255, 0.6)',
      outline: 'none', // Force remove browser default focus ring
      webkitTapHighlightColor: 'transparent',
    });

    // hover/focus (ButtonArea UX) - Modified: Removed blue outline, kept hover bg
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.1)';
      btn.style.color = '#ffffff';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = 'rgba(255, 255, 255, 0.6)';
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

    // On Safari, always use popup for connect (dialog has issues)
    if (isSafari && action === 'connect') {
      return true;
    }

    // On mobile devices, use popup for connect
    if (isMobile && action === 'connect') {
      return true;
    }

    // On desktop, use dialog for sign
    if (!isMobile && action === 'sign') {
      return false;
    }

    // On mobile, use dialog for sign
    if (isMobile && action === 'sign') {
      return false;
    }

    // Default to popup
    return true;
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
      }
    }, 500);
  }

  /**
   * Open modal dialog with iframe
   */
  private async openModal(url: string): Promise<void> {
    // Create dialog if it doesn't exist
    if (!this.dialogRef) {
      this.createModal();
    }

    // Set iframe source
    if (this.iframeRef) {
      this.iframeRef.src = url;
    }

    // Show modal + opening animation
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
    this.ensureFonts();
    this.ensureDialogBackdropCSS();

    const dialog = document.createElement('dialog');

    dialog.id = 'lazorkit-dialog';
    dialog.style.colorScheme = 'dark';
    dialog.setAttribute('data-theme', 'dark');
    const isMobile = this.isMobileDevice();
    const styles = getDialogStyles(isMobile);

    // 1) overlay style cho <dialog>
    Object.assign(dialog.style, styles.overlay);
    Object.assign(dialog.style, {
      // Porto dark
      '--background-color-th_base': '#191919',
      '--background-color-th_frame': '#191919',
      '--text-color-th_base': '#eeeeee',
      '--border-color-th_frame': 'rgba(255,255,255,0.10)',
    } as any);
    // 2) panel wrapper (trắng)
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
      background: 'var(--background-color-th_base, #fcfcfc)',
      color: 'var(--text-color-th_base, #202020)',
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
      borderBottom: '1px solid rgba(0,0,0,0.08)',
    });
    Object.assign(header.style, {
      background: 'var(--background-color-th_frame, var(--background-color-th_base, #fcfcfc))',
      color: 'var(--text-color-th_base, #202020)',
      borderBottom: '1px solid var(--border-color-th_frame, rgba(0,0,0,0.08))',
    });
    const iframeContainer = document.createElement('div');
    Object.assign(iframeContainer.style, styles.iframeContainer);
    Object.assign(iframeContainer.style, { flex: '1 1 auto' });
    Object.assign(iframeContainer.style, {
      background: 'var(--background-color-th_base, #fcfcfc)',
    });
    Object.assign(panel.style, {
      background: 'var(--background-color-th_base, #191919)',
      color: 'var(--text-color-th_base, #eeeeee)',
    });

    Object.assign(header.style, {
      background: 'var(--background-color-th_frame, #191919)',
      color: 'var(--text-color-th_base, #eeeeee)',
      borderBottom: '1px solid var(--border-color-th_frame, rgba(255,255,255,0.10))',
    });

    Object.assign(iframeContainer.style, {
      background: 'var(--background-color-th_base, #191919)',
    });
    // close button
    const closeButton = this.createCloseButton(() => {
      this.closeDialog();
      this.emit('close');
    });
    Object.assign(closeButton.style, {
      position: 'static',
      top: '',
      right: '',
    });
    closeButton.id = 'lazorkit-dialog-close';
    closeButton.ariaLabel = 'Close';
    Object.assign(closeButton.style, styles.closeButton);

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

    dialog.addEventListener('cancel', () => this.closeDialog());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) this.closeDialog();
    });

    // Create header content
    header.appendChild(closeButton);

    panel.appendChild(header);
    iframeContainer.appendChild(iframe);
    panel.appendChild(iframeContainer);
    dialog.appendChild(panel);

    document.body.appendChild(dialog);

    this.dialogRef = dialog;
    this.iframeRef = iframe;
  }

  /**
   * Setup message listener for portal communication
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      // Verify origin for security
      if (!event.origin.includes(new URL(this.config.portalUrl).hostname)) {
        return;
      }

      const { type, data, error } = event.data;

      if (error) {
        this.emit('error', new Error(error.message || 'Portal error'));
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
            accountName: data.accountName
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
          };
          this.emit('sign-result', transformedDataSignResult);
          this.closeDialog();
          break;
        case 'error':
          this.emit('error', new Error(data?.message || 'Unknown portal error'));
          break;
        case 'close':
          this.closeDialog();
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
          this.isClosing = false;
        }
      }, 170); // ⏱ match lazor-drawer-out / lazor-float-out
    } catch (error) {
      this.logger.error('Error closing dialog:', error);
      this.isClosing = false;
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
    this.closeDialog();
    this.credentialManager.destroy();
    this.removeAllListeners();
    this.logger.debug('Destroyed dialog manager');
  }
}