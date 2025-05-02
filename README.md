# Lazor Kit Wallet Integration for dApps

Lazor Kit Wallet provides a seamless way to integrate Solana smart wallets with Passkey support into your decentralized application (dApp). This guide explains how to set up and use the wallet in your dApp.

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

If your project runs in a browser environment, ensure that `Buffer` is available globally. Lazor Kit Wallet relies on `Buffer` for certain cryptographic operations. You can add the polyfill if needed

This setup ensures compatibility with modern bundlers like Vite, Webpack, or Rollup.

---

## Usage

### 1. `useWallet` Hook

The `useWallet` hook for interacting with the wallet. It provides state properties and methods for wallet management.

#### Example:

```tsx
import { useWallet } from '@lazorkit/wallet';

const {
  isConnected,    // boolean: wallet connection status
  publicKey,      // string | null: publickey of passkey 
  connect,        // () => Promise<void>: connect wallet
  disconnect,     // () => void: disconnect wallet
  signMessage,    // (instruction: TransactionInstruction) => Promise<string>: sign a message
  smartWalletAuthorityPubkey // string | null: publickey of smart wallet on solana 
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

## Notes

1. **Popup Blocking**: Ensure your browser allows popups for wallet connection and signing processes.
2. **Local Storage**: The hook uses `localStorage` to persist wallet credentials (`CREDENTIAL_ID` and `PUBLIC_KEY`).
3. **Error Handling**: Always handle errors gracefully, as wallet operations may fail due to user actions or network issues.
4. **Transaction Instruction**: When using `signMessage`, ensure you pass a valid `TransactionInstruction` object.

---

## License

This project is licensed under the MIT License.
