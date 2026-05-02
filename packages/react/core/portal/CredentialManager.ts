/**
 * Manages credentials and synchronizes them between contexts
 */

import { EventEmitter } from 'eventemitter3';
import { CredentialData } from './types/DialogTypes';

export class CredentialManager extends EventEmitter {
  private iframeRef: HTMLIFrameElement | null = null;
  private retryDelays = [200, 400, 800, 1500, 3000];

  constructor() {
    super();
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
    // Emit an event that parent components can listen for
    this.emit('credentials-updated', credentials);

    // Dispatch a custom event that can be listened for by any component
    const event = new CustomEvent('lazorkit:credentials-updated', {
      detail: credentials,
      bubbles: true,
      cancelable: true
    });

    window.dispatchEvent(event);
  }

  /**
   * Force sync credentials to the iframe
   * @param force Whether to force sync even if credentials appear empty
   */
  syncCredentials(force = false): void {
    // Schedule the sync to run after a short delay to ensure iframe is ready
    if (!this.iframeRef || !this.iframeRef.contentWindow) {
      setTimeout(() => this.syncCredentials(force), 500);
      return;
    }

    this.performCredentialSync(force);
  }

  /**
   * Perform the actual credential synchronization
   * @param force Whether to force sync even if credentials appear empty
   */
  private performCredentialSync(force: boolean): void {
    if (!this.iframeRef?.contentWindow) {
      throw new Error('Cannot sync credentials: iframe reference not available');
      return;
    }

    // Get credentials from localStorage
    const credentialId = localStorage.getItem('CREDENTIAL_ID') || '';
    const publickey = localStorage.getItem('PUBLIC_KEY') || '';
    const smartWalletAddress = localStorage.getItem('SMART_WALLET_ADDRESS') || '';

    // Check if we have valid credentials or if we're forcing the sync
    if (!force && (!credentialId || !publickey)) {
      return;
    }

    const message = {
      type: 'SYNC_CREDENTIALS',
      data: {
        credentialId,
        publickey,
        smartWalletAddress,
        timestamp: Date.now()
      }
    };

    try {
      this.iframeRef.contentWindow.postMessage(message, '*');

      // Retry sync multiple times to ensure delivery
      this.retryDelays.forEach((delay) => {
        setTimeout(() => {
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, '*');
            }
          } catch (err) {
            // Ignore errors during retry
          }
        }, delay);
      });

    } catch (err) {
      // Silently handle sync errors
    }
  }

  /**
   * Store credentials in local storage
   * @param credential The credential data to store
   */
  storeCredential(credential: CredentialData): void {
    if (credential.credentialId) {
      localStorage.setItem('CREDENTIAL_ID', credential.credentialId);
    }

    if (credential.publickey) {
      localStorage.setItem('PUBLIC_KEY', credential.publickey);
    }

    if (credential.smartWalletAddress) {
      localStorage.setItem('SMART_WALLET_ADDRESS', credential.smartWalletAddress);
    }

    // Store timestamp for tracking
    localStorage.setItem('CREDENTIALS_TIMESTAMP', new Date().toISOString());
  }

  /**
   * Clean up resources and event listeners
   */
  destroy(): void {
    this.removeAllListeners();
    this.iframeRef = null;
  }
}