# Lazorkit Pay Widget - Vite + React Example

A minimal, production-ready example demonstrating Lazorkit SDK integration for building gasless Solana payment applications with passkey authentication.

## 🎯 What This Example Demonstrates

- **Passkey Authentication**: Biometric login (FaceID/TouchID/Windows Hello)
- **Gasless Transactions**: SOL transfers sponsored via Lazorkit Paymaster
- **Smart Wallet Integration**: Programmable account logic
- **Clean React Patterns**: Hooks-based wallet management

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/lazor-kit/lazor-kit.git
cd lazor-kit/examples/vite-pay-widget

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Add your configuration to .env:
# VITE_RPC_URL=your_solana_rpc_url
# VITE_PORTAL_URL=https://portal.lazorkit.com
# VITE_PAYMASTER_URL=your_paymaster_url
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to see the app.

### Build for Production

```bash
npm run build
npm run preview
```

## 📁 Project Structure

```
vite-pay-widget/
├── src/
│   ├── App.tsx              # Main app component
│   ├── components/
│   │   ├── WalletConnect.tsx    # Wallet connection UI
│   │   ├── PaymentForm.tsx      # Payment widget
│   │   └── WalletStatus.tsx     # Wallet info display
│   ├── main.tsx             # Entry point
│   └── index.css            # Styles
├── .env.example             # Environment variables template
├── package.json
├── vite.config.ts
├── TUTORIAL-1.md            # Tutorial: Passkey wallets
└── TUTORIAL-2.md            # Tutorial: Gasless transactions
```

## 📚 Tutorials

### [Tutorial 1: Creating Passkey-Based Wallets](./TUTORIAL-1.md)

Learn how to:
- Set up the Lazorkit Provider
- Connect users with biometric authentication
- Manage wallet sessions

### [Tutorial 2: Sending Gasless Transactions](./TUTORIAL-2.md)

Learn how to:
- Build transaction instructions
- Use the Paymaster for gasless transfers
- Handle transaction confirmations

## 🔑 Key Features

### 1. Passkey Authentication

Users authenticate with their device biometrics instead of seed phrases:

```tsx
const { connect, isConnected } = useWallet();

// Connect with passkey (FaceID/TouchID/Windows Hello)
await connect();
```

### 2. Gasless SOL Transfers

Send SOL without the user paying gas fees:

```tsx
const { signAndSendTransaction } = useWallet();

await signAndSendTransaction({
  instructions: [
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipientPublicKey,
      lamports: amount
    })
  ],
  transactionOptions: {
    feeToken: 'USDC' // Pay fees with USDC instead of SOL
  }
});
```

### 3. Smart Wallet

Programmable account with built-in security and recovery options.

## 🌐 Deployment

### Deploy to Vercel

```bash
npm run build
vercel --prod
```

### Deploy to Netlify

```bash
npm run build
netlify deploy --prod --dir=dist
```

## 🛠️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_RPC_URL` | Solana RPC endpoint (devnet/mainnet) | ✅ |
| `VITE_PORTAL_URL` | Lazorkit Portal URL | ✅ |
| `VITE_PAYMASTER_URL` | Paymaster service endpoint | ✅ |

### Network Configuration

- **Devnet**: Use Devnet RPC for testing
- **Mainnet**: Switch to Mainnet RPC for production

## 🔐 Security Best Practices

1. **Never commit `.env` files** - Use `.env.example` as a template
2. **Validate recipient addresses** - Always verify before sending
3. **Set transaction limits** - Implement amount limits for safety
4. **Use Devnet first** - Test thoroughly before mainnet deployment

## 📖 API Reference

### `useWallet()` Hook

```tsx
const {
  connect,          // Connect wallet with passkey
  disconnect,       // Disconnect wallet
  isConnected,      // Connection status
  publicKey,        // Wallet public key
  signAndSendTransaction  // Sign and send tx
} = useWallet();
```

See [Lazorkit SDK Documentation](https://docs.lazorkit.com) for complete API reference.

## 🤝 Contributing

Found a bug or want to improve this example?

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -m 'Add improvement'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

## 📄 License

MIT License - see the [LICENSE](../../LICENSE) file for details.

## 🆘 Support

- **Documentation**: https://docs.lazorkit.com
- **Telegram**: https://t.me/lazorkit
- **Issues**: https://github.com/lazor-kit/lazor-kit/issues

## 🎓 Learn More

- [Lazorkit SDK Documentation](https://docs.lazorkit.com)
- [Solana Web3.js Guide](https://solana.com/docs)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)

---

**Built for the Lazorkit Developer Integration Bounty** 🚀
