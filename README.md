# 🚀 LazorKit

<div align="center">
  <img src="https://img.shields.io/badge/platform-Web-blue.svg" alt="Web" />
  <img src="https://img.shields.io/badge/network-Solana%20Devnet%20Only-purple.svg" alt="Solana Devnet Only" />
  <img src="https://img.shields.io/badge/auth-Passkey-green.svg" alt="Passkey Auth" />
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License" />
</div>

<br />

> **Seamless Web3 authentication for the web.** A web wallet adapter that leverages passkey authentication, smart wallets, and gasless transactions for the Solana Devnet ecosystem.

## ⚠️ Current Status

> **Important**: This package is currently experimental and only supports:
> - Solana Devnet (Mainnet support coming soon)
> - Do not use in production. This repository is highly experimental.

## ✨ Features

🔐 **Passkey Authentication** - Secure, passwordless wallet creation using WebAuthn  
💸 **Gasless Transactions** - Built-in paymaster support for frictionless UX  
🌐 **Cross-Origin Communication** - Wildcard origin support for development flexibility  
⚡ **Smart Wallets** - Automatic smart wallet creation and management  
🔗 **Solana Devnet** - Full Anchor framework support with transaction signing  
💾 **Persistent Storage** - Secure credential storage and syncing between popup and iframe  
🛡️ **Type Safety** - Full TypeScript support with comprehensive type definitions  

---

## 📦 Installation

```bash
# Using npm
npm install @lazorkit/wallet

# Using yarn
yarn add @lazorkit/wallet

# Using pnpm
pnpm add @lazorkit/wallet
```

---

## 🚀 Quick Start

### 1. Setup the Provider

Wrap your app with `LazorKitProvider`:

```tsx
import React from 'react';
import { LazorKitProvider } from '@lazorkit/wallet';

export default function App() {
  return (
    <LazorKitProvider
      rpcUrl="https://api.devnet.solana.com"
      ipfsUrl="https://portal.lazor.sh"  
      paymasterUrl="https://lazorkit-paymaster.onrender.com"
    >
      <YourApp />
    </LazorKitProvider>
  );
}
```

### 2. Use the Wallet Hook

```tsx
import React from 'react';
import { useWallet } from '@lazorkit/wallet';
import * as anchor from '@coral-xyz/anchor';

export function WalletDemo() {
  const {
    smartWalletPubkey,
    isConnected,
    isConnecting,
    isSigning,
    error,
    connect,
    disconnect,
    signTransaction,
  } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  const handleSign = async () => {
    if (!smartWalletPubkey) return;

    // Create a memo instruction
    const instruction = new anchor.web3.TransactionInstruction({
      keys: [],
      programId: new anchor.web3.PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
      data: Buffer.from('Hello from LazorKit! 🚀', 'utf-8'),
    });

    try {
      const signature = await signTransaction(instruction);
      console.log('Transaction signature:', signature);
    } catch (error) {
      console.error('Signing failed:', error);
    }
  };

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
          <p>
            Wallet: {smartWalletPubkey?.toString().slice(0, 8)}...
          </p>
          <button
            onClick={handleSign}
            disabled={isSigning}
          >
            {isSigning ? 'Signing...' : 'Sign Message'}
          </button>
          <button
            onClick={() => disconnect()}
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

### `useWallet()`

The main hook providing wallet functionality:

```tsx
const {
  // State
  smartWalletPubkey,    // PublicKey | null - Smart wallet public key
  isConnected,          // boolean - Connection status  
  isLoading,            // boolean - General loading state
  isConnecting,         // boolean - Connection in progress
  isSigning,            // boolean - Transaction signing in progress
  error,                // Error | null - Last error that occurred
  connection,           // Connection - Solana RPC connection

  // Actions  
  connect,              // () => Promise<WalletInfo>
  disconnect,           // () => Promise<void>
  signTransaction,      // (instruction: TransactionInstruction) => Promise<string>
} = useWallet();
```

### `LazorKitProvider`

Provider component props:

```tsx
type ProviderProps = {
  rpcUrl?: string;        // Solana RPC endpoint (default: devnet)
  ipfsUrl?: string;       // LazorKit portal URL  
  paymasterUrl?: string;  // Paymaster service URL
  children: React.ReactNode;
};
```

### Type Definitions

```typescript
// Wallet information returned after connection
type WalletInfo = {
  credentialId: string;           // Passkey credential ID
  passkeyPubkey: number[];        // Passkey public key bytes
  smartWallet: string;            // Smart wallet address (base58)
  smartWalletAuthenticator: string; // Authenticator address (base58)
};
```

---

## 🔧 Configuration

### Environment Setup

```tsx
// Development (Devnet)
<LazorKitProvider
  rpcUrl="https://api.devnet.solana.com"
  ipfsUrl="https://portal.lazor.sh"
  paymasterUrl="https://lazorkit-paymaster.onrender.com"
>

// Custom RPC
<LazorKitProvider
  rpcUrl="https://your-custom-rpc.com"
  ipfsUrl="https://portal.lazor.sh"
  paymasterUrl="https://your-paymaster.com"
>
```

---

## 💡 Advanced Usage

### Custom Transaction

```tsx
import { SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

const sendSOL = async () => {
  if (!smartWalletPubkey) return;

  const instruction = SystemProgram.transfer({
    fromPubkey: smartWalletPubkey,
    toPubkey: new PublicKey('RECIPIENT_WALLET_ADDRESS'),
    lamports: 0.1 * LAMPORTS_PER_SOL,
  });

  try {
    const signature = await signTransaction(instruction);
    console.log('Transfer successful:', signature);
    return signature;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
};
```

### Multiple Instructions

```tsx
const executeMultipleInstructions = async () => {
  if (!smartWalletPubkey) return;

  // Create multiple instructions
  const instructions = [
    // Memo instruction
    new anchor.web3.TransactionInstruction({
      keys: [],
      programId: new anchor.web3.PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
      data: Buffer.from('Batch transaction', 'utf-8'),
    }),
    // Add more instructions as needed
  ];

  // Sign each instruction
  for (const instruction of instructions) {
    try {
      const signature = await signTransaction(instruction);
      console.log('Instruction signed:', signature);
    } catch (error) {
      console.error('Batch execution failed:', error);
      break;
    }
  }
};
```

---

## 🔒 Security Considerations

- **Passkey Security**: Wallet creation relies on WebAuthn security
- **Storage**: Credentials are stored securely and synced between popup and iframe
- **Network**: Currently supports Solana Devnet only
- **Validation**: Always validate transaction instructions before signing

---

## 📁 Repository Structure

```
├── src/           # Core SDK implementation
├── portal/        # Wallet connection portal
├── program/       # Solana on-chain programs
└── docs/          # Documentation
```

## 🧩 Key Components

- **useWallet** - React hook for wallet integration
- **MessageHandler** - Cross-origin communication utility
- **PasskeyManager** - WebAuthn credential management
- **StorageUtil** - Credential storage and syncing
- **SmartWallet** - Smart wallet implementation

## 📦 Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build all packages
```

## 📄 License

MIT
