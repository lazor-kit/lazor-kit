# @lazorkit/wallet

A React SDK for integrating Lazor Kit – a Solana Smart Wallet solution with Passkey support.

---

## How It Works

![Lazor Kit Wallet Flow](https://github.com/user-attachments/assets/8fbd66e4-d55d-415a-92a1-95343c0d7615)

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

## Usage

### 1. `useWallet` Hook

The `useWallet` hook is the main API for interacting with the wallet. It provides state properties and methods for wallet management.

#### Example:

```tsx
import { useWallet } from '@lazorkit/wallet';

const {
  isConnected,    // boolean: wallet connection status
  publicKey,      // string | null: user's public key
  connect,        // () => Promise<void>: connect wallet
  disconnect,     // () => void: disconnect wallet
  signMessage,    // (instruction: TransactionInstruction) => Promise<string>: sign a message
  error,          // string | null: error message if any
} = useWallet();
```

---

### 2. UI Components

#### **LazorConnect**

A ready-to-use React component for wallet connection UI:

```tsx
import { LazorConnect } from '@lazorkit/wallet';

<LazorConnect onConnect={(publicKey) => console.log('Connected:', publicKey)} />
```

#### **WalletButton (Customizable)**

You can use and customize the button component via the `as` prop or pass your own component:

```tsx
import { WalletButton } from '@lazorkit/wallet';

// Use a different HTML element
<WalletButton as="a" href="/custom">Connect Wallet</WalletButton>

// Or use your own React component
<WalletButton as={MyCustomButton} />
```

---

## Full Example

Here’s a simple example of integrating the Lazor Kit Wallet into your dApp:

```tsx
import { LazorConnect, useWallet } from '@lazorkit/wallet';

function App() {
  const { isConnected, publicKey, connect, disconnect } = useWallet();

  return (
    <div>
      <LazorConnect onConnect={connect} />
      {isConnected && <div>Public Key: {publicKey}</div>}
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}
```

---

## Advanced Example

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
      console.log('Wallet connected:', publicKey);
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
          <p>Connected Wallet: {publicKey}</p>
          <p>Smart Wallet Authority: {smartWalletAuthorityPubkey}</p>
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
