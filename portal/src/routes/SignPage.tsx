import { useState } from 'react';
import { useQueryParams } from '../hooks/useQueryParams';
import PasskeyPrompt from '../components/PasskeyPrompt';
import OriginWarning from '../components/OriginWarning';

export default function SignPage() {
  const { origin, message, description, requestId } = useQueryParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSign = async () => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // PassKey signing is handled by MessageHandler
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleCancel = () => {
    // Ensure we use wildcard origin for cross-origin communication
    window.parent.postMessage({
      type: 'passkey:sign:response',
      requestId,
      timestamp: Date.now(),
      version: '1.0',
      source: 'dialog',
      error: {
        code: 'USER_CANCELLED',
        message: 'User cancelled the signing operation'
      }
    }, '*');
    
    // Add a small delay before closing to ensure message delivery
    setTimeout(() => {
      window.close();
    }, 300);
  };
  
  if (isProcessing) {
    return (
      <div className="loader-container">
        <div className="loader"></div>
        <p className="loader-text">Processing signature request...</p>
      </div>
    );
  }
  
  return (
    <div className="sign-page">
      <OriginWarning origin={origin ? origin : undefined} />
      
      <div className="card transaction-card">
        <h2 className="passkey-title">Signature Request</h2>
        <p className="passkey-description">{description || 'Please review and sign'}</p>
        
        <div className="message-preview">
          {message ? (
            <>
              <div className="message-label">Data to sign:</div>
              <div className="message-content">
                {message.length > 40 ? `${message.substring(0, 40)}...` : message}
              </div>
            </>
          ) : (
            <div className="message-placeholder">No message data provided</div>
          )}
        </div>
      </div>
      
      <PasskeyPrompt
        action="sign"
        origin={origin ? origin : undefined}
        onConfirm={handleSign}
        onCancel={handleCancel}
      />
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}