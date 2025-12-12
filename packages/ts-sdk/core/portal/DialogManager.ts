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

      if (shouldUsePopup) {
        const encodedMessage = encodeURIComponent(message);
        const signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}&transaction=${encodeURIComponent(transaction)}&credentialId=${encodeURIComponent(credentialId)}`;
        this.openPopup(signUrl).catch(reject);
      } else {
        const encodedMessage = encodeURIComponent(message);
        const signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}&transaction=${encodeURIComponent(transaction)}&credentialId=${encodeURIComponent(credentialId)}`;
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

    // Show modal
    if (this.dialogRef && !this.dialogRef.open) {
      this.dialogRef.showModal();
    }
  }

  /**
   * Create modal dialog with iframe
   */
  private createModal(): void {
    this.logger.debug(`Creating ${this.isMobileDevice() ? 'mobile' : 'desktop'} dialog`);

    // Remove any existing dialog
    if (this.dialogRef && this.dialogRef.parentNode) {
      this.dialogRef.parentNode.removeChild(this.dialogRef);
    }

    // Create dialog element
    const dialog = document.createElement('dialog');
    dialog.id = 'lazorkit-dialog';

    // Apply styles from the dialog style utility
    const styles = getDialogStyles(this.isMobileDevice());

    // Apply container styles
    Object.assign(dialog.style, styles.container);

    // Create iframe container
    const iframeContainer = document.createElement('div');
    Object.assign(iframeContainer.style, styles.iframeContainer);

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.id = 'lazorkit-dialog-close';
    closeButton.ariaLabel = 'Close';
    Object.assign(closeButton.style, styles.closeButton);

    // Add close button SVG
    closeButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/>
      </svg>
    `;

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'lazorkit-iframe';
    Object.assign(iframe.style, styles.iframe);

    // Critical: Ensure proper permissions for WebAuthn
    iframe.allow = `publickey-credentials-get ${this.config.portalUrl}; publickey-credentials-create ${this.config.portalUrl}; clipboard-write; camera; microphone`;
    iframe.setAttribute('aria-label', 'Lazor Wallet');
    iframe.setAttribute('role', 'dialog');
    iframe.tabIndex = 0;
    iframe.title = 'Lazor';

    // Critical: Ensure all necessary sandbox permissions
    const sandbox = iframe.sandbox;
    sandbox.add('allow-forms');
    sandbox.add('allow-scripts');
    sandbox.add('allow-same-origin');
    sandbox.add('allow-popups');
    sandbox.add('allow-popups-to-escape-sandbox');
    sandbox.add('allow-modals');

    // Add close on escape
    dialog.addEventListener('cancel', () => {
      this.closeDialog();
    });

    // Add iframe to container
    iframeContainer.appendChild(iframe);

    // Add elements to dialog
    dialog.appendChild(closeButton);
    dialog.appendChild(iframeContainer);

    // Add event listener for close button
    closeButton.onclick = () => {
      this.closeDialog();
      this.emit('close');
    };

    // Add dialog to document
    document.body.appendChild(dialog);

    // Store references
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
            timestamp: data.timestamp || Date.now()
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
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;

    try {
      // Clean up iframe first
      if (this.iframeRef) {
        console.log('🔍 Removing iframe from DOM');
        if (this.iframeRef.parentNode) {
          this.iframeRef.parentNode.removeChild(this.iframeRef);
        }
        this.iframeRef = null;
      }

      // Force close any open dialog
      if (this.dialogRef) {
        // First try to close it normally
        try {
          this.dialogRef.close();
        } catch { }
        // Then force remove from DOM
        if (this.dialogRef.parentNode) {
          this.dialogRef.parentNode.removeChild(this.dialogRef);
        }
        this.dialogRef = null;
      }

      // Clean up popup if any
      if (this.popupWindow) {
        try { this.popupWindow.close(); } catch { }
        this.popupWindow = null;
      }

      if (this.popupCloseInterval) {
        clearInterval(this.popupCloseInterval);
        this.popupCloseInterval = null;
      }

      this.logger.debug('Closed dialog');
    } catch (error) {
      this.logger.error('Error closing dialog:', error);
    } finally {
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