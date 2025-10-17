# LazorKit

The open-source smart wallet infrastructure for Solana.

> [!WARNING]
>  Do not use in production. This repository is highly experimental.

## Packages

This repo contains several packages:

- `@lazorkit/wallet`: Core SDK for Solana wallet functionality
- `program`: Core smart contract framework for smart wallet

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
│   ├── sdk/          # Core SDK package
│   ├── portal/       # Passkey sharing hub
│   ├── program/      # Core smart contract framework for smart wallet
│   └── docs/         # Documentation
└── package.json      # Root configuration
```

## Repository layout

Historically Lazor Kit has been managed as a PNPM workspace/monorepo. We are in
the process of transitioning to a multi-repository model so each surface area
(SDK, portal, on-chain program, documentation, examples) can evolve and release
independently. See [REPO_STRUCTURE.md](./REPO_STRUCTURE.md) for the proposed
split and migration checklist.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
