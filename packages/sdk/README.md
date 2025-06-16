# 🚀 LazorKit SDK

<div align="center">
  <img src="https://img.shields.io/badge/platform-Web-blue.svg" alt="Web" />
  <img src="https://img.shields.io/badge/network-Solana%20Devnet%20Only-purple.svg" alt="Solana Devnet Only" />
  <img src="https://img.shields.io/badge/auth-Passkey-green.svg" alt="Passkey Auth" />
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License" />
</div>

<br />

> **Seamless Web3 authentication for the web. A web wallet adapter that leverages passkey authentication, smart wallets, and gasless transactions for the Solana ecosystem.

## 📚 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Installation](#-installation)
- [Integration Guide](#-integration-guide)
- [API Reference](#-api-reference)
- [Advanced Usage](#-advanced-usage)
- [Security](#-security)
- [Support](#-support)

## 🌟 Overview

LazorKit SDK enables web applications to integrate secure, passwordless wallet functionality using WebAuthn passkeys. The SDK handles:

- Passkey creation and authentication
- Smart wallet deployment and management
- Transaction signing and sending
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

🔐 **Passkey Authentication**
- WebAuthn-based wallet creation
- Secure key storage in hardware
- Cross-device synchronization
- Biometric authentication support

💸 **Gasless Transactions**
- Built-in paymaster integration
- Fee sponsorship options
- Transaction bundling
- Fee estimation

🌐 **Cross-Origin Support**
- Secure iframe integration
- Popup window handling
- Message validation
- Origin verification

⚡ **Smart Wallet Features**
- Automatic wallet creation
- Transaction signing
- Balance management
- Key recovery options

🔗 **Solana Integration**
- Full Anchor support
- Program deployment
- Account management
- RPC configuration

💾 **Credential Management**
- Secure storage
- Cross-component syncing
- Persistence options
- Recovery mechanisms

🛡️ **Security Features**
- Origin validation
- Message encryption
- Signature verification
- Error handling

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
import { LazorKitProvider } from '@lazorkit/wallet';

export default function App() {
  return (
    <LazorKitProvider
      rpcUrl={process.env.LAZORKIT_RPC_URL}
      portalUrl={process.env.LAZORKIT_PORTAL_URL}
      paymasterUrl={process.env.LAZORKIT_PAYMASTER_URL}
      config={{
        autoConnect: true,          // Auto-connect if credentials exist
        persistCredentials: true,   // Save credentials to local storage
        syncBetweenTabs: true,     // Sync wallet state between tabs
        allowIframe: true,         // Enable iframe support
        debug: true                // Enable debug logging
      }}
    >
      <YourApp />
    </LazorKitProvider>
  );
}
```

2. Use the Wallet Hook:
```tsx
import { useWallet } from '@lazorkit/wallet';
import * as anchor from '@coral-xyz/anchor';

function WalletDemo() {
  const {
    // State
    smartWalletPubkey: PublicKey | null;     // Smart wallet address
    isConnected: boolean;                    // Connection status (!!account)
    isLoading: boolean;                      // Loading state (isConnecting || isSigning)
    isConnecting: boolean;                   // Connection in progress
    isSigning: boolean;                      // Signing in progress
    error: Error | null;                     // Latest error if any
    account: WalletAccount | null;           // Wallet account data

    // Actions
    connect: () => Promise<void>;            // Connect wallet
    disconnect: () => void;                  // Disconnect wallet
    signTransaction: (                       // Sign single transaction
      transaction: Transaction
    ) => Promise<string>;
    signAndSendTransaction: (               // Sign and send transaction
      transaction: Transaction
    ) => Promise<string>;
  } = useWallet();

  // 1. Connect wallet
  const handleConnect = async () => {
    try {
      await connect();
      console.log('Connected:', smartWalletPubkey?.toString());
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  // 2. Sign and send a transaction
  const handleTransfer = async () => {
    if (!smartWalletPubkey) return;

    try {
      // Create transfer instruction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: smartWalletPubkey,
          toPubkey: new PublicKey('...'),
          lamports: LAMPORTS_PER_SOL * 0.1,
        })
      );

      // Sign and send transaction
      const signature = await signAndSendTransaction(transaction);
      console.log('Transfer sent:', signature);
    } catch (error) {
      console.error('Transfer failed:', error);
    }
  };

  // 3. Sign a transaction
  const handleSign = async () => {
    if (!smartWalletPubkey) return;

    try {
      // Create transaction
      const transaction = new Transaction().add(
        // Add your instructions here
      );

      // Sign transaction
      const signature = await signTransaction(transaction);
      console.log('Transaction signed:', signature);
    } catch (error) {
      console.error('Signing failed:', error);
    }
  };

  // 4. Handle multiple instructions
  const handleBatchTransfer = async () => {
    if (!smartWalletPubkey) return;

    try {
      // Create transaction with multiple instructions
      const transaction = new Transaction();
      
      // Add transfer instructions
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: smartWalletPubkey,
          toPubkey: new PublicKey('recipient1'),
          lamports: LAMPORTS_PER_SOL * 0.1,
        }),
        SystemProgram.transfer({
          fromPubkey: smartWalletPubkey,
          toPubkey: new PublicKey('recipient2'),
          lamports: LAMPORTS_PER_SOL * 0.2,
        })
      );

      // Sign and send transaction
      const signature = await signAndSendTransaction(transaction);
      console.log('Batch sent:', signature);
    } catch (error) {
      console.error('Batch failed:', error);
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
            Transfer SOL
          </button>
          
          <button onClick={handleSign} disabled={isLoading}>
            Sign Transaction
          </button>
          
          <button onClick={handleBatchTransfer} disabled={isLoading}>
            Batch Transfer
          </button>
          
          <button 
            onClick={disconnect}
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

---
```
## 📚 API Reference

### `useWallet()`

The main hook providing wallet functionality:

```tsx
const {
   // State
    smartWalletPubkey, // PublicKey | null - Smart wallet public key
    isConnected: !!account, // boolean - Connection status
    isLoading: isConnecting || isSigning, // boolean - General loading state
    isConnecting, // boolean - Connection in progress
    isSigning, // boolean - Transaction signing in progress
    error, // Error | null - Last error that occurred
    account, // WalletAccount | null - Connected wallet account

    // Actions
    connect, // (options?: SDKOptions) => Promise<WalletInfo>
    disconnect, // () => Promise<void>
    signTransaction, // (instruction: TransactionInstruction) => Promise<string>
    signAndSendTransaction, // (instruction: TransactionInstruction) => Promise<Transaction>
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
  isConnected: boolean;           // Connection status
  timestamp: number;              // Connection timestamp
};

// SDK Options for connection
type SDKOptions = {
  skipWarning?: boolean;          // Skip warning dialogs
  mode?: 'popup' | 'dialog' | 'auto'; // Dialog display mode
  fallbackToPopup?: boolean;      // Fallback to popup if dialog fails
  origin?: string;                // Origin for the connection request
};

// Connect Response from the dialog
type ConnectResponse = {
  publicKey: string;              // Base64 encoded public key
  credentialId: string;           // Credential ID
  isCreated: boolean;             // Whether the credential was newly created
  connectionType: 'create' | 'get'; // Type of connection
  timestamp: number;              // Response timestamp
};

// Sign Response from the dialog
type SignResponse = {
  signature: string;              // Base64 encoded signature
  msg: string;                    // Original message
  normalized: string;             // Normalized message
  credentialId?: string;          // Credential ID used for signing
  publicKey?: string;             // Public key used for signing
  timestamp: number;              // Response timestamp
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

### Sign and Send Transaction

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
    // Sign and send in one step
    const signature = await signAndSendTransaction(instruction);
    console.log('Transfer successful:', signature);
    return signature;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
};
```

### Custom Transaction (Sign Only)

```tsx
import { SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

const signTransferSOL = async () => {
  if (!smartWalletPubkey) return;

  const instruction = SystemProgram.transfer({
    fromPubkey: smartWalletPubkey,
    toPubkey: new PublicKey('RECIPIENT_WALLET_ADDRESS'),
    lamports: 0.1 * LAMPORTS_PER_SOL,
  });

  try {
    // Sign only, returns transaction signature
    const signature = await signTransaction(instruction);
    console.log('Transaction signed:', signature);
    return signature;
  } catch (error) {
    console.error('Signing failed:', error);
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

// Or sign and send each instruction in one step
const executeAndSendMultipleInstructions = async () => {
  if (!smartWalletPubkey) return;

  // Create multiple instructions
  const instructions = [
    // Memo instruction
    new anchor.web3.TransactionInstruction({
      keys: [],
      programId: new anchor.web3.PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
      data: Buffer.from('First instruction', 'utf-8'),
    }),
    // Second instruction
    new anchor.web3.TransactionInstruction({
      keys: [],
      programId: new anchor.web3.PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
      data: Buffer.from('Second instruction', 'utf-8'),
    })
  ];

  // Sign and send each instruction
  for (const instruction of instructions) {
    try {
      const signature = await signAndSendTransaction(instruction);
      console.log('Instruction signed and sent:', signature);
    } catch (error) {
      console.error('Batch execution failed:', error);
      break;
    }
  }
};
```

---

## 💾 Credential Storage and Syncing

LazorKit implements a robust credential management system to ensure consistent access to credentials across different UI components:

```typescript
// StorageUtil provides consistent access to credentials
class StorageUtil {
  // Save credentials to local storage
  static saveCredentials({
    credentialId,
    publickey,
    smartWalletAddress
  }: {
    credentialId: string;
    publickey: string;
    smartWalletAddress: string;
  }): void {
    // Implementation details
  }

  // Get credentials from local storage
  static getCredentials(): {
    credentialId: string | null;
    publickey: string | null;
    smartWalletAddress: string | null;
  } {
    // Implementation details
  }

  // Clear credentials from local storage
  static clearCredentials(): void {
    // Implementation details
  }
}
```

### Credential Syncing Flow

1. **Connection**: Credentials are saved after successful connection
2. **Popup to Iframe**: Credentials are synced between popup and iframe
3. **Pre-signing**: Credentials are synced before transaction signing
4. **Storage Access**: Consistent storage access via StorageUtil

## 🔒 Security Considerations

- **Passkey Security**: Wallet creation relies on WebAuthn security
- **Storage**: Credentials are stored securely and synced between popup and iframe
- **Network**: Currently supports Solana Devnet only
- **Validation**: Always validate transaction instructions before signing
- **Error Handling**: Robust error handling for missing credentials

---

## 📦 Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build all packages
```

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and development process.

---

## 🆘 Support

- 🐦 **Twitter**: [@lazorkit](https://twitter.com/lazorkit)
- 🐛 **Issues**: [GitHub Issues](https://github.com/lazor-kit/lazor-kit/issues)

---

## 📄 License

ISC © [LazorKit](https://github.com/lazor-kit)

---

<div align="center">
  <p>Made with ❤️ by the LazorKit team</p>
  <p>
    <a href="https://lazorkit.xyz">🌐 Website</a> •
    <a href="https://twitter.com/lazorkit">🐦 Twitter</a>
  </p>
</div>
