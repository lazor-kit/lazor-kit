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
    this.handler.on('message', (message) => this.emit('message', message));
  }

  /**
   * Open connect dialog
   */
  async connect(): Promise<void> {
    await this.handler.openDialog('connect');
  }

  /**
   * Open sign dialog
   */
  async sign(): Promise<void> {
    await this.handler.openDialog('sign');
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
    this.emit('connect', data);
  }

  private handleSign(data: any): void {
    this.logger.debug('Sign success:', data);
    this.emit('sign', data);
  }

  private handleError(error: Error): void {
    this.logger.error('Dialog error:', error);
    this.emit('error', error);
  }

}