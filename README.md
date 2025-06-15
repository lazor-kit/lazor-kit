# LazorKit 

LazorKit is a collection of open-source packages for building Solana applications, including a smart wallet SDK, passkey sharing hub , and documentation.

## Packages

This monorepo contains several packages:

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

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
