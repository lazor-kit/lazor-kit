import { Credential } from "./storage";

export interface SyncMessage {
  type: 'SYNC_CREDENTIALS' | 'CREDENTIALS_REQUEST' | 'CREDENTIALS_RESPONSE' | 'SYNC_CREDENTIALS_ACK';
  data?: {
    credentialId: string;
    publickey: string;  // Note: lowercase 'k' to match parent's format
    smartWalletAddress?: string;
    timestamp?: number;
  };
  requestId?: string;
}

// Check if we're in an iframe
export const isIframe = () => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true; // If we can't access window.top, we're probably in iframe
  }
};

// Request credentials from parent window for immediate use (no localStorage sync)
export const requestCredentialsFromParent = (
  maxRetries = 3,
  onProgress?: (message: string, attempt?: number) => void
): Promise<Credential & { smartWalletAddress?: string } | null> => {
  return new Promise((resolve) => {
    if (!isIframe()) {
      resolve(null);
      return;
    }

    const messageId = `credential-request-${Date.now()}`;
    let retryCount = 0;
    let timeoutId: NodeJS.Timeout;

    const handleResponse = (event: MessageEvent<SyncMessage>) => {
      // Handle both direct SYNC_CREDENTIALS and response to our request
      if ((event.data?.type === 'SYNC_CREDENTIALS' || 
           event.data?.type === 'CREDENTIALS_RESPONSE') && 
          event.data.data) {
        
        // Send acknowledgment back to parent
        try {
          window.parent.postMessage({
            type: 'SYNC_CREDENTIALS_ACK',
            requestId: event.data.requestId || messageId,
            timestamp: Date.now()
          }, '*');
        } catch (e) {
          console.warn('Failed to send sync acknowledgment:', e);
        }

        // Clean up and resolve
        clearTimeout(timeoutId);
        window.removeEventListener('message', handleResponse);
        
        const { credentialId, publickey, smartWalletAddress } = event.data.data;
        if (credentialId) {
          onProgress?.('Credentials synced successfully!');
          resolve({
            credentialId,
            publicKey: publickey || '',
            smartWalletAddress
          });
        } else {
          onProgress?.('No valid credentials received');
          resolve(null);
        }
      }
    };

    const sendRequest = () => {
      if (retryCount > 0) {
        onProgress?.(`Retrying sync (${retryCount}/${maxRetries})...`, retryCount);
        console.log(`🔁 Retrying credential request (attempt ${retryCount}/${maxRetries})`);
      } else {
        onProgress?.('Requesting credentials from parent...');
      }

      // Set up listener for the response
      window.addEventListener('message', handleResponse);

      // Request credentials from parent
      try {
        window.parent.postMessage({
          type: 'CREDENTIALS_REQUEST',
          requestId: messageId,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Error sending credential request:', error);
        onProgress?.('Failed to send credential request');
      }

      // Set timeout for next retry or final resolution
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Reduced max delay
        timeoutId = setTimeout(() => {
          retryCount++;
          window.removeEventListener('message', handleResponse);
          sendRequest();
        }, delay);
      } else {
        // Final timeout
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', handleResponse);
          console.warn('Timed out waiting for credentials from parent');
          onProgress?.('Timed out waiting for credentials from parent');
          resolve(null);
        }, 3000); // Reduced timeout
      }
    };

    // Start the first request
    sendRequest();
  });
};

