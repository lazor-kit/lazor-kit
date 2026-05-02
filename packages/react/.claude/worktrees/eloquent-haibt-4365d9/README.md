# LazorKit

> [!CAUTION]
> **This is a pre-audit version. Do not use in production level environments.**

## Why LazorKit?

LazorKit allows you to build **Passkey-native** Solana applications.

- **Seedless**: Onboard users instantly with Passkeys (FaceID, TouchID, Windows Hello)
- **Gasless**: Sponsored transactions via Paymaster
- **Smart**: Programmable account logic (PDAs)

## Packages

This monorepo contains the core infrastructure:

- **`@lazorkit/wallet`** (`packages/ts-sdk`): The core TypeScript/React SDK for web.
- **`lazorkit-program`** (`packages/program`): The on-chain smart contract framework.

> **Note**: The React Native adapter is available in a separate repository: [`@lazorkit/wallet-mobile-adapter`](https://github.com/lazor-kit/wallet-mobile-adapter).

## Getting Started

### Installation

1. Clone the repository:
```bash
git clone https://github.com/lazor-kit/lazor-kit.git
```

2. Install dependencies for the workspace:

```bash
# Install all dependencies
pnpm install
```

3. Start development server for each package:

```bash
# Start SDK development server
cd packages/sdk && pnpm dev

# Start Portal development server
cd packages/portal && pnpm dev

# Start Program development server
cd packages/program && pnpm dev
```
```

### Building

To build each package:

```bash
# Build SDK
cd packages/sdk && pnpm build

# Build Portal
cd packages/portal && pnpm build

# Build Program
cd packages/program && pnpm build
```

## Development

### Running Individual Packages

```bash
# Run development server for SDK
cd packages/sdk && pnpm dev

# Build SDK
cd packages/sdk && pnpm build

# Run development server for Portal
cd packages/portal && pnpm dev

# Build Portal
cd packages/portal && pnpm build
```

### Running All Packages

```bash
# Build all packages
pnpm build:all

# Run development servers for all packages
pnpm dev:all
```

## Package Structure

```
lazor-kit/
├── packages/
│   ├── ts-sdk/       # Core React SDK & Wallet Adapter
│   └── program/      # Smart Contracts (Anchor)
└── package.json      # Root configuration
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
