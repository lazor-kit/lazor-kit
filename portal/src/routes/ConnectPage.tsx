import { useState, useEffect, useRef } from 'react';
import { useQueryParams } from '../hooks/useQueryParams';
import PasskeyPrompt from '../components/PasskeyPrompt';
import OriginWarning from '../components/OriginWarning';
import { MessageHandler } from '../core/messenger/MessageHandler';

export default function ConnectPage() {
  const { origin, requestId, autoConnect } = useQueryParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const messageHandlerRef = useRef<MessageHandler | null>(null);

  useEffect(() => {
    // Ensure MessageHandler is properly initialized
    const initMessageHandler = () => {
      // Get MessageHandler instance from global scope
      const handler = window.messageHandler as MessageHandler;
      if (handler) {
        messageHandlerRef.current = handler;
        return true;
      }
      
      // If not available, create a new instance
      const newHandler = new MessageHandler();
      window.messageHandler = newHandler;
      messageHandlerRef.current = newHandler;
      return true;
    };
    
    // Initialize MessageHandler
    initMessageHandler();

    // Listen for connect request events
    const handleConnectRequest = () => {
      setShowConnectPrompt(true);
      
      // Auto connect if requested
      if (autoConnect === 'true') {
        setTimeout(() => {
          handleConnect();
        }, 500); // Small delay to allow UI to update
      }
    };
    
    // Listen for connection success/error events
    const handleConnectSuccess = () => {
      setConnectionSuccess(true);
      setIsProcessing(false);
      
      // Keep window open longer to ensure message is delivered
      // The SDK should receive the message and then close the window
      // But as a fallback, we'll close it automatically after a longer delay
      setTimeout(() => {
        window.close();
      }, 3000); // Longer delay to ensure message delivery
    };
    
    const handleConnectError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setError(detail?.error?.message || 'Connection failed');
      setIsProcessing(false);
    };

    window.addEventListener('connect:request', handleConnectRequest);
    window.addEventListener('connect:success', handleConnectSuccess);
    window.addEventListener('connect:error', handleConnectError);

    // Check if there's a pending request already
    if (messageHandlerRef.current?.pendingConnectRequest) {
      setShowConnectPrompt(true);
      
      // Auto connect if requested
      if (autoConnect === 'true') {
        setTimeout(() => {
          handleConnect();
        }, 500); // Small delay to allow UI to update
      }
    }

    return () => {
      window.removeEventListener('connect:request', handleConnectRequest);
      window.removeEventListener('connect:success', handleConnectSuccess);
      window.removeEventListener('connect:error', handleConnectError);
    };
  }, [origin, requestId, autoConnect]);

  const handleConnect = async () => {
    // Double check if MessageHandler exists, and if not, create it
    if (!messageHandlerRef.current) {
      const handler = window.messageHandler as MessageHandler;
      if (handler) {
        messageHandlerRef.current = handler;
      } else {
        const newHandler = new MessageHandler();
        window.messageHandler = newHandler;
        messageHandlerRef.current = newHandler;
      }
      
      // If still not initialized after attempts, show error
      if (!messageHandlerRef.current) {
        setError("MessageHandler could not be initialized");
        return;
      }
    }

    setIsProcessing(true);
    setError(null);

    try {
      // First verify that we have a pending connect request
      if (!messageHandlerRef.current.pendingConnectRequest) {
        // Dispatch a synthetic connect:request event to force request handling
        const syntheticEvent = new CustomEvent('connect:request');
        window.dispatchEvent(syntheticEvent);
        
        // Wait briefly to ensure request is registered
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Check again
        if (!messageHandlerRef.current.pendingConnectRequest) {
          throw new Error('No pending connect request available');
        }
      }
      
      // Process the connection request through MessageHandler
      await messageHandlerRef.current.processConnect();
      // Note: We don't set isProcessing to false here because
      // that will be done by the connect:success or connect:error event handlers
    } catch (err: any) {
      setError(err.message || "Connection failed");
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    // Handle connection cancellation
    if (messageHandlerRef.current?.pendingConnectRequest) {
      const request = messageHandlerRef.current.pendingConnectRequest;

      const cancelResponse = {
        id: crypto.randomUUID(),
        type: 'passkey:connect:response',
        requestId: request.id,
        timestamp: Date.now(),
        version: '1.0',
        source: 'dialog',
        error: {
          code: 'USER_CANCELLED',
          message: 'User cancelled the operation'
        }
      };

      // Send through standard postMessage
      window.parent.postMessage(cancelResponse, origin || '*');
      
      // Clear the pending request
      messageHandlerRef.current.pendingConnectRequest = null;
      
      // Add a small delay before closing
      setTimeout(() => {
        window.close();
      }, 300);
      return;
    }

    // Close dialog immediately if no request
    window.close();
  };

  if (isProcessing) {
    return (
      <div className="loader-container">
        <div className="loader"></div>
        <p className="loader-text">Connecting your wallet...</p>
      </div>
    );
  }
  
  if (connectionSuccess) {
    return (
      <div className="card success-card">
        <h2 className="passkey-title">Connection Successful</h2>
        <p className="passkey-description">Connection established securely</p>
      </div>
    );
  }

  return (
    <div className="connect-page">
      <OriginWarning origin={origin ? origin : undefined} />

      {showConnectPrompt ? (
        <PasskeyPrompt
          action="connect"
          origin={origin ? origin : undefined}
          onConfirm={handleConnect}
          onCancel={handleCancel}
        />
      ) : (
        <div className="card">
          <div className="loader-container">
            <div className="loader"></div>
            <p className="loader-text">Waiting for connection request...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}