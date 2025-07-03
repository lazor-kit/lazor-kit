/**
 * Manages credentials and synchronizes them between contexts
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
import { CredentialData } from './types/DialogTypes';

export class CredentialManager extends EventEmitter {
  private logger = new Logger('CredentialManager');
  private iframeRef: HTMLIFrameElement | null = null;
  private retryDelays = [200, 400, 800, 1500, 3000]; // Milliseconds between retries
  
  constructor() {
    super();
    this.logger.debug('Created credential manager');
  }

  /**
   * Set the iframe reference for communication
   */
  setIframeRef(iframe: HTMLIFrameElement | null): void {
    this.iframeRef = iframe;
  }

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
      
      // Multiple retries with increasing intervals to ensure delivery
      if (force) {
        this.scheduleRetries(message);
      }
      
      return true;
    } catch (err) {
      console.error("Error syncing credentials to iframe:", err);
      this.logger.error("❌ Error syncing credentials to iframe:", err);
      return false;
    }
  }
  
  /**
   * Schedule credential sync retries
   */
  private scheduleRetries(message: any): void {
    this.retryDelays.forEach((delay, index) => {
      setTimeout(() => {
        console.log(`Re-syncing credentials to iframe (retry ${index + 1}/${this.retryDelays.length})`);
        try {
          if (this.iframeRef?.contentWindow) {
            this.iframeRef.contentWindow.postMessage(message, '*');
          }
        } catch (err) {
          console.error(`Error during retry ${index + 1} credential sync:`, err);
        }
      }, delay);
    });
  }
  
  /**
   * Store credentials in local storage
   */
  storeCredentials(credentials: CredentialData): void {
    if (credentials.credentialId) {
      localStorage.setItem('CREDENTIAL_ID', credentials.credentialId);
    }
    
    if (credentials.publicKey) {
      localStorage.setItem('PUBLIC_KEY', credentials.publicKey);
    } else if (credentials.publickey) { 
      // Handle alternative property name
      localStorage.setItem('PUBLIC_KEY', credentials.publickey);
    }
    
    if (credentials.smartWalletAddress) {
      localStorage.setItem('SMART_WALLET_ADDRESS', credentials.smartWalletAddress);
    }
    
    this.logger.debug('Stored credentials in local storage', {
      hasCredentialId: !!credentials.credentialId,
      hasPublicKey: !!(credentials.publicKey || credentials.publickey),
      hasSmartWalletAddress: !!credentials.smartWalletAddress
    });
  }
  
  /**
   * Get stored credentials
   */
  getCredentials(): CredentialData {
    return {
      credentialId: localStorage.getItem('CREDENTIAL_ID') || '',
      publicKey: localStorage.getItem('PUBLIC_KEY') || '',
      smartWalletAddress: localStorage.getItem('SMART_WALLET_ADDRESS') || ''
    };
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    this.removeAllListeners();
    this.iframeRef = null;
    this.logger.debug('Destroyed credential manager');
  }
}
