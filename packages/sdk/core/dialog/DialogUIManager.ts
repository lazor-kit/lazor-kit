/**
 * Handles the creation and management of dialog UI elements
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
import { DialogAction, CommunicationConfig } from './types/DialogTypes';
import { getDialogStyles } from './styles/DialogStyles';
import { SmartWallet } from '../wallet/SmartWallet';
export class DialogUIManager extends EventEmitter {
  private popupWindow: Window | null = null;
  private popupCloseInterval: ReturnType<typeof setInterval> | null = null;
  private dialogRef: HTMLDialogElement | null = null;
  private iframeRef: HTMLIFrameElement | null = null;
  private isClosing = false;
  private isDestroyed = false;
  private logger = new Logger('DialogUIManager');
  private config: CommunicationConfig;
  private _currentAction: DialogAction | null = null;
  private smartWallet: SmartWallet | null = null;

  constructor(config: CommunicationConfig, smartWallet?: SmartWallet) {
    super();
    this.config = config;
    this.smartWallet = smartWallet || null;
    this.logger.debug('Created dialog UI manager with' + (smartWallet ? '' : 'out') + ' SmartWallet');
  }

  /**
   * Set the SmartWallet instance
   */
  setSmartWallet(wallet: SmartWallet): void {
    this.smartWallet = wallet;
  }

  /**
   * Check if the current device is a mobile device
   */
  isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Check if the browser is Safari
   */
  isSafari(): boolean {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  /**
   * Determine if popup should be used instead of dialog
   */
  shouldUsePopup(action: DialogAction): boolean {
    const isMobile = this.isMobileDevice();
    const isSafari = this.isSafari();
    
    // If mode is explicitly set to popup, use popup
    // if (this.config.mode === 'popup') {
    //   return true;
    // }

    // On Safari, always use popup (dialog has issues)
    if (isSafari && action === 'connect') {
      return true;
    }

    // On mobile devices with dialog mode auto, use dialog
    if (isMobile && action === 'connect') {
      return true;
    }

    // On desktop with dialog mode auto, use dialog
    if (!isMobile && action === 'sign') {
      return false;
    }

    if (isMobile && action === 'sign') {
      return false;
    }

    // Default to popup if dialog is not specified
    return true;
  }

  /**
   * Get popup window dimensions
   */
  getPopupDimensions() {
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
   * Create a dialog element
   */
  async createDialog(isMobile: boolean = false): Promise<HTMLDialogElement> {
    try {
      this.logger.debug(`Creating ${isMobile ? 'mobile' : 'desktop'} dialog`);
      
      // Pre-load credentials from localStorage
      const credentialId = localStorage.getItem('CREDENTIAL_ID');
      const publicKey = localStorage.getItem('PUBLIC_KEY');
      const smartWalletAddress = localStorage.getItem('SMART_WALLET_ADDRESS');
      
      console.log('Current credentials before dialog creation:', {
        credentialIdExists: !!credentialId,
        publicKeyExists: !!publicKey,
        smartWalletAddressExists: !!smartWalletAddress
      });
      
      // Remove any existing dialog
      if (this.dialogRef && this.dialogRef.parentNode) {
        this.dialogRef.parentNode.removeChild(this.dialogRef);
      }

      // Create dialog element
      const dialog = document.createElement('dialog');
      dialog.id = 'lazorkit-dialog';
      
      // Apply styles from the dialog style utility
      const styles = getDialogStyles(isMobile);
      
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

      // Create iframe with all necessary attributes
      const iframe = document.createElement('iframe');
      iframe.id = 'lazorkit-iframe';
      Object.assign(iframe.style, styles.iframe);
      
      // Critical: Ensure proper permissions for WebAuthn
      iframe.allow = `publickey-credentials-get ${this.config.url}; publickey-credentials-create ${this.config.url}; clipboard-write; camera; microphone`;
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
      
      // Build URL with parameters
      const url = new URL(this.config.url);
      
      // Add action parameter (CRITICAL for iframe to know what mode to display)
      if (this._currentAction) {
        url.searchParams.set('action', this._currentAction);
        console.log(`Setting action parameter: ${this._currentAction}`);
      }
      
      // Add RPC URL if provided
      if (this.config.rpcUrl) {
        url.searchParams.append('rpcUrl', this.config.rpcUrl);
      }
      
      // Add paymaster URL if provided
      if (this.config.paymasterUrl) {
        url.searchParams.append('paymasterUrl', this.config.paymasterUrl);
      }
      
      if (this._currentAction === 'sign') {
        try {
          if (!this.smartWallet) {
            this.logger.error('Cannot get wallet message: SmartWallet not set');
            throw new Error('SmartWallet is not initialized');
          }
          
          const message = await this.smartWallet.getMessage();
          if (!message) {
            this.logger.error('Got empty message from SmartWallet');
            throw new Error('Failed to get message from SmartWallet');
          }
          
          this.logger.debug('Successfully retrieved message from SmartWallet');
          url.searchParams.set('message', message); 
        } catch (error) {
          this.logger.error('Error getting message from SmartWallet:', error);
          // Set a default message to prevent dialog creation failure
          url.searchParams.set('message', 'error-fetching-message');
        }
      }
      
      console.log(`Setting iframe src to: ${url.toString()}`);
      iframe.src = url.toString();
      
      // Add event listener to close dialog on escape key
      dialog.addEventListener('cancel', () => {
        this.closeDialog();
        this.emit('close');
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
      
      return dialog;
    } catch (error) {
      console.error('Error creating dialog:', error);
      this.logger.error('Error creating dialog:', error);
      throw error;
    }
  }

  /**
   * Open dialog or popup based on configuration
   */
  async openDialog(action: DialogAction): Promise<void> {
    if (this.isDestroyed) {
      return Promise.resolve();
    }
    
    // Store the action for later use in createDialog
    this._currentAction = action;
    
    const usePopup = this.shouldUsePopup(action);
    
    if (usePopup) {
      const url = new URL(this.config.url);
      url.searchParams.append('action', action);
      
      if (this.config.rpcUrl) {
        url.searchParams.append('rpcUrl', this.config.rpcUrl);
      }
      
      if (this.config.paymasterUrl) {
        url.searchParams.append('paymasterUrl', this.config.paymasterUrl);
      }
      
      return this.openPopup(url.toString());
    } else {
      // Create dialog if it doesn't exist
      if (!this.dialogRef) {
        this.dialogRef = await this.createDialog(this.isMobileDevice());
      }
      
      if (!this.dialogRef.open) {
        this.dialogRef.showModal();
      }
      
      // Set iframe source with action parameter
      if (this.iframeRef) {
        const url = new URL(this.iframeRef.src);
        url.searchParams.set('action', action);
        this.iframeRef.src = url.toString();
      }
      
      return Promise.resolve();
    }
  }

  /**
   * Open a popup window
   */
  async openPopup(url: string): Promise<void> {
    // Close any existing popups
    if (this.popupWindow && !this.popupWindow.closed) {
      try {
        this.popupWindow.close();
      } catch (e) {
        // Ignore errors
      }
    }
    
    // Get popup dimensions
    const dimensions = this.getPopupDimensions();
    
    // Open popup
    this.popupWindow = window.open(
      url,
      'lazorkit-popup',
      `width=${dimensions.width},height=${dimensions.height},top=${dimensions.top},left=${dimensions.left},resizable,scrollbars,status`
    );
    
    // Start monitoring popup
    this.startPopupMonitor();
    
    return new Promise<void>((resolve) => {
      // Check if popup was blocked
      if (!this.popupWindow) {
        this.logger.error('Popup was blocked by browser');
        return resolve(); // Return but don't reject
      }
      
      // Setup polling to check when popup is ready
      const checkPopup = setInterval(() => {
        try {
          if (this.popupWindow && !this.popupWindow.closed) {
            // Check if popup is initialized
            const isLoaded = this.popupWindow.document.readyState === 'complete';
            if (isLoaded) {
              clearInterval(checkPopup);
              resolve();
            }
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
   * Close any open dialogs or popups
   */
  closeDialog(): void {
    console.log('📌 DialogUIManager.closeDialog called');
    
    if (this.isClosing) {
      console.log('⚠️ Already closing dialog, returning early');
      return;
    }

    this.isClosing = true;
    console.log('🔍 Closing dialog, iframe state:', !!this.iframeRef);
    
    try {
      // Clean up iframe first
      if (this.iframeRef) {
        console.log('🔍 Removing iframe from DOM');
        if (this.iframeRef.parentNode) {
          this.iframeRef.parentNode.removeChild(this.iframeRef);
          console.log('✅ Iframe successfully removed from DOM');
        } else {
          console.warn('⚠️ Iframe does not have a parent node');
        }
        this.iframeRef = null;
      } else {
        console.log('ℹ️ No iframe reference to clean up');
      }

      // Force close any open dialog
      if (this.dialogRef) {
        console.log('🔍 Closing dialog element');
        // First try to close it normally
        try { 
          this.dialogRef.close();
          console.log('✅ Dialog closed normally'); 
        } catch (e) {
          console.warn('⚠️ Error when closing dialog normally:', e);
        }

        // Then force remove from DOM
        if (this.dialogRef.parentNode) {
          console.log('🔍 Removing dialog from DOM');
          this.dialogRef.parentNode.removeChild(this.dialogRef);
          console.log('✅ Dialog successfully removed from DOM');
        } else {
          console.warn('⚠️ Dialog does not have a parent node');
        }
        this.dialogRef = null;
      } else {
        console.log('ℹ️ No dialog reference to clean up');
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
   * Clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    this.closeDialog();
    this.removeAllListeners();
    this.logger.debug('Destroyed dialog UI manager');
  }
}
