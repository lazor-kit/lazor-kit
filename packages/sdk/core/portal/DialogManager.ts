/**
 * Dialog Manager - Web Portal Connection
 * Handles portal communication via iframe/popup dialogs for web
 */

import { EventEmitter } from 'eventemitter3';
import { API_ENDPOINTS } from '../../config';
import { CredentialManager } from './CredentialManager';

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

/**
 * Dialog Manager for Web Portal Connection
 * Provides abstraction over iframe/popup portal communication
 */
export class DialogManager extends EventEmitter {
  private config: DialogManagerConfig;
  private dialogRef: HTMLDialogElement | null = null;
  private iframeRef: HTMLIFrameElement | null = null;
  private popupWindow: Window | null = null;
  private isClosing = false;
  private credentialManager: CredentialManager;

  constructor(config: DialogManagerConfig) {
    super();
    this.config = config;
    this.credentialManager = new CredentialManager();
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
      
      // Open connection dialog
      const connectUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.CONNECT}`;
      this.openConnectDialog(connectUrl).catch(reject);
    });
  }

  /**
   * Open portal signing dialog
   * @param message - Message to sign
   * @returns Promise that resolves with signature result
   */
  async openSign(message: string): Promise<SignResult> {
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
      
      // Open signing dialog (always iframe to avoid popup blocking)
      const encodedMessage = encodeURIComponent(message);
      const signUrl = `${this.config.portalUrl}?action=${API_ENDPOINTS.SIGN}&message=${encodedMessage}`;
      this.openSignDialog(signUrl).catch(reject);
    });
  }

  /**
   * Open connection dialog (popup or modal based on browser)
   */
  private async openConnectDialog(url: string): Promise<void> {
    const shouldUsePopup = this.shouldUsePopup();
    
    if (shouldUsePopup) {
      await this.openPopup(url);
    } else {
      await this.openModal(url);
    }
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
   * Determine if popup should be used instead of modal
   */
  private shouldUsePopup(): boolean {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    // Use popup on Safari or mobile for better compatibility
    return isSafari || isMobile;
  }

  /**
   * Open popup window
   */
  private async openPopup(url: string): Promise<void> {
    // Close any existing popup
    if (this.popupWindow && !this.popupWindow.closed) {
      this.popupWindow.close();
    }
    
    // Calculate centered position
    const width = 450;
    const height = 600;
    const left = window.outerWidth / 2 + window.screenX - width / 2;
    const top = window.outerHeight / 2 + window.screenY - height / 2;
    
    // Open popup window
    this.popupWindow = window.open(
      url,
      'lazorkit-popup',
      `width=${width},height=${height},top=${top},left=${left},resizable,scrollbars,status`
    );
    
    if (!this.popupWindow) {
      throw new Error('Popup was blocked by browser');
    }
    
    // Monitor popup state
    const checkClosed = setInterval(() => {
      if (this.popupWindow && this.popupWindow.closed) {
        clearInterval(checkClosed);
      }
    }, 1000);
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
    // Create dialog element
    const dialog = document.createElement('dialog');
    dialog.id = 'lazorkit-dialog';
    
    // Apply styles
    Object.assign(dialog.style, {
      width: '450px',
      height: '600px',
      border: 'none',
      borderRadius: '12px',
      padding: '0',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      backgroundColor: 'transparent',
    });

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'lazorkit-iframe';
    Object.assign(iframe.style, {
      width: '100%',
      height: '100%',
      border: 'none',
      borderRadius: '12px',
    });
    
    // Set iframe permissions for WebAuthn
    iframe.allow = `publickey-credentials-get ${this.config.portalUrl}; publickey-credentials-create ${this.config.portalUrl}`;
    iframe.sandbox.add('allow-forms', 'allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-modals');
    
    // Add close on escape
    dialog.addEventListener('cancel', () => {
      this.closeDialog();
    });
    
    // Add iframe to dialog
    dialog.appendChild(iframe);
    
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
          this.emit('sign-result', data);
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
    
    try {
      // Close popup
      if (this.popupWindow && !this.popupWindow.closed) {
        this.popupWindow.close();
        this.popupWindow = null;
      }
      
      // Close modal
      if (this.dialogRef) {
        try {
          this.dialogRef.close();
        } catch (e) {
          // Ignore close errors
        }
        
        if (this.dialogRef.parentNode) {
          this.dialogRef.parentNode.removeChild(this.dialogRef);
        }
        this.dialogRef = null;
        this.iframeRef = null;
      }
    } finally {
      this.isClosing = false;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.closeDialog();
    this.credentialManager.destroy();
    this.removeAllListeners();
  }
}
