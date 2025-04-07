import React, { useState, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useSmartWallet } from '../hooks/useSmartWallet';
import styles from './WalletDisplay.css';

interface LazorConnectProps {
  onSignMessage?: (base64Tx: string) => Promise<void>;
}

export const LazorConnect: React.FC<LazorConnectProps> = ({ onSignMessage }) => {
  const { 
    isConnected, 
    isLoading, 
    error, 
    credentialId, 
    publicKey,
    connect, 
    disconnect,
    signMessage
  } = useWallet();

  const {
    smartWalletAddress,
    isLoading: isSmartWalletLoading,
    error: smartWalletError,
    createSmartWallet
  } = useSmartWallet();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (isConnected) {
      setIsOpen(!isOpen);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  const handleSignMessage = async (base64Tx: string) => {
    if (onSignMessage) {
      await onSignMessage(base64Tx);
    } else {
      await signMessage(base64Tx);
    }
  };

  React.useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="lazor-connect">
      {isConnected ? (
        <div 
          ref={containerRef}
          className="wallet-info"
        >
          <div 
            className="wallet-address"
            onClick={handleClick}
          >
            {credentialId?.slice(0, 4)}...{credentialId?.slice(-4)}
          </div>
          {isOpen && (
            <div className="disconnect-container">
              {!smartWalletAddress && (
                <button 
                  onClick={createSmartWallet}
                  disabled={isSmartWalletLoading}
                  className="create-smart-wallet-button"
                >
                  {isSmartWalletLoading ? 'Creating...' : 'Create Smart Wallet'}
                </button>
              )}
              {smartWalletAddress && (
                <div className="smart-wallet-info">
                  <div className="smart-wallet-label">Smart Wallet:</div>
                  <div className="smart-wallet-address">
                    {smartWalletAddress.slice(0, 6)}...{smartWalletAddress.slice(-4)}
                  </div>
                </div>
              )}
              <button 
                onClick={disconnect}
                className="disconnect-button"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <button 
          onClick={connect}
          disabled={isLoading}
          className={`connect-button ${isLoading ? 'loading' : ''}`}
        >
          {isLoading ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {(error || smartWalletError) && (
        <div className="error-message">
          {error || smartWalletError}
        </div>
      )}
    </div>
  );
}; 