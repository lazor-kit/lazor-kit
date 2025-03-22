export * from './hooks/useLazorKit';
export * from './types';

// Example usage:
/*
import { useLazorKit } from '@lazor-kit/react-sdk';

function App() {
  const { connect, sign, disconnect, walletState, isLoading, error } = useLazorKit({
    ipfsHubUrl: 'https://your-ipfs-hub-url.com',
    popupConfig: {
      width: 600,
      height: 400,
      title: 'WalletAction'
    },
    timeout: 60000
  });

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleSign = async () => {
    try {
      const message = JSON.stringify({
        action: 'claim',
        amount: '5',
        timestamp: Date.now()
      });
      const { signature } = await sign(message);
      console.log('Signature:', signature);
    } catch (err) {
      console.error('Signing failed:', err);
    }
  };

  return (
    <div>
      {!walletState.isConnected ? (
        <button onClick={handleConnect} disabled={isLoading}>
          Connect Wallet
        </button>
      ) : (
        <div>
          <p>Connected: {walletState.credentialId?.slice(0, 10)}</p>
          <button onClick={handleSign} disabled={isLoading}>
            Sign Message
          </button>
          <button onClick={disconnect}>Disconnect</button>
        </div>
      )}
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </div>
  );
}
*/ 