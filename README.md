# LazorKit Wallet SDK

LazorKit Wallet SDK is a React library that makes it easy to integrate LazorKit wallet into your application. The SDK provides basic functionalities such as wallet connection, disconnection, and message signing.

## Installation

```bash
npm install lazorkit
# or
yarn add lazorkit
```

## Usage

### 1. Connect Wallet

```tsx
import { LazorConnect } from 'lazorkit';

function App() {
  const handleConnect = (publicKey: string) => {
    console.log('Connected with public key:', publicKey);
  };

  return (
    <LazorConnect onConnect={handleConnect} />
  );
}
```

### 2. Sign Message

```tsx
import { LazorConnect } from 'lazorkit';

function App() {
  const handleSignMessage = async (base64Tx: string) => {
    try {
      // Process signed message
      console.log('Signed message:', base64Tx);
    } catch (error) {
      console.error('Failed to sign message:', error);
    }
  };

  return (
    <LazorConnect onSignMessage={handleSignMessage} />
  );
}
```

## Props

### LazorConnect Component

| Prop | Type | Description |
|------|------|-------------|
| `onConnect` | `(publicKey: string) => void` | Callback triggered when wallet is successfully connected |
| `onSignMessage` | `(base64Tx: string) => Promise<void>` | Callback triggered when user signs a message |

## Hooks

### useWallet

Main hook for interacting with LazorKit wallet.

```tsx
const {
  isConnected,    // Connection status
  isLoading,      // Loading status
  error,          // Error if any
  credentialId,   // Credential ID
  publicKey,      // Wallet public key
  connect,        // Connect wallet function
  disconnect,     // Disconnect wallet function
  signMessage     // Sign message function
} = useWallet();
```

## Core Features

### 1. Wallet Connection

The connection process includes the following steps:
1. Open wallet connection popup
2. Wait for user authentication
3. Store credential and public key in localStorage
4. Update connection status

### 2. Disconnection

The disconnection process includes:
1. Remove credential and public key from localStorage
2. Update disconnection status

### 3. Message Signing

The message signing process includes:
1. Check connection status
2. Open signing popup
3. Wait for user confirmation

## UI Components

### WalletDisplay

Component that displays wallet interface with features:
- Connect/disconnect button
- Wallet address display
- Copy address button
- Disconnect dropdown menu

## Styling

Component uses CSS modules with main classes:

```css
.lazor-connect          /* Main container */
.wallet-address        /* Wallet address display */
.copy-button           /* Copy button */
.disconnect-button     /* Disconnect button */
.connect-button        /* Connect button */
```

## Error Handling

SDK handles common errors:
- Connection failure
- Blocked popup
- Timeout
- Message signing error

## Complete Example

```tsx
import { LazorConnect } from 'lazorkit';

function App() {
  const handleConnect = (publicKey: string) => {
    console.log('Connected with public key:', publicKey);
  };

  const handleSignMessage = async (base64Tx: string) => {
    try {
      // Process signed message
      console.log('Signed message:', base64Tx);
    } catch (error) {
      console.error('Failed to sign message:', error);
    }
  };

  return (
    <div>
      <h1>My App</h1>
      <LazorConnect 
        onConnect={handleConnect}
        onSignMessage={handleSignMessage}
      />
    </div>
  );
}
```

## Notes

1. Ensure your domain is whitelisted in LazorKit
2. Check internet connection before performing operations
3. Handle error cases appropriately
4. Consider security when storing credential information

## License

MIT
