# Tutorial 1: Creating Passkey-Based Wallets

This tutorial will guide you through setting up passkey authentication with Lazorkit SDK, allowing users to access their Solana wallets using biometric authentication (FaceID, TouchID, Windows Hello) instead of seed phrases.

## Table of Contents

1. [Understanding Passkeys](#understanding-passkeys)
2. [Setting Up the Provider](#setting-up-the-provider)
3. [Implementing Wallet Connection](#implementing-wallet-connection)
4. [Managing Wallet State](#managing-wallet-state)
5. [Best Practices](#best-practices)

## Understanding Passkeys

Passkeys are a modern, secure alternative to seed phrases. They leverage:

- **Hardware Security**: Keys stored in secure hardware (Secure Enclave, TPM)
- **Biometric Auth**: FaceID, TouchID, Windows Hello
- **No Seed Phrases**: Users never see or manage cryptographic keys
- **Cross-Device Sync**: Keys can sync via iCloud/Google Password Manager

### How It Works

1. User clicks "Connect Wallet"
2. Browser prompts for biometric authentication
3. Secure key pair generated and stored in device hardware
4. Smart wallet created on Solana
5. User authenticated without managing seed phrases

## Setting Up the Provider

### Step 1: Install Dependencies

```bash
npm install @lazorkit/wallet @solana/web3.js @coral-xyz/anchor
```

### Step 2: Create Environment Configuration

Create `.env` file:

```env
VITE_RPC_URL=https://api.devnet.solana.com
VITE_PORTAL_URL=https://portal.lazorkit.com
VITE_PAYMASTER_URL=https://paymaster.lazorkit.com
```

### Step 3: Wrap App with LazorkitProvider

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazorkitProvider } from '@lazorkit/wallet';
import App from './App';
import './index.css';

const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL,
  portalUrl: import.meta.env.VITE_PORTAL_URL,
  paymasterConfig: {
    paymasterUrl: import.meta.env.VITE_PAYMASTER_URL
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LazorkitProvider {...config}>
      <App />
    </LazorkitProvider>
  </React.StrictMode>
);
```

**Key Configuration Options:**

- `rpcUrl`: Solana RPC endpoint (Devnet or Mainnet)
- `portalUrl`: Lazorkit Portal for wallet UI
- `paymasterConfig`: Configuration for gasless transactions

## Implementing Wallet Connection

### Step 4: Create WalletConnect Component

```tsx
// src/components/WalletConnect.tsx
import { useWallet } from '@lazorkit/wallet';
import { useState } from 'react';

export function WalletConnect() {
  const { connect, disconnect, isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await connect();
      console.log('✅ Wallet connected!');
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
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

  if (isConnected && publicKey) {
    return (
      <div className="wallet-connected">
        <p>Connected: {publicKey.toString().slice(0, 8)}...</p>
        <button onClick={handleDisconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      <button 
        onClick={handleConnect} 
        disabled={loading}
      >
        {loading ? 'Connecting...' : 'Connect with Passkey 🔐'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### Understanding the Code

**`useWallet()` Hook Returns:**
- `connect()`: Initiates passkey authentication flow
- `disconnect()`: Disconnects the wallet
- `isConnected`: Boolean indicating connection status
- `publicKey`: The wallet's Solana public key

**Connection Flow:**
1. User clicks "Connect with Passkey"
2. `connect()` called → Portal modal opens
3. Browser prompts for biometric authentication
4. On success, wallet state updates
5. `isConnected` becomes `true`, `publicKey` populated

## Managing Wallet State

### Step 5: Display Wallet Information

```tsx
// src/components/WalletStatus.tsx
import { useWallet } from '@lazorkit/wallet';
import { useEffect, useState } from 'react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

export function WalletStatus() {
  const { publicKey, isConnected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !publicKey) return;

    const fetchBalance = async () => {
      setLoading(true);
      try {
        const connection = new Connection(
          import.meta.env.VITE_RPC_URL,
          'confirmed'
        );
        
        const lamports = await connection.getBalance(publicKey);
        setBalance(lamports / LAMPORTS_PER_SOL);
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBalance();
  }, [publicKey, isConnected]);

  if (!isConnected) {
    return <p>Connect your wallet to see details</p>;
  }

  return (
    <div className="wallet-status">
      <h3>Wallet Info</h3>
      <div className="info-row">
        <label>Address:</label>
        <code>{publicKey?.toString()}</code>
      </div>
      <div className="info-row">
        <label>Balance:</label>
        <span>
          {loading ? 'Loading...' : `${balance?.toFixed(4) ?? '0.0000'} SOL`}
        </span>
      </div>
    </div>
  );
}
```

### Persistent Sessions

Lazorkit SDK automatically handles session persistence:

```tsx
useEffect(() => {
  // Auto-reconnect on page load if session exists
  if (!isConnected) {
    connect().catch(console.error);
  }
}, []);
```

## Best Practices

### ✅ DO

1. **Handle Errors Gracefully**
   ```tsx
   try {
     await connect();
   } catch (err) {
     if (err.code === 'USER_CANCELLED') {
       // User cancelled passkey prompt
     }
   }
   ```

2. **Show Loading States**
   - Display "Connecting..." while waiting
   - Disable buttons during operations

3. **Validate Connection Before Actions**
   ```tsx
   if (!isConnected) {
     await connect();
   }
   // Now proceed with transaction
   ```

4. **Use TypeScript for Type Safety**
   ```tsx
   import type { PublicKey } from '@solana/web3.js';
   const publicKey: PublicKey | null = wallet.publicKey;
   ```

### ❌ DON'T

1. **Don't Store Private Keys** - Passkeys handle this securely
2. **Don't Ask for Seed Phrases** - That's the whole point of passkeys!
3. **Don't Skip Error Handling** - Always catch connection failures
4. **Don't Assume Connection Persists** - Check `isConnected` before operations

## Testing

### Test Checklist

- [ ] Connect wallet with passkey
- [ ] Session persists after page refresh
- [ ] Disconnect works correctly
- [ ] Error handling displays properly
- [ ] Balance updates correctly

### Browser Support

| Browser | FaceID | TouchID | Windows Hello |
|---------|--------|---------|---------------|
| Chrome  | ✅      | ✅       | ✅             |
| Safari  | ✅      | ✅       | N/A           |
| Edge    | ❌      | ❌       | ✅             |
| Firefox | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited |

## Next Steps

Now that you can connect wallets with passkeys, proceed to:

**[Tutorial 2: Sending Gasless Transactions →](./TUTORIAL-2.md)**

Learn how to:
- Build transaction instructions
- Send SOL without gas fees
- Handle transaction confirmations

## Troubleshooting

### "Passkey not supported"
- Check browser compatibility
- Ensure HTTPS (required for passkeys)
- Try a different browser

### "Connection failed"
- Verify RPC URL is correct
- Check Portal URL is accessible
- Ensure network connection is stable

### "Session not persisting"
- Check browser doesn't block cookies
- Verify LocalStorage is enabled
- Clear cache and try again

## Resources

- [WebAuthn API](https://webauthn.io/)
- [Lazorkit Docs](https://docs.lazorkit.com)
- [Solana Web3.js](https://solana.com/docs)

---

**Next Tutorial**: [Sending Gasless Transactions →](./TUTORIAL-2.md)
