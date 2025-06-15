import { CommunicationHandler, CommunicationConfig } from './CommunicationHandler';
import { Logger } from '../../utils/logger';
import { EventEmitter } from 'eventemitter3';

export class DialogManager extends EventEmitter {
  private handler: CommunicationHandler;
  private logger = new Logger('DialogManager');

  constructor(config: CommunicationConfig) {
    super();
    this.handler = new CommunicationHandler(config);
    this.handler.initialize();

    // Setup event listeners
    this.handler.on('connect', this.handleConnect.bind(this));
    this.handler.on('sign', this.handleSign.bind(this));
    this.handler.on('error', this.handleError.bind(this));
    
    // Handle raw message events and forward them
    this.handler.on('message', (message) => {
      this.logger.debug('Received message event', { message });
      
      // Process special message types
      if (message?.type === 'WALLET_CONNECTED' && message?.data) {
        // Convert to the expected format for handleConnect
        const connectData = {
          publicKey: message.data.publickey,
          credentialId: message.data.credentialId,
          isCreated: message.data.connectionType === 'create',
          timestamp: message.data.timestamp,
          connectionType: message.data.connectionType
        };
        this.handleConnect(connectData);
      } else if (message?.type === 'SIGNATURE_CREATED') {
        console.log('DialogManager: Received SIGNATURE_CREATED message:', message);
        
        // Extract signature data from the message
        const signatureData = {
          signature: message.data?.signature || message.signature,
          timestamp: message.data?.timestamp || message.timestamp || Date.now(),
          credentialId: message.data?.credentialId || message.credentialId,
          publicKey: message.data?.publicKey || message.publicKey
        };
        
        if (signatureData.signature) {
          console.log('DialogManager: Valid signature data found:', signatureData);
          this.handleSign(signatureData);
          // Emit the SIGNATURE_CREATED event with the signature data
          this.emit('SIGNATURE_CREATED', signatureData);
        } else {
          console.warn('DialogManager: SIGNATURE_CREATED message without signature data:', message);
        }
      }
      
      // Forward the raw message for other listeners
      this.emit('message', message);
    });
  }

  /**
   * Open connect dialog
   */
  async connect(): Promise<void> {
    await this.handler.openDialog('connect');
  }

  /**
   * Open sign dialog
   * Ensures credentials are synced before opening the dialog
   */
  async sign(): Promise<void> {
    console.log('DialogManager: Opening sign dialog with credential sync');
    
    // Force sync credentials multiple times before opening dialog
    this.syncCredentials(true);
    
    // Small delay to ensure credentials are synced before opening dialog
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Open the dialog
    await this.handler.openDialog('sign');
    
    // Sync credentials again after dialog is open
    setTimeout(() => {
      console.log('DialogManager: Re-syncing credentials after dialog open');
      this.syncCredentials(true);
    }, 300);
  }

  /**
   * Close current dialog
   */
  close(): void {
    this.handler.closeDialog();
  }

  /**
   * Sync credentials with iframe
   */
  syncCredentials(force = false): void {
    this.handler.syncCredentials(force);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.handler.destroy();
  }

  private handleConnect(data: any): void {
    this.logger.debug('Connect success:', data);
    
    // Store credentials in localStorage immediately
    if (data?.publicKey) {
      localStorage.setItem('PUBLIC_KEY', data.publicKey);
    }
    
    if (data?.credentialId) {
      localStorage.setItem('CREDENTIAL_ID', data.credentialId);
    }
    
    // Dispatch a custom event for components that might be listening
    window.dispatchEvent(new CustomEvent('lazorkit:connect-success', {
      detail: data,
      bubbles: true,
      cancelable: true
    }));
    
    // Emit event for internal listeners
    this.emit('connect', data);
  }

  private handleSign(data: any): void {
    this.logger.debug('Sign success:', data);
    
    // Dispatch a custom event for components that might be listening
    window.dispatchEvent(new CustomEvent('lazorkit:sign-success', {
      detail: data,
      bubbles: true,
      cancelable: true
    }));
    
    // Emit event for internal listeners
    this.emit('sign', data);
  }

  private handleError(error: Error): void {
    this.logger.error('Dialog error:', error);
    this.emit('error', error);
  }

}