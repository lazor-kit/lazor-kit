# Lazor Kit React SDK

React SDK for Lazor Kit - A Solana Smart Wallet Solution with Passkey Support

## Installation

```bash
npm install @lazor-kit/react-sdk
# or
yarn add @lazor-kit/react-sdk
```

## Setup

### Polyfills

Add the following polyfills to your application's entry point (e.g., `index.tsx` or `main.tsx`):

```typescript
import { Buffer } from 'buffer';
import process from 'process';

// Add to window object
window.Buffer = Buffer;
window.process = process;
```

## Usage

```typescript
import { LazorConnect, SmartWalletContract } from '@lazor-kit/react-sdk';

// Initialize SDK
const sdk = new SmartWalletContract(connection);

// Use components
function App() {
  return (
    <LazorConnect onSignMessage={async (base64Tx) => {
      // Handle signed message
    }} />
  );
}
```

## Features

- Solana Smart Wallet integration
- Passkey authentication
- React components
- TypeScript support

## Documentation

For detailed documentation, please visit our [documentation site](https://docs.lazor-kit.com).

## License

MIT
