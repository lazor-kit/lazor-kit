import React, { useState, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import './WalletDisplay.css';
import { Connection } from '@solana/web3.js';

interface LazorConnectProps {
  connection: Connection;
  onSignMessage?: (base64Tx: string) => Promise<void>;
  onConnect?: (publicKey: string) => void;
  onDisconnect?: () => void;
}

export const LazorConnect: React.FC<LazorConnectProps> = ({ connection, onSignMessage, onConnect, onDisconnect }) => {
  const {
    isConnected,
    isLoading,
    error,
    smartWalletAuthorityPubkey,
    publicKey,
    connect,
    disconnect,
    signMessage
  } = useWallet({ connection });

  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleConnect = async () => {
    try {
      await connect();
      if (publicKey && onConnect) {
        onConnect(publicKey);
      }
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  };

  const handleDisconnect = async () => {
    disconnect();
    if (onDisconnect) {
      onDisconnect();
    }
  }

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

  const handleCopyAddress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (smartWalletAuthorityPubkey) {
      try {
        await navigator.clipboard.writeText(smartWalletAuthorityPubkey);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
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
            <div className="wallet-address-content">
              <span className="address-text">
                {smartWalletAuthorityPubkey?.slice(0, 4)}...{smartWalletAuthorityPubkey?.slice(-4)}
              </span>
              <button
                className={`copy-button ${isCopied ? 'copied' : ''}`}
                onClick={handleCopyAddress}
                title={isCopied ? "Copied!" : "Copy address"}
              >
                {isCopied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                )}
              </button>
            </div>
            <div className="wallet-dropdown-arrow">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          {isOpen && (
            <div className="disconnect-container">
              <button
                onClick={handleDisconnect}
                className="disconnect-button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Disconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={isLoading}
          className={`connect-button ${isLoading ? 'loading' : ''}`}
        >
          {isLoading ? (
            <span className="loading-spinner"></span>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              Connect Wallet
            </>
          )}
        </button>
      )}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}; 