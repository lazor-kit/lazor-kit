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

### LazorKit Core (`3CFG1eVGpUVAxMeuFnNw7CbBA1GQ746eQDdMWPoFTAD8`)

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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request
