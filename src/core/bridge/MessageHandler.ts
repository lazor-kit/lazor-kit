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
        this.logger.debug('Received response for request', { requestId, data });
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        dialogManager.off('connect', handleResponse);
        dialogManager.off('sign', handleResponse);
        dialogManager.off('error', handleError);
        dialogManager.off('message', handleMessageEvent);
        
        // Add credentials to localStorage if they're in the response
        if (data?.publicKey || data?.credentialId) {
          this.logger.debug('Storing credentials from response', { 
            hasPublicKey: !!data.publicKey, 
            hasCredentialId: !!data.credentialId 
          });
          
          if (data.publicKey) {
            localStorage.setItem('PUBLIC_KEY', data.publicKey);
          }
          
          if (data.credentialId) {
            localStorage.setItem('CREDENTIAL_ID', data.credentialId);
          }
        }
        
        resolve(data as T);
      };

      const handleError = (error: Error) => {
        this.logger.debug('Received error for request', { requestId, error });
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        dialogManager.off('connect', handleResponse);
        dialogManager.off('sign', handleResponse);
        dialogManager.off('error', handleError);
        dialogManager.off('message', handleMessageEvent);
        reject(error);
      };
      
      // Handle raw message events from popup/iframe
      const handleMessageEvent = (messageEvent: any) => {
        this.logger.debug('Received raw message event', { messageEvent });
        
        // Check if this is a response to our request
        if (messageEvent?.id === requestId || 
            (messageEvent?.type === 'WALLET_CONNECTED' || messageEvent?.type === 'SIGNATURE_CREATED')) {
          
          // Extract data from message event
          let responseData = messageEvent.data || messageEvent;
          
          // Handle wallet connected message
          if (messageEvent.type === 'WALLET_CONNECTED') {
            responseData = {
              publicKey: messageEvent.data?.publickey,
              credentialId: messageEvent.data?.credentialId,
              isCreated: messageEvent.data?.connectionType === 'create',
              timestamp: messageEvent.data?.timestamp,
              connectionType: messageEvent.data?.connectionType
            };
            
            this.logger.debug('Processed WALLET_CONNECTED message', responseData);
          }
          
          handleResponse(responseData);
        }
      };

      // Listen for both connect and sign events
      dialogManager.on('connect', handleResponse);
      dialogManager.on('sign', handleResponse);
      dialogManager.on('error', handleError);
      dialogManager.on('message', handleMessageEvent);
      
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