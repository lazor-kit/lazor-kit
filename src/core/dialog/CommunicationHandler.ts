import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
type DialogMode = 'popup' | 'dialog' | 'auto';
type DialogAction = 'connect' | 'sign' | 'pay';

export interface CommunicationConfig {
  /**
   * URL of the dialog interface
   */
  url: string;

  /**
   * Dialog mode (popup, dialog, or auto)
   */
  mode?: DialogMode;

  /**
   * Whether to fallback to popup when dialog is not supported
   */
  fallbackToPopup?: boolean;

  /**
   * URL of the RPC endpoint
   */
  rpcUrl?: string;

  /**
   * URL of the paymaster service
   */
  paymasterUrl?: string;
}

interface CSSStyles {
  [key: string]: string | number;
}

interface DialogStyles {
  container: CSSStyles;
  closeButton: CSSStyles;
  iframeContainer: CSSStyles;
  iframe: CSSStyles;
}

const DIALOG_DIMENSIONS = {
  mobile: {
    width: '100%',
    maxWidth: '100%',
    height: '85vh',
    maxHeight: '85vh',
    padding: '0',
    borderRadius: '20px 20px 0 0'
  },
  desktop: {
    width: '420px',
    maxWidth: '90vw',
    height: '600px',
    maxHeight: '85vh',
    padding: '0',
    borderRadius: '20px'
  }
};

const getDialogStyles = (isMobile: boolean): DialogStyles => ({
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: isMobile ? 'flex-end' : 'center',
    justifyContent: 'center',
    background: 'white',
    border: 'none',
    margin: 'auto',
    width: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].width,
    maxWidth: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxWidth,
    height: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].height,
    maxHeight: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxHeight,
    borderRadius: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].borderRadius,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    overflow: 'hidden',
    willChange: 'transform, opacity',
    zIndex: 999999
  },

  closeButton: {
    zIndex: 1001,
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'rgba(0, 0, 0, 0.05)',
    border: 'none',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#666',
    willChange: 'transform, opacity'
  },
  iframeContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    border: 'none',
    padding: '0',
    margin: '0',
    overflow: 'hidden',
    borderRadius: 'inherit',
    background: 'white'
  },
  iframe: {
    border: 'none',
    height: '100%',
    width: '100%',
    borderRadius: 'inherit',
    display: 'block',
    pointerEvents: 'auto',
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: 0,
    padding: 0
  }
});

export class CommunicationHandler extends EventEmitter {
  private popupWindow: Window | null = null;
  private popupCloseInterval: number | null = null;
  private dialogRef: HTMLDialogElement | null = null;
  private iframeRef: HTMLIFrameElement | null = null;

  private logger = new Logger('CommunicationHandler');
  private config: CommunicationConfig;
  private action: 'connect' | 'sign' | 'pay' | null = null;
  private isDestroyed = false;

  constructor(config: CommunicationConfig) {
    super();
    this.config = {
      mode: 'auto',
      fallbackToPopup: true,
      ...config
    };
  }

