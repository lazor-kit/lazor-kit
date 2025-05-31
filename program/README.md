# Lazor Kit - Smart Wallet Ecosystem

A modular Solana smart contract ecosystem that provides passkey-authenticated smart wallets with customizable rule-based transaction controls.

## Overview

Lazor Kit consists of three interconnected programs that work together to provide secure, rule-based smart wallet functionality:

### Core Programs

1. **LazorKit Core** (`lazorkit`) - Main smart wallet program
2. **Transfer Limit** (`transfer_limit`) - Transaction limit enforcement rules
3. **Default Rule** (`default_rule`) - Basic transaction validation rules

## Features

### 🔐 Passkey Authentication
- WebAuthn/FIDO2 compatible authentication
- Secure key management with secp256r1 signatures
- No seed phrases required

### 📏 Rule-Based Controls
- Configurable transaction limits
- Multi-member approval systems
- Whitelisted program execution
- Custom rule program integration

### 🏗️ Modular Architecture
- Composable rule programs
- Extensible smart wallet functionality
- Clean separation of concerns

## Program Details

### LazorKit Core (`DAcTNgSppWiDvfTWa7PMvPmXHAs5DfBnrqRQme8fXJBb`)

The main program that manages smart wallets and coordinates with rule programs.

**Instructions:**
- `initialize()` - Initialize the program sequence tracker
- `create_smart_wallet()` - Create a new smart wallet with passkey
- `execute_instruction()` - Execute transactions with passkey authentication
- `upsert_whitelist_rule_programs()` - Manage whitelisted rule programs

### Transfer Limit (`HjgdxTNPqpL59KLRVDwQ28cqam2SxBirnNN5SFAFGHZ8`)

Implements transaction limits and member management for enhanced security.

**Instructions:**
- `initialize()` - Initialize the transfer limit program
- `init_rule()` - Set up transfer limit rules
- `add_member()` - Add new passkey members to a wallet
- `check_rule()` - Validate transactions against limits

### Default Rule (`B98ooLRYBP6m6Zsrd3Hnzn4UAejfVZwyDgMFaBNzVR2W`)

Provides basic rule validation functionality.

**Instructions:**
- `initialize()` - Initialize the default rule program
- `init_rule()` - Set up basic rules
- `check_rule()` - Perform basic transaction validation
- `destroy()` - Clean up rule instances

## Quick Start

### Prerequisites

- Rust 1.70+
- Solana CLI 1.16+
- Anchor Framework 0.31+
- Node.js 16+
- Yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd lazor-kit

# Install dependencies
yarn install

# Build the programs
anchor build

# Run tests
anchor test
```

### Configuration

The project uses a custom RPC endpoint. Update `Anchor.toml` for your environment:

```toml
[provider]
cluster = "http://rpc.lazorkit.xyz:8899"  # or your preferred cluster
wallet = "~/.config/solana/id.json"
```

## Usage Examples

### Creating a Smart Wallet

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

// Initialize the program
const program = new Program(idl, programId, provider);

// Create a smart wallet with passkey
const passkeyPubkey = new Uint8Array(33); // Your passkey public key
const ruleData = Buffer.from([]); // Rule configuration data

await program.methods
  .createSmartWallet(Array.from(passkeyPubkey), Array.from(ruleData))
  .accounts({
    // ... required accounts
  })
  .rpc();
```

### Adding Transfer Limits

```typescript
// Initialize transfer limit rules
const initRuleArgs = {
  // Configure your transfer limits
  maxAmount: new BN(1000000), // Example: 1 SOL limit
  timeWindow: new BN(86400),  // Example: 24 hour window
};

await transferLimitProgram.methods
  .initRule(initRuleArgs)
  .accounts({
    // ... required accounts
  })
  .rpc();
```

### Executing Transactions

```typescript
// Execute an instruction through the smart wallet
const executeArgs = {
  instruction: encodedInstruction,
  signature: passkeySignature,
  // ... other required parameters
};

await program.methods
  .executeInstruction(executeArgs)
  .accounts({
    // ... required accounts
  })
  .rpc();
```

## Development

### Project Structure

```
src/
├── lazorkit/          # Core smart wallet program
│   ├── src/
│   │   ├── instructions/  # Program instructions
│   │   ├── state/         # Account structures
│   │   └── lib.rs         # Program entry point
├── transfer_limit/    # Transfer limit rule program
│   └── src/
│       ├── instructions/
│       ├── state/
│       └── lib.rs
└── default_rule/      # Default rule program
    └── src/
        ├── instructions/
        ├── state/
        └── lib.rs
```

### Testing

```bash
# Run all tests
yarn test

# Run specific test file
yarn run ts-mocha -p ./tsconfig.json tests/contract.ts
```

### Linting

```bash
# Check formatting
yarn lint

# Fix formatting issues
yarn lint:fix
```

## Security Considerations

### Passkey Security
- Uses secp256r1 elliptic curve cryptography
- Validates WebAuthn signatures on-chain
- No private key storage required

### Rule Validation
- All transactions validated against configured rules
- Whitelisted program execution only
- Multi-signature support for high-value transactions

### Access Control
- Program-derived addresses for security
- Proper account ownership validation
- Bump seed verification

## API Reference

### Common Types

```rust
// Passkey public key format
pub type PasskeyPubkey = [u8; 33];

// Execute instruction arguments
pub struct ExecuteInstructionArgs {
    pub instruction: Vec<u8>,
    pub signature: Vec<u8>,
    // ... additional fields
}

// Transfer limit rule arguments
pub struct InitRuleArgs {
    pub max_amount: u64,
    pub time_window: i64,
    // ... additional configuration
}
```

### Error Codes

Refer to the `error.rs` files in each program for specific error codes and descriptions.

## Integration

### Adding Custom Rules

1. Create a new Anchor program implementing the rule interface
2. Add rule validation logic in the `check_rule` instruction
3. Register your program with the LazorKit whitelist
4. Configure wallets to use your custom rule

### SDK Integration

The programs are designed to work with:
- Raydium SDK for DeFi operations
- SPL Token programs
- Standard Solana wallet adapters

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

ISC License

## Support

For questions and support, please refer to the project documentation or open an issue in the repository. 