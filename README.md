# Lazor Kit Wallet Integration for dApps

Lazor Kit Wallet is a powerful tool designed to simplify the integration of Solana smart wallets with Passkey support into your decentralized application (dApp). This guide is tailored for developers transitioning from Web2 to Web3, providing a comprehensive overview of how to set up and use the wallet in your dApp.

---

## Table of Contents

1. [Introduction to Web3 and Lazor Kit](#introduction-to-web3-and-lazor-kit)
2. [Features](#features)
3. [Installation](#installation)
4. [Polyfill Notice](#polyfill-notice)
5. [Usage](#usage)
   - [useWallet Hook](#1-usewallet-hook)
6. [Example](#example)
7. [Key Concepts for Web2 Developers](#key-concepts-for-web2-developers)
8. [Notes](#notes)
9. [Contributing](#contributing)
10. [License](#license)

---

## Introduction to Web3 and Lazor Kit

Web3 represents the next evolution of the internet, where decentralized applications (dApps) operate on blockchain networks. Unlike traditional Web2 applications, Web3 applications rely on decentralized protocols, cryptographic wallets, and smart contracts to function.

Lazor Kit Wallet bridges the gap between Web2 and Web3 by providing an easy-to-use library for integrating Solana smart wallets into your dApp. With features like Passkey support, customizable UI components, and seamless React integration, Lazor Kit Wallet empowers developers to build secure and user-friendly dApps.

---

## Features

- **Connect/Disconnect** Solana smart wallets with Passkey support.
- **Sign Messages and Transactions** seamlessly.
- **React Integration**: Works with Vite, Next.js, Create React App, and more.
- **Customizable UI Components** for wallet interactions.
- **Browser Compatibility**: Works in browser environments.

---

## Installation

Install the package using npm or yarn:

```bash
npm install @lazorkit/wallet
# or
yarn add @lazorkit/wallet
```

---

## Polyfill Notice

If your project runs in a browser environment, ensure that `Buffer` is available globally. Lazor Kit Wallet relies on `Buffer` for certain cryptographic operations. You can add the polyfill if needed:

```javascript
// Add this at the entry point of your application
import { Buffer } from 'buffer';
window.Buffer = Buffer;
```

This setup ensures compatibility with modern bundlers like Vite, Webpack, or Rollup.

---

## Usage

### 1. `useWallet` Hook

The `useWallet` hook provides state properties and methods for wallet management. It abstracts the complexities of interacting with Solana wallets, making it easier for developers to integrate wallet functionality into their dApps.

#### Example:

```tsx
import { useWallet } from '@lazorkit/wallet';

const {
  isConnected,    // boolean: wallet connection status
  publicKey,      // string | null: public key of the passkey
  connect,        // () => Promise<void>: connect wallet
  disconnect,     // () => void: disconnect wallet
  signMessage,    // (instruction: TransactionInstruction) => Promise<string>: sign a message
  smartWalletAuthorityPubkey, // string | null: public key of the smart wallet on Solana
  error,          // string | null: error message if any
} = useWallet();
```

---

## Example

Here’s a more advanced example with full wallet functionality:

```tsx
import React from 'react';
import { useWallet } from '@lazorkit/wallet';

const DApp = () => {
  const {
    credentialId,
    publicKey,
    isConnected,
    isLoading,
    error,
    smartWalletAuthorityPubkey,
    connect,
    disconnect,
    signMessage,
  } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
      console.log('Wallet connected:', smartWalletAuthorityPubkey);
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    console.log('Wallet disconnected');
  };

  const handleSignMessage = async () => {
    try {
      const instruction = {}; // Replace with a valid TransactionInstruction
      const txid = await signMessage(instruction);
      console.log('Transaction ID:', txid);
    } catch (err) {
      console.error('Failed to sign message:', err);
    }
  };

  return (
    <div>
      <h1>Lazor Kit Wallet Integration</h1>
      {isConnected ? (
        <div>
          <p>Connected Wallet: {smartWalletAuthorityPubkey}</p>
          <button onClick={handleDisconnect}>Disconnect</button>
          <button onClick={handleSignMessage}>Sign Message</button>
        </div>
      ) : (
        <div>
          <button onClick={handleConnect} disabled={isLoading}>
            {isLoading ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </div>
      )}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
    </div>
  );
};

export default DApp;
```

---

## Key Concepts for Web2 Developers

1. **Wallets**: In Web3, wallets are digital tools that store private keys and enable users to interact with blockchain networks. Lazor Kit Wallet simplifies wallet management for developers.
2. **Smart Contracts**: These are self-executing contracts with the terms of the agreement directly written into code. Solana smart wallets interact with these contracts to perform operations.
3. **Public and Private Keys**: Public keys are like account numbers, while private keys are like passwords. Lazor Kit Wallet handles these securely.
4. **Transaction Signing**: Signing a transaction is akin to authorizing a payment in Web2. Lazor Kit Wallet provides methods to sign messages and transactions securely.
5. **Decentralization**: Unlike Web2, where data is stored on centralized servers, Web3 applications operate on decentralized networks like Solana.

---

## Notes

1. **Popup Blocking**: Ensure your browser allows popups for wallet connection and signing processes.
2. **Local Storage**: The hook uses `localStorage` to persist wallet credentials (`CREDENTIAL_ID` and `PUBLIC_KEY`).
3. **Error Handling**: Always handle errors gracefully, as wallet operations may fail due to user actions or network issues.
4. **Transaction Instruction**: When using `signMessage`, ensure you pass a valid `TransactionInstruction` object.

---

## Contributing

We welcome contributions to Lazor Kit Wallet! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and push them to your fork.
4. Submit a pull request with a detailed description of your changes.

---

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
