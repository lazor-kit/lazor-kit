// src/core/bridge/MessageHandler.ts
import { EventEmitter } from 'eventemitter3';
import { DialogInstance, ResponseMessage } from '../../types';
import { generateId } from '../../utils/encoding';
import { Logger } from '../../utils/logger';

export class MessageHandler extends EventEmitter {
  private logger = new Logger('MessageHandler');

  async request<T = any>(
    dialog: DialogInstance,
    request: { method: string; params?: any }
  ): Promise<ResponseMessage & { data?: T }> {
    const requestId = generateId();
    
    // Create request message
    const message = {
      id: requestId,
      type: 'request',
      method: request.method,
      params: request.params,
      timestamp: Date.now(),
      version: '1.0',
      source: 'parent'
    };
    
    this.logger.debug('Sending request', message);
    
    // Send and wait for response
    const response = await dialog.send(message);
    
    this.logger.debug('Received response', response);
    
    return response;
  }

  destroy(): void {
    this.removeAllListeners();
  }
}