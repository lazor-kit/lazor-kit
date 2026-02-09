import { useWallet } from '@lazorkit/wallet';
import { useState, useEffect } from 'react';

export function WalletConnect() {
  const { connect, disconnect, isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-reconnect on mount if session exists
  useEffect(() => {
    if (!isConnected) {
      connect().catch(() => {
        // Silent fail on auto-reconnect
      });
    }
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await connect();
      console.log('✅ Wallet connected successfully!');
    } catch (err) {
      console.error('Connection error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      console.log('👋 Wallet disconnected');
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  // Connected State
  if (isConnected && publicKey) {
    const address = publicKey.toString();
    const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;

    return (
      <div className="wallet-connected">
        <div className="wallet-info">
          <div className="status-indicator connected" />
          <div>
            <p className="label">Connected</p>
            <p className="address" title={address}>
              {shortAddress}
            </p>
          </div>
        </div>
        <button onClick={handleDisconnect} className="btn btn-secondary">
          Disconnect
        </button>
      </div>
    );
  }

  // Disconnected State
  return (
    <div className="wallet-connect">
      <h2>Connect Your Wallet</h2>
      <p className="description">
        Use your device biometrics (FaceID, TouchID, or Windows Hello) to securely access your wallet.
      </p>
      
      <button 
        onClick={handleConnect} 
        disabled={loading}
        className="btn btn-primary"
      >
        {loading ? (
          <>
            <span className="spinner" />
            Connecting...
          </>
        ) : (
          <>
            🔐 Connect with Passkey
          </>
        )}
      </button>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
