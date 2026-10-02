# Lazorkit Mobile - React Native + Expo

**A production-ready React Native example demonstrating Lazorkit SDK integration with passkey authentication and gasless transactions.**

[中文文档](./docs/README-zh.md)

---

## Features

✅ **Passkey Authentication** - Secure, passwordless login
✅ **Gasless Transactions** - Send SOL without gas fees
✅ **Biometric Login** - FaceID/TouchID on mobile
✅ **Session Persistence** - Stay logged in across sessions
✅ **TypeScript** - Full type safety
✅ **Expo** - Easy development and deployment

---

## Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (Mac) or Android Emulator
- **For real devices**: iOS requires Apple Developer account for biometrics

### Installation

```bash
git clone https://github.com/xunwen-art/lazorkit-mobile
cd lazorkit-mobile
npm install
```

### Run the App

```bash
# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Note: Biometric auth requires real device
```

---

## Project Structure

```
lazorkit-mobile/
├── src/
│   ├── screens/
│   │   ├── LoginScreen.tsx       # Passkey + Biometric login
│   │   └── SendScreen.tsx        # Gasless transfers
│   ├── components/
│   │   └── BiometricButton.tsx   # FaceID/TouchID button
│   ├── hooks/
│   │   └── useBiometric.ts       # Biometric auth hook
│   └── providers/
│       └── LazorkitProvider.tsx  # Lazorkit SDK context
├── docs/
│   ├── README-zh.md              # Chinese documentation
│   ├── tutorial-1-passkey.md     # Passkey tutorial
│   ├── tutorial-2-gasless.md     # Gasless tutorial
│   └── tutorial-3-biometric.md   # Biometric tutorial
└── App.tsx                       # Main app with navigation
```

---

## Tutorials

### 1. [How to Create a Passkey-Based Wallet](./docs/tutorial-1-passkey.md)

Learn how to implement secure passwordless authentication using WebAuthn passkeys.

### 2. [How to Trigger Gasless Transactions](./docs/tutorial-2-gasless.md)

Step-by-step guide to sending SOL without paying gas fees.

### 3. [How to Add Biometric Authentication](./docs/tutorial-3-biometric.md)

Integrate FaceID/TouchID for seamless mobile login.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React Native | Mobile framework |
| Expo | Development platform |
| TypeScript | Type safety |
| @lazorkit/wallet-mobile-adapter | Lazorkit SDK |
| @solana/web3.js | Solana blockchain |
| expo-local-authentication | Biometric auth |

---

## Screenshots

Coming soon...

---

## Resources

- [Lazorkit Documentation](https://docs.lazorkit.com/)
- [Lazorkit GitHub](https://github.com/lazor-kit/lazor-kit)
- [Solana Documentation](https://docs.solana.com/)
- [Expo Documentation](https://docs.expo.dev/)

---

## License

MIT

---

## Author

**Dead Lobster (死龍蝦)** - AI Agent Developer

Built with ❤️ for the Solana community
