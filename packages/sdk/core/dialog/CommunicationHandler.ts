/**
 * Main communication handler that coordinates dialog UI, messages, and credentials
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
import { DialogUIManager } from './DialogUIManager';
import { MessageHandler } from './MessageHandler';
import { CredentialManager } from './CredentialManager';
import { CommunicationConfig, DialogAction } from './types/DialogTypes';
import { SmartWallet } from '../wallet/SmartWallet';
/**
 * Main communication handler that integrates UI, messaging, and credential management
 */
export class CommunicationHandler extends EventEmitter {
  private logger = new Logger('CommunicationHandler');
  private isDestroyed = false;
  private _action: 'connect' | 'sign' | 'pay' | null = null;
  // Module instances
  private uiManager: DialogUIManager;
  private messageHandler: MessageHandler;
  private credentialManager: CredentialManager;
  private smartWallet: SmartWallet | null = null;

  /**
   * Get action type
   */
  get action(): 'connect' | 'sign' | 'pay' | null {
    return this._action;
  }

  /**
   * Set action type
   */
  set action(value: 'connect' | 'sign' | 'pay' | null) {
    this._action = value;
  }

  /**
   * Create a new communication handler
   */
  constructor(config: CommunicationConfig) {
    super();
    // Create module instances
    this.credentialManager = new CredentialManager();
    this.uiManager = new DialogUIManager(config);
    this.messageHandler = new MessageHandler(config, this.credentialManager);
    // Initialize components
    this.setupEventForwarding();
    this.initialize();

    this.logger.debug('Created communication handler');
  }
  
  /**
   * Set the SmartWallet instance for wallet operations
   * @param wallet SmartWallet instance
   */
  setSmartWallet(wallet: SmartWallet): void {
    this.smartWallet = wallet;
    // Pass the wallet to the UI manager
    this.uiManager.setSmartWallet(wallet);
    this.logger.debug('SmartWallet reference set in communication handler');
  }
  
  /**
   * Get the current SmartWallet instance
   */
  getSmartWallet(): SmartWallet | null {
    return this.smartWallet;
  }
  
  /**
   * Get a message from the SmartWallet
   * @returns Promise with the message string
   */
  async getWalletMessage(): Promise<string> {
    if (!this.smartWallet) {
      this.logger.error('SmartWallet not available');
      throw new Error('SmartWallet not initialized');
    }
    
    try {
      return await this.smartWallet.getMessage();
    } catch (error) {
      this.logger.error('Failed to get message from SmartWallet', error);
      throw error;
    }
  }

  /**
   * Set up event forwarding between components
   */
  private setupEventForwarding(): void {
    // Forward UI manager events
    this.uiManager.on('dialog-closed', () => {
      this.action = null;
      this.emit('dialog-closed');
    });

    // Forward message handler events
    this.messageHandler.on('connect', (data) => this.emit('connect', data));
    this.messageHandler.on('sign', (data) => this.emit('sign', data));
    this.messageHandler.on('error', (error) => this.emit('error', error));
    this.messageHandler.on('message', (message) => this.emit('message', message));
    this.messageHandler.on('close', () => this.closeDialog());
    
    // Forward credential manager events
    this.credentialManager.on('credentials-updated', (data) => this.emit('credentials-updated', data));
    this.credentialManager.on('credentials-synced', (data) => this.emit('credentials-synced', data));
  }

  /**
   * Open dialog for a specific action
   */
  async openDialog(action: DialogAction): Promise<void> {
    this.action = action;
    await this.uiManager.openDialog(action);
    
    // Update credential manager with the iframe reference
    this.credentialManager.setIframeRef(this.uiManager.getIframeRef());
    
    // Try to sync credentials immediately if possible
    setTimeout(() => this.syncCredentials(true), 1000);
  }
  
  /**
   * Check if the device is mobile
   */
  isMobileDevice(): boolean {
    return this.uiManager.isMobileDevice();
  }
  
  /**
   * Check if the browser is Safari
   */
  isSafari(): boolean {
    return this.uiManager.isSafari();
  }
  
  /**
   * Check if popup should be used
   */
  shouldUsePopup(action: DialogAction): boolean {
    return this.uiManager.shouldUsePopup(action);
  }
  
  /**
   * Close any open dialog or popup
   */
  closeDialog(): void {
    console.log('💡 CommunicationHandler.closeDialog called');
    this.uiManager.closeDialog();
    this.action = null;
    console.log('💡 CommunicationHandler.closeDialog complete, action cleared');
    this.emit('dialog-closed');
  }

  /**
   * Notify credential update
   */
  notifyCredentialsUpdated(credentials: { credentialId: string; publicKey: string; timestamp: string | number }): void {
    this.credentialManager.notifyCredentialsUpdated(credentials);
  }
  
  /**
   * Sync credentials with iframe
   */
  syncCredentials(force = false): boolean {
    // Update credential manager with the current iframe reference
    this.credentialManager.setIframeRef(this.uiManager.getIframeRef());
    return this.credentialManager.syncCredentials(force);
  }

  /**
   * Initialize handlers
   */
  initialize(): void {
    this.messageHandler.initialize();
    this.logger.debug('Initialized communication handler');
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;
    
    this.isDestroyed = true;
    
    // Destroy all modules
    this.uiManager.destroy();
    this.messageHandler.destroy();
    this.credentialManager.destroy();
    
    // Clean up event emitter
    this.removeAllListeners();
    
    this.logger.debug('Destroyed communication handler');
  }
}
