# @lazorkit/wallet

A React SDK for integrating Lazor Kit – a Solana Smart Wallet solution with Passkey support 

## How it work 
![photo_2025-03-19_23-31-25](https://github.com/user-attachments/assets/8fbd66e4-d55d-415a-92a1-95343c0d7615)


## Features

- Connect/disconnect Solana smart wallets with Passkey support
- Sign messages and transactions
- Use in any React project (Vite, Next.js, Create React App, etc.)
- Customizable UI components
- Works in browser environments with Buffer support

## Installation

```bash
npm install @lazorkit/wallet
# or
yarn add @lazorkit/wallet
```

## Buffer Support in Browsers

If your project needs Buffer (for example, when decoding transactions), install the `buffer` package and polyfill it globally if your bundler does not do this automatically:

```js
import { Buffer } from 'buffer';
window.Buffer = Buffer; // Polyfill global Buffer if needed
```
> Most modern bundlers (Vite, Webpack 5) will auto-polyfill Buffer if you install the `buffer` package.

## Usage

### 1. useWallet Hook

The main hook for interacting with the wallet:

```tsx
import { useWallet } from '@lazorkt/wallet';

const {
  isConnected,    // boolean: wallet connection status
  publicKey,      // string | null: user's public key
  connect,        // () => Promise<void>: connect wallet
  disconnect,     // () => void: disconnect wallet
  signMessage,    // (message: Uint8Array) => Promise<Uint8Array>: sign a message
  error,          // string | null: error message if any
} = useWallet();
```

### 2. UI Components

#### LazorConnect

A ready-to-use React component for wallet connection UI:

```tsx
import { LazorConnect } from '@lazorkt/wallet';

<LazorConnect onConnect={publicKey => { console.log('Connected:', publicKey); }} />
```

#### WalletButton (Customizable)

You can use and customize the button component via the `as` prop or pass your own component:

```tsx
import { WalletButton } from '@lazorkit/wallet';

// Use a different HTML element
<WalletButton as="a" href="/custom">Connect Wallet</WalletButton>

// Or use your own React component
<WalletButton as={MyCustomButton} />
```

## Full Example

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

## Notes

- If using Buffer in the browser, install `buffer` and polyfill if needed.

## License

MIT
