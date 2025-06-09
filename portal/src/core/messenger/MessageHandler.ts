import { v4 as uuidv4 } from 'uuid';
import { PasskeyManager } from '../passkey';
import { Logger } from '../utils';
import type { 
  BaseMessage, 
  ConnectRequest, 
  ConnectResponse,
  SignRequest,
  SignResponse 
} from '../../types';
import { Buffer } from 'buffer';

/**
 * Handles communication between the portal and the parent SDK
 */
export class MessageHandler {
  private passkeyManager: PasskeyManager;
  private logger: Logger;
  private parentOrigin: string | null = null;
  private processingStart: number = 0;
  public pendingConnectRequest: ConnectRequest | null = null;
  
  /**
   * Initialize the message handler
   */
  constructor() {
    this.passkeyManager = new PasskeyManager();
    this.logger = new Logger('MessageHandler');
    
    this.setupMessageListener();
    
    // Send ready messages with progressive delays to ensure they're received
    this.sendReadyMessage(); // First one immediately
    setTimeout(() => this.sendReadyMessage(), 300); // Second after 300ms
    setTimeout(() => this.sendReadyMessage(), 800); // Third after 800ms
  }
  
  /**
   * Sets up the message event listeners for communication with parent window
   */
  private setupMessageListener(): void {
    this.logger.debug('Setting up message listener');
    
    // Add main message listener with proper binding
    window.addEventListener('message', this.handleMessage.bind(this));
    
    // Add backup global listener to ensure we don't miss any messages
    window.addEventListener('message', (event) => {
      try {
        this.handleMessage(event);
      } catch (e) {
        this.logger.error('Error in global message handler:', e);
      }
    });
  }
  