  private isMobileDevice(): boolean {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  private isSafari(): boolean {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome');
  }

  private shouldUsePopup(action: DialogAction): boolean {
    const isMobile = this.isMobileDevice();
    const isSafari = this.isSafari();

    // Always use popup for connect on Safari or mobile
    if (action === 'connect' && (isSafari || isMobile)) {
      return true;
    }

    // Use iframe for signing on all platforms
    if (action === 'sign') {
      return false;
    }

    // Default to config mode
    if (this.config.mode === 'popup') {
      return true;
    }

    if (this.config.mode === 'dialog') {
      return false;
    }

    // For auto mode, use popup on mobile/Safari for connect
    return action === 'connect' && (isMobile || isSafari);
  }

  private getPopupDimensions() {
    const width = 420;
    const height = 600;
    const screenLeft = window.screenLeft || window.screenX;
    const screenTop = window.screenTop || window.screenY;
    
    // Center popup on screen
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;
    const left = Math.max(0, (screenWidth - width) / 2 + screenLeft);
    const top = Math.max(0, (screenHeight - height) / 2 + screenTop);
    return { width, height, left, top };
  }

  private createDialog(isMobile: boolean = false): HTMLDialogElement {
    // Add global styles for dialog
    const style = document.createElement('style');
    style.textContent = `
      @keyframes dialogShow {
        from { 
          opacity: 0; 
          transform: ${isMobile ? 'translateY(100%)' : 'scale(0.95) translateY(20px)'}; 
        }
        to { 
          opacity: 1; 
          transform: ${isMobile ? 'translateY(0)' : 'scale(1) translateY(0)'}; 
        }
      }
      @keyframes backdropShow {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .lazor-dialog {
        animation: dialogShow 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        transform-origin: center bottom;
      }
      .lazor-dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        animation: backdropShow 0.2s ease-out forwards;
      }
      .lazor-close-button {
        opacity: 0.7;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .lazor-close-button:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.1) !important;
        transform: scale(1.1) !important;
      }
      @media (max-width: 768px) {
        .lazor-dialog {
          margin: 0;
          border-radius: 20px 20px 0 0 !important;
          width: 100% !important;
          max-width: 100% !important;
        }
      }
    `;
    document.head.appendChild(style);
    const styles = getDialogStyles(isMobile);
    const dialog = document.createElement('dialog');
    dialog.className = 'lazor-dialog';
    Object.assign(dialog.style, styles.container);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'lazor-close-button';
    Object.assign(closeButton.style, styles.closeButton);
    closeButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    closeButton.onclick = () => this.closeDialog();

    dialog.appendChild(closeButton);
    return dialog;
  }

  async openDialog(action: DialogAction): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('CommunicationHandler is destroyed');
    }

    // Close any existing dialog
    if (this.dialogRef || this.iframeRef) {
      this.closeDialog();
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.action = action;

    // Check if we should use popup instead
    if (this.shouldUsePopup(action)) {
      const url = `${this.config.url}?action=${action}`;
      await this.openPopup(url);
      return;
    }

    try {
      const isMobile = this.isMobileDevice();
      
      // Create dialog first
      this.dialogRef = this.createDialog(isMobile);
      
      // Create iframe container
      const container = document.createElement('div');
      Object.assign(container.style, getDialogStyles(isMobile).iframeContainer);
      
      // Create iframe with all necessary attributes
      this.iframeRef = document.createElement('iframe');
      Object.assign(this.iframeRef.style, getDialogStyles(isMobile).iframe);
      this.iframeRef.allow = `publickey-credentials-get ${this.config.url}; publickey-credentials-create ${this.config.url}; clipboard-write`;
      this.iframeRef.setAttribute('aria-label', 'Lazor Wallet');
      this.iframeRef.setAttribute('role', 'dialog');
      this.iframeRef.tabIndex = 0;
      this.iframeRef.title = 'Lazor';
      this.iframeRef.sandbox.add('allow-forms', 'allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-modals');
      const url = new URL(this.config.url);
      url.searchParams.set('action', action);
      if (action === 'sign') {
        url.searchParams.set('message', 'hello');
      }
      this.iframeRef.src = url.toString();
      
      // Assemble the dialog
      container.appendChild(this.iframeRef);
      this.dialogRef.appendChild(container);
      document.body.appendChild(this.dialogRef);
      
      // Show dialog
      this.dialogRef.showModal();

      // Wait for iframe to load then sync credentials
      await new Promise(resolve => this.iframeRef!.addEventListener('load', resolve, { once: true }));
      this.syncCredentials(true);
    } catch (error) {
      this.closeDialog();
      throw error;
    }
  }

