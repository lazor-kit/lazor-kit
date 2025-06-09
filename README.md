# Lazor Kit

The open-source smart wallet infrastructure for Solana.

> [!WARNING]
> Alpha software: Do not use in production. This repository is highly experimental.

## Monorepo Structure

```
├── src/           # Core SDK implementation
├── portal/        # Wallet connection portal
├── program/       # Solana on-chain programs
└── docs/          # Documentation
```

## Features

- Passkey-based smart wallet authentication
- Transaction signing with non-custodial security
- Cross-origin communication with wildcard origin support
- WebAuthn integration

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build all packages
```

## Package Structure

### @lazorkit/wallet

Core wallet functionality with React hooks for easy integration.

### Portal

Wallet interface with cross-origin messaging. Uses wildcard origin (`*`) for postMessage to ensure compatibility between different development origins.

### Program

Solana on-chain programs for smart wallet functionality.

## Key Components

- **useWallet** - React hook for wallet integration
- **MessageHandler** - Cross-origin communication utility
- **PasskeyManager** - WebAuthn credential management

## License

MIT