  /**
   * Handles incoming messages from the parent window (SDK)
   * @param event The message event to process
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      this.logger.debug(`Received message from origin: ${event.origin}`);
      
      // Store parent origin from the event for response routing
      // This is important for cross-origin communication compatibility
      this.parentOrigin = event.origin;
      
      const message = event.data;
      this.processingStart = Date.now();
      
      // Process message based on its type
      switch (message.type) {
        case 'passkey:connect':
          await this.handleConnectRequest(message as ConnectRequest);
          break;
          
        case 'passkey:sign':
          await this.handleSignRequest(message as SignRequest);
          break;
          
        case 'dialog:init':
          // If there's a pending connect request, process it immediately
          if (this.pendingConnectRequest) {
            this.logger.info('Processing pending connect request after initialization');
            this.processConnect().catch(err => {
              this.logger.error('Error processing connect after init:', err);
            });
          } else {
            // No pending request, dispatch an event for UI to handle
            window.dispatchEvent(new CustomEvent('dialog:initialized', { 
              detail: { timestamp: Date.now(), origin: this.parentOrigin } 
            }));
          }
          break;
          
        default:
          // Handle any other message type
          this.logger.warn('Unknown message type:', message.type);
          // Dispatch a generic message event that UI components can listen to
          window.dispatchEvent(new CustomEvent('message:received', { 
            detail: { message, origin: this.parentOrigin } 
          }));
      }
    } catch (error) {
      this.logger.error('Error handling message:', error);
      this.sendError(error as Error, event.data?.id);
    }
  }
  
  private async handleConnectRequest(request: ConnectRequest): Promise<void> {
    this.pendingConnectRequest = request;
    this.logger.debug('Received connect request, waiting for user interaction');
    
    const event = new CustomEvent('connect:request', { detail: request });
    window.dispatchEvent(event);
  }
  
  public async processConnect(): Promise<void> {
    if (!this.pendingConnectRequest) {
      throw new Error('No pending connect request');
    }
    
    const request = this.pendingConnectRequest;
    const { origin, challenge } = request.data;
    this.processingStart = Date.now();
    this.logger.debug('Processing connect request:', { requestId: request.id, origin });
    console.log('🔄 Processing connect request', { requestId: request.id, origin });
    
    try {
      const result = await this.passkeyManager.connectWithChallenge(
        origin,
        Buffer.from(challenge, 'base64')
      );
      
      const response: ConnectResponse = {
        id: uuidv4(),
        type: 'passkey:connect:response',
        requestId: request.id,
        timestamp: Date.now(),
        version: '1.0',
        source: 'dialog',
        duration: Date.now() - this.processingStart,
        data: {
          publicKey: result.publicKey,
          credentialId: result.credentialId,
          isCreated: result.isCreated,
          signature: result.signature
        }
      };
      
      this.logger.debug('Sending successful connect response:', { requestId: request.id });
      console.log('✅ Sending successful connect response', { requestId: request.id, response });
      
      this.sendMessage(response);
      
      // Clear the pending request
      this.pendingConnectRequest = null;
      
      // Dispatch success event for UI
      window.dispatchEvent(new CustomEvent('connect:success', { detail: response }));
      
    } catch (error: any) {
      this.logger.error('Connect error:', error);
      console.error('❌ Connect error:', error);
      
      const response: ConnectResponse = {
        id: uuidv4(),
        type: 'passkey:connect:response',
        requestId: request.id,
        timestamp: Date.now(),
        version: '1.0',
        source: 'dialog',
        duration: Date.now() - this.processingStart,
        error: {
          code: error.code || 'CONNECT_FAILED',
          message: error.message,
          details: {
            step: error.step || 'unknown',
            timestamp: Date.now()
          }
        }
      };
      
      // Send response directly to parent using postMessage
      this.logger.debug('Sending error connect response:', { requestId: request.id });
      console.log('❌ Sending error connect response', { requestId: request.id, response });
      
      this.sendMessage(response);
      
      this.pendingConnectRequest = null;
      
      // Dispatch error event for UI
      window.dispatchEvent(new CustomEvent('connect:error', { detail: response }));
    }
  }
  
  private async handleSignRequest(request: SignRequest): Promise<void> {
    const { origin, message, description } = request.data;
    
    try {
      // Sign message
      const result = await this.passkeyManager.signMessage(
        origin,
        Buffer.from(message, 'base64'),
        description
      );
      
      // Send success response
      const response: SignResponse = {
        id: uuidv4(),
        type: 'passkey:sign:response',
        requestId: request.id,
        timestamp: Date.now(),
        version: '1.0',
        source: 'dialog',
        duration: Date.now() - this.processingStart,
        data: {
          authenticatorData: result.authenticatorData,
          clientDataJSON: result.clientDataJSON,
          rawMessage: message,
          clientDataJSONDigest: result.clientDataJSONDigest,
          signature: result.signature,
          nonce: result.nonce,
          timestamp: result.timestamp
        }
      };
      
      this.sendMessage(response);
      
    } catch (error: any) {
      const response: SignResponse = {
        id: uuidv4(),
        type: 'passkey:sign:response',
        requestId: request.id,
        timestamp: Date.now(),
        version: '1.0',
        source: 'dialog',
        duration: Date.now() - this.processingStart,
        error: {
          code: error.code || 'SIGN_FAILED',
          message: error.message,
          details: error.details
        }
      };
      
      this.sendMessage(response);
    }
  }
  
  /**
   * Send a message to the parent window (SDK)
   * @param message The message to send
   */
  private sendMessage(message: BaseMessage): void {
    if (!this.parentOrigin) {
      this.logger.error('No parent origin set');
      return;
    }
    
    this.logger.debug('Sending message:', message);
    
    try {
      // Always use wildcard origin ('*') for cross-origin popups and iframes
      // This is critical for proper communication between different origins
      // as required by the memory information about cross-origin communication
      
      if (window.opener) {
        // Popup window mode
        window.opener.postMessage(message, '*');
      } else if (window.parent !== window) {
        // Iframe mode
        window.parent.postMessage(message, '*');
      } else {
        throw new Error('Not in iframe or popup context');
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }
  
  private sendReadyMessage(): void {
    // Send ready to all origins using both popup and iframe methods
    const readyMessage = {
      id: uuidv4(),  // Add unique ID to each ready message
      type: 'READY',
      timestamp: Date.now(),
      version: '1.0',
      source: 'dialog'
    };
    
    // Try all possible communication channels
    console.log('📤 Sending READY message to all possible contexts');
    
    // For iframe context
    if (window.parent !== window) {
      console.log('🔄 Sending READY via window.parent (iframe mode)');
      window.parent.postMessage(readyMessage, '*');
    }
    
    // For popup context
    if (window.opener) {
      console.log('🔄 Sending READY via window.opener (popup mode)');
      window.opener.postMessage(readyMessage, '*');
    }
    
    // If we're in neither context, try direct broadcast as fallback
    if (!window.opener && window.parent === window) {
      console.log('🔄 Sending READY via broadcast (fallback mode)');
      window.postMessage(readyMessage, '*');
    }
    
    // Also dispatch custom event on window to notify any local listeners
    window.dispatchEvent(new CustomEvent('portal:ready', { 
      detail: { timestamp: Date.now() } 
    }));
  }
  
  private sendError(error: Error, requestId?: string): void {
    if (!requestId) return;
    
    const response = {
      id: uuidv4(),
      type: 'error',
      requestId,
      timestamp: Date.now(),
      version: '1.0',
      source: 'dialog',
      error: {
        code: 'UNKNOWN_ERROR',
        message: error.message
      }
    };
    
    // Send using appropriate method based on context
    console.log('❌ Sending error response', response);
    
    try {
      // Check if this is a popup window or iframe
      if (window.opener) {
        // If this is a popup window
        console.log('🔄 Sending error via window.opener (popup mode)');
        window.opener.postMessage(response, '*');
      } else if (window.parent !== window) {
        // If this is an iframe
        console.log('🔄 Sending error via window.parent (iframe mode)');
        window.parent.postMessage(response, '*');
      }
    } catch (err) {
      console.error('Failed to send error message:', err);
    }
  }
  
  destroy(): void {
    window.removeEventListener('message', this.handleMessage);
  }
}