  private async openPopup(url: string): Promise<void> {
    if (this.popupWindow) {
      this.popupWindow.close();
    }

    const { width, height, left, top } = this.getPopupDimensions();
    const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

    this.popupWindow = window.open(url, 'LazorWallet', features);
    if (!this.popupWindow) {
      throw new Error('Failed to open popup window');
    }

    // Start monitoring popup closure
    this.startPopupMonitor();

    return new Promise<void>((resolve) => {
      const checkPopup = setInterval(() => {
        try {
          const popupWindow = this.popupWindow;
          if (popupWindow && popupWindow.location.href.includes(this.config.url)) {
            clearInterval(checkPopup);
            resolve();
          }
        } catch (e) {
          // Cross-origin access error, ignore
          // If popup is closed, we'll wait for the message handler
          if (!this.popupWindow || this.popupWindow.closed) {
            clearInterval(checkPopup);
            resolve(); // Don't reject, wait for message
          }
        }
      }, 100);
    });
  }

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

  private isClosing = false;

  closeDialog(): void {
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;
    try {
      // Clean up iframe first
      if (this.iframeRef) {
        if (this.iframeRef.parentNode) {
          this.iframeRef.parentNode.removeChild(this.iframeRef);
        }
        this.iframeRef = null;
      }

      // Force close any open dialog
      if (this.dialogRef) {
        // First try to close it normally
        try { this.dialogRef.close(); } catch {}

        // Then force remove from DOM
        if (this.dialogRef.parentNode) {
          this.dialogRef.parentNode.removeChild(this.dialogRef);
        }
        this.dialogRef = null;
      }

      // Clean up popup if any
      if (this.popupWindow) {
        try { this.popupWindow.close(); } catch {}
        this.popupWindow = null;
      }

      if (this.popupCloseInterval) {
        clearInterval(this.popupCloseInterval);
        this.popupCloseInterval = null;
      }

      this.action = null;
      this.logger.debug('Closed dialog');
    } catch (error) {
      this.logger.error('Error closing dialog:', error);
    } finally {
      this.isClosing = false;
    }
  }

  handleMessage = (event: MessageEvent): void => {
    // Validate origin
    const expectedOrigin = new URL(this.config.url).origin;
    if (event.origin !== expectedOrigin) {
      return;
    }

    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }

    this.logger.debug('Received message:', message);

    // Handle message before closing dialog to avoid race conditions
    let shouldClose = true;

    switch (message.type) {
      case 'WALLET_CONNECTED':
        // Extract wallet data
        const { publickey: publicKey, credentialId, timestamp, connectionType } = message.data;
        this.emit('connect', {
          publicKey,
          credentialId: credentialId,
          isCreated: connectionType === 'create',
          timestamp,
          connectionType
        });
        // Don't close yet, wait for smart wallet creation
        shouldClose = false;
        break;

      case 'SIGN_SUCCESS':
      case 'SIGNATURE_CREATED':
        this.emit('sign', message.data);
        // Don't close yet, wait for transaction building
        shouldClose = false;
        break;

      case 'ERROR':
        this.emit('error', new Error(message.error));
        shouldClose = false;
        break;

      case 'CLOSE':
        // Only close if explicitly requested
        break;

      default:
        this.emit('message', message);
        shouldClose = false;
    }

    // Close dialog after handling message if needed
    if (shouldClose) {
      this.closeDialog();
    }
  };

  syncCredentials(force = false): void {
    if (!this.iframeRef?.contentWindow || !force && !this.action) {
      return;
    }

    const credentials = {
      type: 'SYNC_CREDENTIALS',
      data: {
        
      }
    };

    this.iframeRef.contentWindow.postMessage(credentials, new URL(this.config.url).origin)
    this.logger.debug('Synced credentials');
    if (!this.iframeRef || !this.dialogRef) {
      throw new Error('Dialog or iframe reference not found');
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    this.closeDialog();

    if (this.dialogRef && this.dialogRef.parentNode) {
      this.dialogRef.parentNode.removeChild(this.dialogRef);
    }

    this.dialogRef = null;
    this.iframeRef = null;
    window.removeEventListener('message', this.handleMessage);
    this.removeAllListeners();
    this.logger.debug('Destroyed communication handler');
  }

  initialize(): void {
    window.addEventListener('message', this.handleMessage);
    this.logger.debug('Initialized communication handler');
  }
}
