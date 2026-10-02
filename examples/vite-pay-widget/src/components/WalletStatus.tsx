import { useWallet } from '@lazorkit/wallet';
import { useEffect, useState } from 'react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

export function WalletStatus() {
  const { publicKey, isConnected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !publicKey) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const connection = new Connection(
          import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com',
          'confirmed'
        );
        
        const lamports = await connection.getBalance(publicKey);
        setBalance(lamports / LAMPORTS_PER_SOL);
      } catch (err) {
        console.error('Failed to fetch balance:', err);
        setError('Failed to load balance');
      } finally {
        setLoading(false);
      }
    };

    fetchBalance();

    // Refresh balance every 10 seconds
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [publicKey, isConnected]);

  if (!isConnected || !publicKey) {
    return null;
  }

  const address = publicKey.toString();
  const cluster = import.meta.env.VITE_CLUSTER || 'devnet';
  const explorerUrl = `https://explorer.solana.com/address/${address}?cluster=${cluster}`;

  return (
    <div className="wallet-status">
      <h2>Wallet Information</h2>
      
      <div className="info-grid">
        <div className="info-item">
          <label>Address</label>
          <div className="value">
            <code className="address-full">{address}</code>
            <button
              onClick={() => navigator.clipboard.writeText(address)}
              className="btn-icon"
              title="Copy address"
            >
              📋
            </button>
          </div>
        </div>

        <div className="info-item">
          <label>Balance</label>
          <div className="value balance">
            {loading ? (
              <span className="loading">Loading...</span>
            ) : error ? (
              <span className="error-text">{error}</span>
            ) : (
              <span className="balance-amount">
                {balance?.toFixed(4) ?? '0.0000'} SOL
              </span>
            )}
          </div>
        </div>

        <div className="info-item">
          <label>Network</label>
          <div className="value">
            <span className="network-badge">{cluster}</span>
          </div>
        </div>
      </div>

      <div className="actions">
        <a 
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-link"
        >
          View on Explorer →
        </a>
      </div>
    </div>
  );
}
