interface PasskeyPromptProps {
  action: 'connect' | 'sign';
  origin?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PasskeyPrompt({ action, origin, onConfirm, onCancel }: PasskeyPromptProps) {
  const getActionText = () => {
    switch (action) {
      case 'connect':
        return 'Connect with Passkey';
      case 'sign':
        return 'Sign with Passkey';
      default:
        return 'Continue with Passkey';
    }
  };
  
  const getDescription = () => {
    switch (action) {
      case 'connect':
        return 'Use your device\'s biometric authentication to connect securely.';
      case 'sign':
        return 'Confirm this action using your device\'s biometric authentication.';
      default:
        return '';
    }
  };
  
  return (
    <div className="passkey-prompt">
      <div className="card-header">
        <h2 className="passkey-title">{getActionText()}</h2>
        <p className="passkey-description">{getDescription()}</p>
      </div>
      
      {/* Simplified design - no icon */}
      
      {origin && (
        <div className="origin-info">
          <span className="origin-text">{new URL(origin).hostname}</span>
        </div>
      )}
      
      <div className="action-buttons">
        <button onClick={onCancel} className="button button-secondary">Cancel</button>
        <button onClick={onConfirm} className="button">Continue</button>
      </div>
    </div>
  );
}