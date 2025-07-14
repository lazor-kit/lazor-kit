# 🚀 LazorKit SDK

<div align="center">
  <img src="https://img.shields.io/badge/platform-Web-blue.svg" alt="Web" />
  <img src="https://img.shields.io/badge/network-Solana%20Devnet%20Only-purple.svg" alt="Solana Devnet Only" />
  <img src="https://img.shields.io/badge/auth-Passkey-green.svg" alt="Passkey Auth" />
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License" />
</div>

<br />

> Seamless Web3 authentication for the web. A web wallet adapter that leverages passkey authentication, smart wallets, and gasless transactions for the Solana ecosystem.

## 📚 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Installation](#-installation)
- [Integration Guide](#-integration-guide)
- [API Reference](#-api-reference)
- [Advanced Usage](#-advanced-usage)
- [Event System](#-event-system)
- [Support](#-support)

## 🌟 Overview

LazorKit SDK enables web applications to integrate secure, passwordless wallet functionality using WebAuthn passkeys. The SDK handles:

- Passkey creation and authentication
- Smart wallet deployment and management
- Transaction signing and sending
- **Automatic reconnection** with stored credentials
- **Disconnect/reconnect functionality** without data loss
- Cross-origin communication
- Credential persistence
- Gasless transactions via paymaster

## ⚠️ Current Status

> **Important**: This SDK is currently in beta and supports:
> - Solana Devnet (Mainnet support coming soon)
> - WebAuthn-capable browsers
> - React applications
> 
> Do not use in production level!

## ✨ Features

🔐 **Enhanced Authentication**
- WebAuthn-based wallet creation
- **Auto-reconnection** with stored credentials
- **Seamless disconnect/reconnect** without losing state
- Secure key storage in hardware
- Cross-device synchronization
- Biometric authentication support

� **Improved Connection Management**
- **Smart reconnection logic** - tries stored credentials first
- **Preserves communication handler** on disconnect
- **Proper state cleanup** while maintaining reconnection capability
- **Comprehensive error handling** with automatic recovery

⚡ **Flexible Wallet Creation**
- **Separate passkey creation**: `createPasskeyOnly()`
- **Separate smart wallet creation**: `createSmartWalletOnly(passkeyData)`
- **Full wallet creation**: `connect()` (default)
- Step-by-step wallet creation workflows

�💸 **Gasless Transactions**
- Built-in paymaster integration
- Fee sponsorship options
- Transaction bundling
- Fee estimation

🌐 **Cross-Origin Support**
- Secure iframe integration
- Popup window handling
- Message validation
- Origin verification

🎯 **Enhanced Event System**
- **Connection events**: `connect:start`, `connect:success`, `connect:error`
- **Disconnect events**: `disconnect:start`, `disconnect:success`, `disconnect:error`  
- **Reconnect events**: `reconnect:start`, `reconnect:success`, `reconnect:error`
- **Passkey events**: `passkey:start`, `passkey:success`, `passkey:error`
- **Smart wallet events**: `smartwallet:start`, `smartwallet:success`, `smartwallet:error`
- **Transaction events**: `transaction:start`, `transaction:success`, `transaction:sent`, `transaction:error`

🔗 **Solana Integration**
- Full Anchor support
- Program deployment
- Account management
- RPC configuration

💾 **Credential Management**
- **Persistent storage** across page refreshes
- **Auto-reconnection** on app restart
- Cross-component syncing
- Recovery mechanisms

🛡️ **Security Features**
- Origin validation
- Message encryption
- Signature verification
- **Comprehensive error handling**
- **Automatic cleanup** and memory management

---

## 📦 Installation

### Package Installation

```bash
# Using npm
npm install @lazorkit/wallet @coral-xyz/anchor @solana/web3.js

# Using yarn
yarn add @lazorkit/wallet @coral-xyz/anchor @solana/web3.js

# Using pnpm
pnpm add @lazorkit/wallet @coral-xyz/anchor @solana/web3.js
```

### Environment Setup

1. Configure environment variables:
```env
LAZORKIT_RPC_URL=https://api.devnet.solana.com
LAZORKIT_PORTAL_URL=https://portal.lazor.sh
LAZORKIT_PAYMASTER_URL=https://lazorkit-paymaster.onrender.com
```

2. Add required polyfills (if needed):
```js
// polyfills.js
import { Buffer } from 'buffer';

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}
```

## 🚀 Integration Guide

### Basic Integration

1. Setup the Provider:
```tsx
import { LazorkitProvider } from '@lazorkit/wallet';

export default function App() {
  return (
    <LazorkitProvider
      rpcUrl={process.env.LAZORKIT_RPC_URL}
      ipfsUrl={process.env.LAZORKIT_PORTAL_URL}
      paymasterUrl={process.env.LAZORKIT_PAYMASTER_URL}
    >
      <YourApp />
    </LazorkitProvider>
  );
}
```

2. Use the Wallet Hook:
```tsx
import { useWallet } from '@lazorkit/wallet';
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

function WalletDemo() {
  const {
    // State
    smartWalletPubkey,    // PublicKey | null - Smart wallet address
    isConnected,          // boolean - Connection status (!!account)
    isLoading,            // boolean - Loading state (isConnecting || isSigning)
    isConnecting,         // boolean - Connection in progress
    isSigning,            // boolean - Signing in progress
    error,                // Error | null - Latest error if any
    account,              // WalletAccount | null - Wallet account data

    // Actions
    connect,              // () => Promise<WalletAccount> - Connect wallet (auto-reconnect first)
    disconnect,           // () => Promise<void> - Disconnect wallet (preserves communication)
    signTransaction,      // (instruction: TransactionInstruction) => Promise<string>
    signAndSendTransaction, // (instruction: TransactionInstruction) => Promise<string>
    
    // New methods for flexible workflows
    createPasskeyOnly,    // () => Promise<ConnectResponse> - Create passkey only
    createSmartWalletOnly, // (passkeyData: ConnectResponse) => Promise<{smartWalletAddress: string, account: WalletAccount}>
    reconnect,            // () => Promise<WalletAccount> - Reconnect using stored credentials
  } = useWallet();

  // 1. Connect wallet (tries auto-reconnect first)
  const handleConnect = async () => {
    try {
      const account = await connect();
      console.log('Connected:', account.smartWallet);
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  // 2. Sign and send transaction
  const handleTransfer = async () => {
    if (!smartWalletPubkey) return;

    try {
      const instruction = SystemProgram.transfer({
        fromPubkey: smartWalletPubkey,
        toPubkey: new PublicKey('7BeWr6tVa1pYgrEddekYTnQENU22bBw9H8HYJUkbrN71'),
        lamports: LAMPORTS_PER_SOL * 0.1,
      });

      const signature = await signAndSendTransaction(instruction);
      console.log('Transfer sent:', signature);
    } catch (error) {
      console.error('Transfer failed:', error);
    }
  };

  // 3. Disconnect (can reconnect later)
  const handleDisconnect = async () => {
    try {
      await disconnect();
      console.log('Disconnected successfully');
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>LazorKit Wallet Demo</h2>
      
      {!isConnected ? (
        <button
          onClick={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p>Wallet: {smartWalletPubkey?.toString().slice(0, 8)}...</p>
          
          <button onClick={handleTransfer} disabled={isLoading}>
            {isSigning ? 'Sending...' : 'Transfer SOL'}
          </button>

          <button 
            onClick={handleDisconnect}
            style={{ backgroundColor: '#ff6b6b' }}
          >
            Disconnect
          </button>
        </div>
      )}
      
      {error && (
        <p style={{ color: 'red' }}>
          Error: {error.message}
        </p>
      )}
    </div>
  );
}
```

---

## 📚 API Reference

### `useWallet()` Hook

```tsx
const {
  // State
  smartWalletPubkey,     // PublicKey | null - Smart wallet public key
  isConnected,           // boolean - Connection status (!!account)
  isLoading,             // boolean - General loading state (isConnecting || isSigning)
  isConnecting,          // boolean - Connection in progress
  isSigning,             // boolean - Transaction signing in progress
  error,                 // Error | null - Last error that occurred
  account,               // WalletAccount | null - Connected wallet account

  // Connection Actions
  connect,               // () => Promise<WalletAccount> - Connect (auto-reconnect first)
  disconnect,            // () => Promise<void> - Disconnect (preserves communication handler)
  reconnect,             // () => Promise<WalletAccount> - Reconnect using stored credentials

  // Transaction Actions
  signTransaction,       // (instruction: TransactionInstruction) => Promise<string>
  signAndSendTransaction, // (instruction: TransactionInstruction) => Promise<string>

  // Advanced Wallet Creation
  createPasskeyOnly,     // () => Promise<ConnectResponse> - Create passkey only
  createSmartWalletOnly, // (passkeyData: ConnectResponse) => Promise<{smartWalletAddress: string, account: WalletAccount}>
} = useWallet();
```

### Connection Workflow

```typescript
// 1. Standard Connection (Recommended)
const account = await connect();
// → First tries reconnect() if stored credentials exist
// → Falls back to new connection dialog if no credentials or reconnect fails
// → Automatically cleans up corrupted credentials

// 2. Manual Reconnection
try {
  const account = await reconnect();
  console.log('Reconnected successfully');
} catch (error) {
  if (error.code === 'NO_STORED_CREDENTIALS') {
    console.log('No stored credentials found');
  } else if (error.code === 'INVALID_CREDENTIALS') {
    console.log('Stored credentials are invalid');
  }
}

// 3. Step-by-Step Wallet Creation
// Step 1: Create passkey only
const passkeyData = await createPasskeyOnly();
console.log('Passkey created:', passkeyData.credentialId);

// Step 2: Later create smart wallet using passkey data
const { smartWalletAddress, account } = await createSmartWalletOnly(passkeyData);
console.log('Smart wallet created:', smartWalletAddress);
```

### Type Definitions

```typescript
// Wallet Account
type WalletAccount = {
  credentialId: string;           // Passkey credential ID
  passkeyPubkey: number[];        // Passkey public key bytes
  smartWallet: string;            // Smart wallet address (base58)
  smartWalletAuthenticator: string; // Authenticator address (base58)
  isConnected: boolean;           // Connection status
  timestamp: number;              // Connection timestamp
};

// Connect Response (for createPasskeyOnly)
type ConnectResponse = {
  publicKey: string;              // Base64 encoded public key
  credentialId: string;           // Credential ID
  isCreated: boolean;             // Whether credential was newly created
  connectionType: 'create' | 'get'; // Connection type
  timestamp: number;              // Response timestamp
};

// Error Codes
enum ErrorCode {
  NOT_CONNECTED = 'NOT_CONNECTED',
  NO_STORED_CREDENTIALS = 'NO_STORED_CREDENTIALS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  // ... other error codes
}
```

---

## 🎯 Event System

The SDK emits comprehensive events for all operations:

### Connection Events
```typescript
sdk.on('connect:start', () => console.log('Connection starting...'));
sdk.on('connect:success', (account) => console.log('Connected:', account));
sdk.on('connect:error', (error) => console.log('Connection failed:', error));
```

### Disconnect Events
```typescript
sdk.on('disconnect:start', () => console.log('Disconnecting...'));
sdk.on('disconnect:success', () => console.log('Disconnected successfully'));
sdk.on('disconnect:error', (error) => console.log('Disconnect failed:', error));
```

### Reconnect Events
```typescript
sdk.on('reconnect:start', () => console.log('Reconnecting...'));
sdk.on('reconnect:success', (account) => console.log('Reconnected:', account));
sdk.on('reconnect:error', (error) => console.log('Reconnect failed:', error));
```

### Passkey Events
```typescript
sdk.on('passkey:start', () => console.log('Creating passkey...'));
sdk.on('passkey:success', (data) => console.log('Passkey created:', data));
sdk.on('passkey:error', (error) => console.log('Passkey creation failed:', error));
```

### Smart Wallet Events
```typescript
sdk.on('smartwallet:start', () => console.log('Creating smart wallet...'));
sdk.on('smartwallet:success', (data) => console.log('Smart wallet created:', data));
sdk.on('smartwallet:error', (error) => console.log('Smart wallet creation failed:', error));
```

### Transaction Events
```typescript
sdk.on('transaction:start', () => console.log('Transaction starting...'));
sdk.on('transaction:success', () => console.log('Transaction signed'));
sdk.on('transaction:sent', (signature) => console.log('Transaction sent:', signature));
sdk.on('transaction:error', (error) => console.log('Transaction failed:', error));
```

---

## 💡 Advanced Usage

### Persistent State Across Page Refreshes

```tsx
// Option 1: Use built-in persistence (credentials auto-saved)
const { connect } = useWallet();

// On page refresh, call connect() - it will auto-reconnect
useEffect(() => {
  connect().catch(console.error);
}, []);

// Option 2: Enhanced Zustand store with persistence
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useLazorkitStore = create(
  persist(
    (set) => ({
      account: null,
      setAccount: (account) => set({ account }),
    }),
    {
      name: 'lazorkit-store',
      partialize: (state) => ({ account: state.account }),
    }
  )
);
```

### Error Handling Best Practices

```tsx
const handleConnect = async () => {
  try {
    await connect();
  } catch (error) {
    switch (error.code) {
      case 'NO_STORED_CREDENTIALS':
        console.log('First time user - opening connection dialog');
        break;
      case 'INVALID_CREDENTIALS':
        console.log('Credentials corrupted - will be cleared automatically');
        break;
      case 'CONNECTION_FAILED':
        console.log('Network or dialog error - try again');
        break;
      default:
        console.error('Unexpected error:', error);
    }
  }
};
```

### Custom Transaction Flows

```tsx
// 1. Sign and Send (Recommended)
const sendTransaction = async (instruction) => {
  try {
    const signature = await signAndSendTransaction(instruction);
    console.log('Transaction sent:', signature);
    return signature;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
};

// 2. Sign Only (for custom sending logic)
const signOnly = async (instruction) => {
  try {
    const signedTransaction = await signTransaction(instruction);
    console.log('Transaction signed:', signedTransaction);
    
    // Custom sending logic here
    // const signature = await connection.sendTransaction(signedTransaction);
    
    return signedTransaction;
  } catch (error) {
    console.error('Signing failed:', error);
    throw error;
  }
};
```

---

## � Configuration

### LazorkitProvider Props

```tsx
type LazorkitProviderProps = {
  rpcUrl?: string;        // Solana RPC endpoint (default: devnet)
  ipfsUrl?: string;       // LazorKit portal URL  
  paymasterUrl?: string;  // Paymaster service URL
  children: React.ReactNode;
};

// Development (Devnet)
<LazorkitProvider
  rpcUrl="https://api.devnet.solana.com"
  ipfsUrl="https://portal.lazor.sh"
  paymasterUrl="https://lazorkit-paymaster.onrender.com"
>

// Custom RPC
<LazorkitProvider
  rpcUrl="https://your-custom-rpc.com"
  ipfsUrl="https://portal.lazor.sh"
  paymasterUrl="https://your-paymaster.com"
>
```

---

## 🐛 Troubleshooting

### Common Issues

**1. Button stays disabled after transaction**
- ✅ Fixed in latest version
- Events `transaction:sent` and `transaction:success` both reset loading state

**2. Can't reconnect after disconnect**
- ✅ Fixed in latest version  
- `disconnect()` now preserves communication handler
- `connect()` automatically tries `reconnect()` first

**3. State not updating on disconnect**
- ✅ Fixed in latest version
- Added comprehensive event listeners in `LazorkitProvider`

**4. Page refresh loses connection**
- ✅ Auto-reconnection available
- Call `connect()` on app start - it will use stored credentials

### Debug Mode

```tsx
// Enable debug logging
const sdk = new Lazorkit({
  // ... other options
  debug: true
});

// Or check console for detailed event logs
```

---

## 🆕 Migration Guide

### From Previous Versions

**Breaking Changes:**
- `disconnect()` behavior changed - now preserves communication handler
- New events added - update event listeners if using SDK directly
- `connect()` now tries auto-reconnect first

**New Features:**
- ✅ `createPasskeyOnly()` and `createSmartWalletOnly()` methods
- ✅ Auto-reconnection on `connect()`
- ✅ Enhanced event system
- ✅ Better error handling and recovery
- ✅ Improved memory management

**Migration Steps:**
1. Update to latest version
2. No code changes needed for basic usage
3. Optional: Use new separate creation methods for advanced workflows
4. Optional: Add new event listeners for better UX

---

## � Changelog

### v2.1.0 (Latest)
- ✅ **Fixed disconnect/reconnect functionality**
- ✅ **Added auto-reconnection support**
- ✅ **Separated passkey and smart wallet creation**
- ✅ **Enhanced event system**
- ✅ **Improved error handling and cleanup**
- ✅ **Better code architecture and maintainability**

### v2.0.0
- Initial release with basic wallet functionality

---

## 🤝 Support

- **Documentation**: [docs.lazor.sh](https://docs.lazor.sh)
- **Issues**: [GitHub Issues](https://github.com/lazorkit/sdk/issues)  
- **Discord**: [LazorKit Community](https://discord.gg/lazorkit)
- **Email**: support@lazor.sh

---

*Built with ❤️ by the LazorKit team*
