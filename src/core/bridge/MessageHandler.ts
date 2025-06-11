import { EventEmitter } from 'eventemitter3';
import { generateId } from '../../utils/encoding';
import { DialogManager } from '../dialog/DialogManager';
import { Logger } from '../../utils/logger';
import { BaseResponse } from '../../types/responses';

export class MessageHandler extends EventEmitter {
  private logger = new Logger('MessageHandler');
  private pendingRequests = new Map<string, { resolve: (response: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();

  constructor() {
    super();
    this.handleResponse = this.handleResponse.bind(this);
  }

  async request<T>(dialogManager: DialogManager, request: { method: string; params?: any }, timeout = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = generateId();
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId
      });

      // Create request message with dialog expected format
      const message = {
        id: requestId,
        ...request,
        timestamp: Date.now()
      };
      
      this.logger.debug('Sending request', message);

      // Listen for response
      const handleResponse = (data: any) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        dialogManager.off('connect', handleResponse);
        dialogManager.off('sign', handleResponse);
        dialogManager.off('error', handleError);
        resolve(data as T);
      };

      const handleError = (error: Error) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        dialogManager.off('connect', handleResponse);
        dialogManager.off('sign', handleResponse);
        dialogManager.off('error', handleError);
        reject(error);
      };

      // Listen for both connect and sign events
      dialogManager.on('connect', handleResponse);
      dialogManager.on('sign', handleResponse);
      dialogManager.on('error', handleError);
      
      // Send message through dialog
      dialogManager.emit('message', message);
    });
  }

  private handleResponse(response: any): void {
    // Find pending request and resolve
    for (const [requestId, { resolve, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      this.pendingRequests.delete(requestId);
      resolve(response);
      return;
    }
  }

  destroy(): void {
    this.removeAllListeners();
    this.pendingRequests.clear();
  }
}