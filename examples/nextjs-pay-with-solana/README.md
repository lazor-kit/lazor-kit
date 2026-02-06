# Pay with Solana - Lazorkit SDK Integration Example

A production-ready Next.js example demonstrating **Lazorkit SDK** integration with **passkey authentication** and **gasless smart wallet transactions**.

![Lazorkit Demo](./screenshot.png)

## 🚀 Features

- **🔑 Passkey Authentication** - No seed phrases, use FaceID/TouchID/Windows Hello
- **⛽ Gasless Transactions** - Sponsored by Paymaster, no SOL needed for gas
- **🧠 Smart Wallet** - Programmable account with PDA support
- **💨 Devnet Ready** - Test with fake SOL, no real funds required
- **📱 Responsive Design** - Works on desktop and mobile
- **⚡ Next.js 14** - Latest React features with App Router

## 🎯 What This Demo Shows

1. **Passkey Login Flow** - Users can connect using their device's biometrics
2. **Smart Wallet Creation** - Automatic smart wallet deployment on first connect
3. **Gasless SOL Transfer** - Send SOL without paying gas fees
4. **Real-time Status** - Live connection and transaction status updates

## 📦 Installation

```bash
# Clone the example
cd examples/nextjs-pay-with-solana

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Update .env.local with your Lazorkit credentials
# Get them from https://portal.lazorkit.com
```

## 🔧 Environment Setup

Create a `.env.local` file:

```env
NEXT_PUBLIC_LAZORKIT_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_LAZORKIT_PORTAL_URL=https://portal.lazorkit.com
NEXT_PUBLIC_LAZORKIT_PAYMASTER_URL=https://paymaster.lazorkit.com
```

## 🏃 Running the Demo

```bash
# Development server
npm run dev

# Open http://localhost:3000
```

## 📚 Tutorial: How It Works

### 1. Setting Up the Provider

```tsx
// components/LazorkitProvider.tsx
import { LazorkitProvider as LKProvider } from '@lazorkit/wallet';

export function LazorkitProvider({ children }) {
  return (
    <LKProvider
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazorkit.com"
      paymasterConfig={{
        paymasterUrl: "https://paymaster.lazorkit.com"
      }}
    >
      {children}
    </LKProvider>
  );
}
```

### 2. Connecting with Passkey

```tsx
import { useWallet } from '@lazorkit/wallet';

function WalletComponent() {
  const { connect, isConnected, smartWalletPubkey } = useWallet();

  const handleConnect = async () => {
    await connect();
    // User authenticates with FaceID/TouchID
    // Smart wallet is created automatically
  };

  return (
    <button onClick={handleConnect}>
      {isConnected ? 'Connected' : 'Connect with Passkey'}
    </button>
  );
}
```

### 3. Sending Gasless Transactions

```tsx
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const handleSend = async () => {
  const signature = await signAndSendTransaction({
    instructions: [
      SystemProgram.transfer({
        fromPubkey: smartWalletPubkey,
        toPubkey: new PublicKey(recipient),
        lamports: LAMPORTS_PER_SOL * amount,
      }),
    ],
    transactionOptions: {
      feeToken: 'USDC', // Paymaster sponsors the transaction
    },
  });

  console.log('Transaction sent:', signature);
};
```

## 🏗️ Project Structure

```
nextjs-pay-with-solana/
├── app/
│   ├── layout.tsx          # Root layout with LazorkitProvider
│   ├── page.tsx            # Main page with PayWidget
│   └── globals.css         # Global styles
├── components/
│   ├── LazorkitProvider.tsx # SDK Provider wrapper
│   ├── WalletStatus.tsx     # Connection status UI
│   └── PayWidget.tsx        # Payment form UI
├── .env.example
├── next.config.js
├── package.json
├── README.md
└── tsconfig.json
```

## 🎨 Customization

### Changing the Token

To use a different token for gas fees:

```tsx
transactionOptions: {
  feeToken: 'YOUR_TOKEN_ADDRESS', // USDC, USDT, etc.
}
```

### Adding More Features

The `useWallet()` hook provides:
- `connect()` - Authenticate user
- `disconnect()` - Log out
- `signMessage()` - Sign arbitrary messages
- `signAndSendTransaction()` - Submit transactions
- `smartWalletPubkey` - User's smart wallet address
- `isConnected` - Connection status

## 🔒 Security Notes

- This demo uses **Devnet** - test with fake SOL only
- Passkeys are tied to the user's device
- Smart wallets are non-custodial - only the user controls them
- Always validate recipient addresses before sending

## 🚀 Deployment

### Vercel (Recommended)

```bash
npm i -g vercel
vercel
```

### Other Platforms

Build for production:

```bash
npm run build
```

## 📖 Learn More

- [Lazorkit Documentation](https://docs.lazorkit.com)
- [Lazorkit Portal](https://portal.lazorkit.com)
- [Solana Documentation](https://docs.solana.com)

## 🤝 Contributing

Feel free to submit issues or PRs to improve this example.

## 📄 License

MIT License - see LICENSE file for details.

---

Built with ❤️ using [Lazorkit SDK](https://lazorkit.com)