// Request credentials from parent window for signing operations
export const requestSigningCredentialsFromParent = (
  maxRetries = 3,
  onProgress?: (message: string, attempt?: number) => void
): Promise<Credential & { smartWalletAddress?: string } | null> => {
  return new Promise((resolve) => {
    if (!isIframe()) {
      resolve(null);
      return;
    }

    const messageId = `signing-credential-request-${Date.now()}`;
    let retryCount = 0;
    let timeoutId: NodeJS.Timeout;

    const handleResponse = (event: MessageEvent<SyncMessage>) => {
      // Handle both direct SYNC_CREDENTIALS and response to our request
      if ((event.data?.type === 'SYNC_CREDENTIALS' || 
           event.data?.type === 'CREDENTIALS_RESPONSE') && 
          event.data.data) {
        
        // Send acknowledgment back to parent
        try {
          window.parent.postMessage({
            type: 'SYNC_CREDENTIALS_ACK',
            requestId: event.data.requestId || messageId,
            timestamp: Date.now()
          }, '*');
        } catch (e) {
          console.warn('Failed to send sync acknowledgment:', e);
        }

        // Clean up and resolve
        clearTimeout(timeoutId);
        window.removeEventListener('message', handleResponse);
        
        const { credentialId, publickey, smartWalletAddress } = event.data.data;
        if (credentialId) {
          onProgress?.('Credentials synced successfully!');
          resolve({
            credentialId,
            publicKey: publickey || '',
            smartWalletAddress
          });
        } else {
          onProgress?.('No valid credentials received');
          resolve(null);
        }
      }
    };

    const sendRequest = () => {
      if (retryCount > 0) {
        onProgress?.(`Retrying sync (${retryCount}/${maxRetries})...`, retryCount);
        console.log(`🔁 Retrying signing credential request (attempt ${retryCount}/${maxRetries})`);
      } else {
        onProgress?.('Requesting signing credentials from parent...');
      }

      // Set up listener for the response
      window.addEventListener('message', handleResponse);

      // Request credentials from parent
      try {
        window.parent.postMessage({
          type: 'CREDENTIALS_REQUEST',
          requestId: messageId,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Error sending signing credential request:', error);
        onProgress?.('Failed to send signing credential request');
      }

      // Set timeout for next retry or final resolution
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Reduced max delay
        timeoutId = setTimeout(() => {
          retryCount++;
          window.removeEventListener('message', handleResponse);
          sendRequest();
        }, delay);
      } else {
        // Final timeout
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', handleResponse);
          console.warn('Timed out waiting for signing credentials from parent');
          onProgress?.('Timed out waiting for signing credentials from parent');
          resolve(null);
        }, 3000); // Reduced timeout
      }
    };

    // Start the first request
    sendRequest();
  });
};

// Handle credential requests from iframe
export const setupCredentialSyncHandler = (getCredentials: () => Credential[]) => {
  if (typeof window === 'undefined') return () => {};

  const handleMessage = async (event: MessageEvent<SyncMessage>) => {
    try {
      // Handle credential sync acknowledgment
      if (event.data?.type === 'SYNC_CREDENTIALS_ACK') {
        console.log('Received credential sync acknowledgment:', event.data);
        return;
      }

      // Only handle our message types
      if (!['CREDENTIALS_REQUEST', 'SYNC_CREDENTIALS'].includes(event.data?.type)) {
        return;
      }

      const { type, requestId } = event.data;
      const credentials = getCredentials();
      
      if (credentials.length === 0) {
        console.warn('No credentials available to sync');
        return;
      }

      // Always use the first credential for now
      const credential = credentials[0];
      const response: SyncMessage = {
        type: type === 'CREDENTIALS_REQUEST' 
          ? 'CREDENTIALS_RESPONSE' 
          : 'SYNC_CREDENTIALS',
        requestId,
        data: {
          credentialId: credential.credentialId,
          publickey: credential.publicKey, // Match parent's format (lowercase 'k')
          timestamp: Date.now()
        }
      };

      console.log('Sending credentials to iframe:', response);

      // Send back to the source with retry logic
      const sendResponse = (attempt = 0, maxAttempts = 3) => {
        try {
          event.source?.postMessage(response, {
            targetOrigin: '*'
          });
          
          // Schedule next attempt if needed
          if (attempt < maxAttempts - 1) {
            setTimeout(() => sendResponse(attempt + 1, maxAttempts), 500 * (attempt + 1));
          }
        } catch (error) {
          console.error(`Error sending credentials (attempt ${attempt + 1}):`, error);
          if (attempt < maxAttempts - 1) {
            setTimeout(() => sendResponse(attempt + 1, maxAttempts), 500 * (attempt + 1));
          }
        }
      };

      // Start sending response with retries
      sendResponse();
      
    } catch (error) {
      console.error('Error handling credential sync message:', error);
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
};
