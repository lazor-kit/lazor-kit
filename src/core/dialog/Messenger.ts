// src/core/dialog/Messenger.ts
import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../utils/logger';
import { generateId } from '../../utils/encoding';

interface MessengerConfig {
  target: Window;
  origin: string;
  onMessage: (message: any) => void;
  onError?: (error: Error) => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
}

export class Messenger extends EventEmitter {
  private target: Window;
  private origin: string;
  private pendingRequests = new Map<string, PendingRequest>();
  private logger = new Logger('Messenger');
  private messageHandler: (event: MessageEvent) => void;
  private isDestroyed = false;

  constructor(config: MessengerConfig) {
    super();
    
    this.target = config.target;
    this.origin = config.origin;
    
    // Create message handler
    this.messageHandler = (event: MessageEvent) => {
      this.handleMessage(event);
    };
    
    // Listen for messages
    window.addEventListener('message', this.messageHandler);
    
    // Forward messages to config handler
    this.on('message', config.onMessage);
    
    // Forward errors
    if (config.onError) {
      this.on('error', config.onError);
    }
    
    this.logger.debug('Messenger initialized', { origin: this.origin });
  }

  private handleMessage(event: MessageEvent): void {
    // Validate origin
    if (event.origin !== this.origin) {
      return;
    }
    
    const message = event.data;
    
    // Validate message structure
    if (!message || typeof message !== 'object') {
      return;
    }
    
    this.logger.debug('Received message', message);
    
    // Check if this is a response
    if (message.responseId) {
      const pending = this.pendingRequests.get(message.responseId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.responseId);
        
        if (message.error) {
          pending.reject(new Error(message.error.message || message.error));
        } else {
          pending.resolve(message);
        }
        return;
      }
    }
    
    // Emit as regular message
    this.emit('message', message);
  }

  async send(message: any, timeout = 30000): Promise<any> {
    if (this.isDestroyed) {
      throw new Error('Messenger is destroyed');
    }
    
    return new Promise((resolve, reject) => {
      const id = generateId();
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Message timeout after ${timeout}ms`));
      }, timeout);
      // Store pending request
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout: timeoutId
      });
      
      // Build message
      const fullMessage = {
        ...message,
        id,
        timestamp: Date.now(),
        source: 'parent',
        version: '1.0'
      };
      console.log(fullMessage)
      // Send message
      try {
        this.target.postMessage(fullMessage, this.origin);
        this.logger.debug('Sent message', fullMessage);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  destroy(): void {
    if (this.isDestroyed) return;
    
    this.isDestroyed = true;
    
    // Remove event listener
    window.removeEventListener('message', this.messageHandler);
    
    // Clear all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Messenger destroyed'));
    }
    this.pendingRequests.clear();
    
    // Remove all event listeners
    this.removeAllListeners();
    
    this.logger.debug('Messenger destroyed');
  }
}