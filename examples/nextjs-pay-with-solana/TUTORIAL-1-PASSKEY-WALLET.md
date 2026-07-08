# Tutorial 1: Creating a Passkey-Based Wallet

This tutorial walks you through creating a passkey-based smart wallet using Lazorkit SDK.

## Prerequisites

- Node.js 18+
- A modern browser with WebAuthn support (Chrome, Safari, Edge)
- Lazorkit SDK installed

## Step 1: Set Up the Provider

First, wrap your app with the `LazorkitProvider`:

```tsx
import { LazorkitProvider } from '@lazorkit/wallet';

function App() {
  return (
    <LazorkitProvider
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazorkit.com"
      paymasterConfig={{
        paymasterUrl: "https://paymaster.lazorkit.com"
      }}
    >
      <YourApp />
    </LazorkitProvider>
  );
}
```

## Step 2: Connect User

Use the `useWallet` hook to connect:

```tsx
import { useWallet } from '@lazorkit/wallet';

function ConnectButton() {
  const { connect, isConnected } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
      // Browser shows FaceID/TouchID prompt
      console.log('Connected!');
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  return (
    <button onClick={handleConnect}>
      {isConnected ? 'Connected' : 'Connect with Passkey'}
    </button>
  );
}
```

## Step 3: What Happens During Connection?

1. **Passkey Creation** - If first time, browser prompts for biometric
2. **Smart Wallet Deployment** - On-chain account is created
3. **Session Established** - User is now authenticated

## Step 4: Display Wallet Info

```tsx
function WalletInfo() {
  const { smartWalletPubkey, isConnected } = useWallet();

  if (!isConnected) return <p>Not connected</p>;

  return (
    <div>
      <p>Smart Wallet: {smartWalletPubkey?.toString()}</p>
      <p>Status: Active</p>
    </div>
  );
}
```

## Step 5: Test It

1. Open your app
2. Click "Connect with Passkey"
3. Authenticate with biometrics
4. Smart wallet is ready!

## Next Steps

- [Tutorial 2: Gasless Transactions](./TUTORIAL-2-GASLESS-TRANSACTIONS.md)
- [Back to README](./README.md)
