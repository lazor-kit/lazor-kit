# Lazorkit Monorepo

LazorKit is a collection of open-source packages for building Solana applications, including a smart wallet SDK, portal, and documentation.

## Packages

This monorepo contains several packages:

- `@lazorkit/wallet`: Core SDK for Solana wallet functionality
- `prongram`: Core smart contract framework for Smart Wallet 

## Getting Started

### Prerequisites

- Node.js >= 18
- pnpm >= 7

### Installation

```bash
# Clone the repository
git clone https://github.com/lazor/sdk.git

# Install dependencies
pnpm install
```

## Development

### Running Individual Packages

```bash
# Run development server for SDK
pnpm --filter sdk dev

# Build SDK
pnpm --filter sdk build

# Run development server for Portal
pnpm --filter portal dev

# Build Portal
pnpm --filter portal build
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
│   ├── portal/       # Portal application
│   ├── program/      # Solana program
│   └── docs/         # Documentation
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
