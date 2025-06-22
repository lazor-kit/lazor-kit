/**
 * Handles message communication between windows/frames
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
import { CredentialManager } from './CredentialManager';
import { CommunicationConfig, MessageData } from './types/DialogTypes';

export class MessageHandler extends EventEmitter {
  private logger = new Logger('MessageHandler');
  private config: CommunicationConfig;
  private credentialManager: CredentialManager;
  private boundMessageHandler: (event: MessageEvent) => void;

  constructor(config: CommunicationConfig, credentialManager: CredentialManager) {
    super();
    this.config = config;
    this.credentialManager = credentialManager;
    this.boundMessageHandler = this.handleMessage.bind(this);
    this.logger.debug('Created message handler');
  }

  /**
   * Initialize message handler
   */
  initialize(): void {
    window.addEventListener('message', this.boundMessageHandler);
    this.logger.debug('Initialized message handler');
  }

  /**
   * Process incoming messages
   */
  handleMessage(event: MessageEvent): void {
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
        this.handleWalletConnected(message);
        // NEVER close automatically for WALLET_CONNECTED
        console.log('Wallet connected, keeping dialog open');
        break;
        
      case 'SIGNATURE_CREATED':
        console.log('Signature created, emitting sign event');
        this.emit('sign', message.data);
        
        // Set a timeout to close the dialog if the parent app doesn't close it
        // This provides a backup mechanism to ensure the dialog gets closed
        setTimeout(() => {
          console.log('Auto-closing dialog after signature (safety timeout)');
          this.emit('close');
        }, 5000); // 5 second safety timeout
        
        // Note: The parent application should still call closeDialog after
        // transaction building, but this ensures we don't get stuck dialogs
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
      this.emit('close');
    }
  }

  /**
   * Handle WALLET_CONNECTED message
   */
  private handleWalletConnected(message: MessageData): void {
    // Extract wallet data and validate
    const { publickey, credentialId, timestamp, connectionType } = message.data || {};
    
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
    this.credentialManager.storeCredentials({
      credentialId,
      publickey,
      timestamp
    });
    
    // Directly emit the connection event without waiting
    this.emit('connect', {
      publicKey: publickey,
      credentialId: credentialId,
      isCreated: connectionType === 'create',
      timestamp,
      connectionType
    });
    
    // Store credentials in parent window and notify any listeners
    this.credentialManager.notifyCredentialsUpdated({
      credentialId,
      publicKey: publickey,
      timestamp
    });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    window.removeEventListener('message', this.boundMessageHandler);
    this.removeAllListeners();
    this.logger.debug('Destroyed message handler');
  }
}
