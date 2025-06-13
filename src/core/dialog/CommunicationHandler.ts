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
    height: '66.67vh',
    maxHeight: '66.67vh',
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
    top: isMobile ? 'auto' : '50%',
    left: isMobile ? 0 : '50%',
    right: isMobile ? 0 : 'auto',
    bottom: isMobile ? 0 : 'auto',
    transform: isMobile ? 'none' : 'translate(-50%, -50%)',
    display: 'flex',
    flexDirection: 'column',
    background: 'white',
    border: 'none',
    margin: isMobile ? 0 : 'auto',
    width: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].width,
    maxWidth: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxWidth,
    height: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].height,
    maxHeight: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxHeight,
    borderRadius: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].borderRadius,
    padding: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].padding,
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    zIndex: 2147483647,
    willChange: 'transform',
    webkitBackfaceVisibility: 'hidden',
    backfaceVisibility: 'hidden',
    webkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain'
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
    background: 'white',
    display: 'flex',
    flexDirection: 'column',
    willChange: 'transform',
    webkitBackfaceVisibility: 'hidden',
    backfaceVisibility: 'hidden',
    webkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain'
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
  private popupCloseInterval: ReturnType<typeof setInterval> | null = null;
  private dialogRef: HTMLDialogElement | null = null;
  private iframeRef: HTMLIFrameElement | null = null;

  private logger = new Logger('CommunicationHandler');
  private config: CommunicationConfig;
  // Action type for the current operation
  private _action: 'connect' | 'sign' | 'pay' | null = null;
  
  // Getter for the action property
  get action(): 'connect' | 'sign' | 'pay' | null {
    return this._action;
  }
  
  // Setter for the action property
  set action(value: 'connect' | 'sign' | 'pay' | null) {
    this._action = value;
  }
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
        position: fixed !important;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .lazor-dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        animation: backdropShow 0.2s ease-out forwards;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }
      .lazor-close-button {
        opacity: 0.7;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        position: absolute;
        z-index: 10;
      }
      .lazor-close-button:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.1) !important;
        transform: scale(1.1) !important;
      }
      @media (max-width: 768px) {
        .lazor-dialog {
          margin: 0 !important;
          border-radius: 20px 20px 0 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: 66.67vh !important;
          transform: translateY(0) !important;
          position: fixed !important;
          will-change: transform;
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
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
      // Wait for cleanup - increased to ensure complete cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    this.action = action;
    console.log(`Opening dialog for action: ${action}`);

    // Check if we should use popup instead
    if (this.shouldUsePopup(action)) {
      const url = `${this.config.url}?action=${action}`;
      console.log(`Using popup for ${action} at URL: ${url}`);
      await this.openPopup(url);
      return;
    }

    try {
      const isMobile = this.isMobileDevice();
      console.log(`Creating ${isMobile ? 'mobile' : 'desktop'} dialog for ${action}`);
      
      // Pre-load credentials from localStorage
      const credentialId = localStorage.getItem('CREDENTIAL_ID');
      const publicKey = localStorage.getItem('PUBLIC_KEY');
      const smartWalletAddress = localStorage.getItem('SMART_WALLET_ADDRESS');
      
      console.log('Current credentials before dialog creation:', {
        credentialIdExists: !!credentialId,
        publicKeyExists: !!publicKey,
        smartWalletAddressExists: !!smartWalletAddress
      });
      
      // Create dialog first
      this.dialogRef = this.createDialog(isMobile);
      
      // Create iframe container
      const container = document.createElement('div');
      Object.assign(container.style, getDialogStyles(isMobile).iframeContainer);
      
      // Create iframe with all necessary attributes
      this.iframeRef = document.createElement('iframe');
      Object.assign(this.iframeRef.style, getDialogStyles(isMobile).iframe);
      
      // Critical: Ensure proper permissions for WebAuthn
      this.iframeRef.allow = `publickey-credentials-get ${this.config.url}; publickey-credentials-create ${this.config.url}; clipboard-write`;
      this.iframeRef.setAttribute('aria-label', 'Lazor Wallet');
      this.iframeRef.setAttribute('role', 'dialog');
      this.iframeRef.tabIndex = 0;
      this.iframeRef.title = 'Lazor';
      
      // Critical: Ensure all necessary sandbox permissions
      const sandbox = this.iframeRef.sandbox;
      sandbox.add('allow-forms');
      sandbox.add('allow-scripts');
      sandbox.add('allow-same-origin');
      sandbox.add('allow-popups');
      sandbox.add('allow-popups-to-escape-sandbox');
      sandbox.add('allow-modals');
      
      // Build URL with action and credentials as query parameters
      const url = new URL(this.config.url);
      url.searchParams.set('action', action);
      
      // For sign action, include credentials in URL to ensure they're available
      if (action === 'sign') {
        url.searchParams.set('message', 'hello');
        
        // Pass credentials in URL for immediate availability
        if (credentialId) url.searchParams.set('credentialId', credentialId);
        if (publicKey) url.searchParams.set('publicKey', publicKey);
        if (smartWalletAddress) url.searchParams.set('smartWalletAddress', smartWalletAddress);
      }
      
      console.log(`Setting iframe src to: ${url.toString()}`);
      this.iframeRef.src = url.toString();
      
      // Assemble the dialog
      container.appendChild(this.iframeRef);
      this.dialogRef.appendChild(container);
      document.body.appendChild(this.dialogRef);
      
      // Show dialog
      console.log('Showing dialog modal');
      this.dialogRef.showModal();

      // Wait for iframe to load then sync credentials
      console.log('Waiting for iframe to load...');
      await new Promise(resolve => {
        if (this.iframeRef) {
          this.iframeRef.addEventListener('load', () => {
            console.log('Iframe loaded successfully');
            resolve(null);
          }, { once: true });
          
          // Safety timeout in case load event doesn't fire
          setTimeout(() => {
            console.log('Iframe load timeout - proceeding anyway');
            resolve(null);
          }, 5000);
        } else {
          console.error('No iframe reference available');
          resolve(null);
        }
      });
      
      // Sync credentials multiple times to ensure they're received
      console.log('Syncing credentials after iframe load');
      this.syncCredentials(true);
      
      // Additional sync after a short delay
      setTimeout(() => {
        console.log('Performing additional credential sync');
        this.syncCredentials(true);
      }, 500);
    } catch (error) {
      console.error('Error opening dialog:', error);
      this.logger.error('Error opening dialog:', error);
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

    // IMPORTANT: Never automatically close the dialog based on message type
    // The parent application should explicitly call closeDialog when it's ready
    // This prevents premature dialog closing during transaction signing
    let shouldClose = false; // Default to NOT closing

    switch (message.type) {
      case 'WALLET_CONNECTED':
        // Extract wallet data and validate
        const { publickey, credentialId, timestamp, connectionType } = message.data;
        
        // Log the received data for debugging
        this.logger.debug('WALLET_CONNECTED data received:', { 
          publickey, 
          credentialId, 
          timestamp, 
          connectionType,
          messageData: JSON.stringify(message.data)
        });
        
        // Validate public key
        if (!publickey) {
          this.logger.error('Public key is missing in WALLET_CONNECTED message');
          // Try to get from localStorage as fallback
          const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
          if (storedPublicKey) {
            this.logger.debug('Using stored public key as fallback');
            message.data.publickey = storedPublicKey;
          } else {
            this.logger.error('No public key available in localStorage either');
          }
        }
        
        // Store credentials immediately to ensure they're available for smart wallet operations
        if (credentialId) {
          localStorage.setItem('CREDENTIAL_ID', credentialId);
        }
        
        if (publickey) {
          localStorage.setItem('PUBLIC_KEY', publickey);
        }
        
        // Directly emit the connection event without waiting
        this.emit('connect', {
          publicKey: publickey,
          credentialId: credentialId,
          isCreated: connectionType === 'create',
          timestamp,
          connectionType
        });
        
        // Store credentials in parent window and notify any listeners
        this.notifyCredentialsUpdated({
          credentialId,
          publicKey: publickey,
          timestamp
        });
        
        // NEVER close automatically for WALLET_CONNECTED
        console.log('Wallet connected, keeping dialog open');
        break;
        
      case 'SIGNATURE_CREATED':
        console.log('Signature created, keeping dialog open for transaction building');
        this.emit('sign', message.data);
        // NEVER close automatically for SIGNATURE_CREATED
        // The parent application will close it after building the transaction
        break;

      case 'ERROR':
        this.emit('error', new Error(message.error));
        // Don't close on error, let the parent application handle it
        break;

      case 'CLOSE':
        // Only close if explicitly requested by the dialog itself
        console.log('Explicit close request received from dialog');
        shouldClose = true;
        break;

      default:
        this.emit('message', message);
        // Don't close for unknown message types
    }

    // Close dialog ONLY if explicitly requested by a CLOSE message
    if (shouldClose) {
      console.log('Closing dialog due to explicit close request');
      this.closeDialog();
    }
  };

  /**
   * Sync credentials with the iframe
   * @param force Force a retry after a short delay
   */
  /**
   * Notify all listeners that credentials have been updated
   * @param credentials The updated credentials
   */
  notifyCredentialsUpdated(credentials: { credentialId: string; publicKey: string; timestamp: string | number }): void {
    this.logger.debug('📣 Notifying credential update', { 
      credentialIdExists: !!credentials.credentialId,
      publicKeyExists: !!credentials.publicKey
    });
    
    // Emit an event that parent components can listen for
    this.emit('credentials-updated', credentials);
    
    // Dispatch a custom event that can be listened for by any component
    const event = new CustomEvent('lazorkit:credentials-updated', { 
      detail: credentials,
      bubbles: true,
      cancelable: true
    });
    
    window.dispatchEvent(event);
    
    // Try to sync with iframe if available
    if (this.iframeRef?.contentWindow) {
      this.syncCredentials(true);
    } else {
      this.logger.debug('⏱️ No iframe available, scheduling delayed sync attempt');
      // Schedule a delayed sync attempt in case iframe becomes available
      setTimeout(() => this.syncCredentials(true), 500);
    }
  }
  
  /**
   * Sync credentials with the iframe and emit events to notify parent window
   * @param force Force a retry after a short delay
   * @returns boolean indicating if sync was attempted
   */
  syncCredentials(force = false): boolean {
    if (!this.iframeRef || !this.iframeRef.contentWindow) {
      this.logger.warn("⚠️ Cannot sync credentials: iframe reference not available");
      console.error("Cannot sync credentials: iframe reference not available");
      return false;
    }

    // Get credentials from localStorage to ensure consistency
    const credentialId = localStorage.getItem('CREDENTIAL_ID');
    const publickey = localStorage.getItem('PUBLIC_KEY');
    const smartWalletAddress = localStorage.getItem('SMART_WALLET_ADDRESS');
    
    console.log('Syncing credentials to iframe:', { 
      credentialIdExists: !!credentialId, 
      publickeyExists: !!publickey,
      smartWalletExists: !!smartWalletAddress
    });
    
    this.logger.debug(`🔍 Checking credentials for iframe sync${force ? ' (forced)' : ''}:`, { 
      credentialIdExists: !!credentialId, 
      publickeyExists: !!publickey,
      smartWalletExists: !!smartWalletAddress,
      iframeReady: !!this.iframeRef.contentWindow
    });
    
    // Always attempt to sync even if credentials are missing
    // This ensures we're sending the most up-to-date state
    try {
      // Send credential data including smart wallet address if available
      const message = {
        type: 'SYNC_CREDENTIALS',
        data: {
          credentialId: credentialId || '',
          publickey: publickey || '',
          smartWalletAddress: smartWalletAddress || '',
          timestamp: Date.now()
        },
      };
      
      console.log('Sending credentials to iframe:', message);
      this.iframeRef.contentWindow.postMessage(message, '*');
      
      // Emit a credentials-synced event that components can listen for
      this.emit('credentials-synced', {
        credentialId: credentialId || '',
        publickey: publickey || '',
        smartWalletAddress: smartWalletAddress || ''
      });
      
      // Multiple retries with decreasing intervals to ensure delivery
      if (force) {
        // First retry after 200ms
        setTimeout(() => {
          console.log("Re-syncing credentials to iframe (retry 1/5)");
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            console.error("Error during retry 1 credential sync:", err);
          }
        }, 200);
        
        // Second retry after 400ms
        setTimeout(() => {
          console.log("Re-syncing credentials to iframe (retry 2/5)");
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            console.error("Error during retry 2 credential sync:", err);
          }
        }, 400);
        
        // Third retry after 800ms
        setTimeout(() => {
          console.log("Re-syncing credentials to iframe (retry 3/5)");
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            console.error("Error during retry 3 credential sync:", err);
          }
        }, 800);
        
        // Fourth retry after 1500ms
        setTimeout(() => {
          console.log("Re-syncing credentials to iframe (retry 4/5)");
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            console.error("Error during retry 4 credential sync:", err);
          }
        }, 1500);
        
        // Fifth retry after 3000ms
        setTimeout(() => {
          console.log("Re-syncing credentials to iframe (retry 5/5)");
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            console.error("Error during retry 5 credential sync:", err);
          }
        }, 3000);
      }
      
      return true;
    } catch (err) {
      console.error("Error syncing credentials to iframe:", err);
      this.logger.error("❌ Error syncing credentials to iframe:", err);
      return false;
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
