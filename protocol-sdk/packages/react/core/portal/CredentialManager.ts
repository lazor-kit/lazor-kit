/**
 * Manages credentials and synchronizes them between contexts
 */

import { EventEmitter } from 'eventemitter3';
import { CredentialData } from './types/DialogTypes';

/**
 * The origin of `portalUrl`, the only page the credentials may reach. Null
 * when it has none to address (not an absolute URL, or an opaque origin such
 * as a `data:` URL's): then nothing is sent.
 */
function originOf(portalUrl: string): string | null {
  try {
    const { origin } = new URL(portalUrl);
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

export class CredentialManager extends EventEmitter {
  private iframeRef: HTMLIFrameElement | null = null;
  private retryDelays = [200, 400, 800, 1500, 3000];
  /**
   * Where the credentials go: the portal's origin. The iframe's window gets
   * them only while it shows a page of that origin, so a frame navigated (or
   * redirected) anywhere else receives nothing. Never `'*'`, which handed the
   * credential id, passkey public key and wallet address to whatever page the
   * iframe showed.
   */
  private readonly targetOrigin: string | null;

  /** @param portalUrl - The portal the dialog's iframe shows (`DialogManagerConfig.portalUrl`). */
  constructor(portalUrl: string) {
    super();
    this.targetOrigin = originOf(portalUrl);
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
    // Destroyed: the dialog is gone, and there is nothing to sync to. (A
    // dialog answered or closed within the first half second used to leave
    // this polling every 500 ms for the life of the page.)
    if (!this.iframeRef) return;
    // Schedule the sync to run after a short delay to ensure iframe is ready
    if (!this.iframeRef.contentWindow) {
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
    }
    const targetOrigin = this.targetOrigin;
    if (!targetOrigin) return;

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
      this.iframeRef.contentWindow.postMessage(message, targetOrigin);

      // Retry sync multiple times to ensure delivery
      this.retryDelays.forEach((delay) => {
        setTimeout(() => {
          try {
            if (this.iframeRef?.contentWindow) {
              this.iframeRef.contentWindow.postMessage(message, targetOrigin);
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