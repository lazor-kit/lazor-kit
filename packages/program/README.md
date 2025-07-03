# Lazor Kit - Smart Wallet with Passkey Authentication

A Solana smart contract program that provides passkey-based authentication for smart wallets, enabling secure transaction execution using WebAuthn/FIDO2 standards.

## 🏗️ Smart Contract Architecture

### High-Level Purpose

Lazor Kit enables users to create and manage smart wallets authenticated with passkeys (WebAuthn/FIDO2). Each smart wallet can execute arbitrary Solana instructions after verifying the user's passkey signature, providing a secure and user-friendly alternative to traditional private key management.

### Key Instructions

#### `initialize`
- **Purpose**: Sets up the program's global state
- **Accounts**: Creates `Config` and `SmartWalletSeq` PDAs
- **Access Control**: Can be called by any user (creates accounts if they don't exist)
- **Functionality**: Initializes fee structure and sequence tracker

#### `create_smart_wallet`
- **Purpose**: Creates a new smart wallet with passkey authentication
- **Accounts**: Creates `SmartWallet`, `SmartWalletConfig`, and `SmartWalletAuthenticator` PDAs
- **Access Control**: Any user can create a wallet (pays transaction fees)
- **Functionality**: Links a passkey to a smart wallet and increments the global sequence

#### `execute_instruction`
- **Purpose**: Executes arbitrary instructions on behalf of the smart wallet
- **Accounts**: Uses existing smart wallet PDAs for verification
- **Access Control**: Only the authenticated passkey owner can execute
- **Functionality**: Verifies passkey signature and executes CPI calls

### PDA Accounts

#### `Config`
- **Seeds**: `["config"]`
- **Purpose**: Stores global program configuration
- **Data**: 
  ```rust
  pub struct Config {
      pub authority: Pubkey,        // Program authority
      pub create_smart_wallet_fee: u64,  // Fee for wallet creation
      pub execute_instruction_fee: u64,  // Fee for instruction execution
  }
  ```
- **Security**: Can only be modified by the authority

#### `SmartWalletSeq`
- **Seeds**: `["smart_wallet_seq"]`
- **Purpose**: Maintains global sequence counter for wallet creation
- **Data**:
  ```rust
  pub struct SmartWalletSeq {
      pub seq: u64,  // Current sequence number
  }
  ```
- **Security**: Incremented atomically during wallet creation

#### `SmartWallet`
- **Seeds**: `["smart_wallet", seq_number_le_bytes]`
- **Purpose**: PDA that acts as the smart wallet's public key and signer
- **Data**: Zero-byte account (used only for its address and signing capability)
- **Security**: Can only sign through `execute_instruction` with valid passkey verification

#### `SmartWalletConfig`
- **Seeds**: `["smart_wallet_config", smart_wallet_pubkey]`
- **Purpose**: Stores smart wallet metadata and state
- **Data**:
  ```rust
  pub struct SmartWalletConfig {
      pub id: u64,           // Unique wallet ID (sequence number)
      pub last_nonce: u64,   // Last used nonce for replay protection
  }
  ```
- **Security**: Nonce prevents replay attacks

#### `SmartWalletAuthenticator`
- **Seeds**: `["smart_wallet_authenticator", smart_wallet_pubkey, passkey_hash]`
- **Purpose**: Links passkey to smart wallet
- **Data**:
  ```rust
  pub struct SmartWalletAuthenticator {
      pub passkey_pubkey: [u8; 33],    // Secp256r1 compressed public key
      pub smart_wallet: Pubkey,        // Associated smart wallet
      pub credential_id: Vec<u8>,      // WebAuthn credential ID
      pub bump: u8,                    // PDA bump seed
  }
  ```
- **Security**: Passkey hash in seeds prevents collisions

### State Structure and Data Layout

The program uses a hierarchical state structure:

```
Program
├── Config (Global)
├── SmartWalletSeq (Global)
└── Per Smart Wallet:
    ├── SmartWallet (PDA Signer)
    ├── SmartWalletConfig (Metadata)
    └── SmartWalletAuthenticator (Auth Link)
```

### Access Control

| Instruction | Signer Requirements | Additional Validation |
|-------------|-------------------|---------------------|
| `initialize` | Any account | Creates accounts if needed |
| `create_smart_wallet` | Payer | Must provide valid passkey and pay fees |
| `execute_instruction` | Payer | Must provide valid passkey signature, nonce verification, timestamp check |

## 🛠️ SDK Overview

The TypeScript SDK provides a high-level interface for interacting with the Lazor Kit program, abstracting complex PDA derivations and transaction building.

### Installation

```bash
npm install @coral-xyz/anchor @solana/web3.js
# or
yarn add @coral-xyz/anchor @solana/web3.js
# or
pnpm add @coral-xyz/anchor @solana/web3.js
```

### Initialization

```typescript
import { Connection } from '@solana/web3.js';
import { LazorKitProgram } from './sdk/lazor-kit';

// Connect to Solana cluster
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Initialize the Lazor Kit program
const lazorKit = new LazorKitProgram(connection);
```

### Core Functions

#### Initialize Program

```typescript
import { Keypair } from '@solana/web3.js';

const payer = Keypair.generate();

// Initialize the program (creates global state)
const initTx = await lazorKit.initializeTxn(payer.publicKey);
const signature = await connection.sendTransaction(initTx, [payer]);
```

#### Create Smart Wallet

```typescript
// Generate passkey (in real app, this comes from WebAuthn)
const passkeyPubkey = new Array(33).fill(0); // Replace with actual passkey
const credentialId = "base64EncodedCredentialId";

// Create smart wallet transaction
const createTx = await lazorKit.createSmartWalletTxn(
  passkeyPubkey,
  payer.publicKey,
  credentialId
);

const signature = await connection.sendTransaction(createTx, [payer]);
```

#### Execute Instructions

```typescript
import { SystemProgram, PublicKey } from '@solana/web3.js';

// Create a transfer instruction
const transferIx = SystemProgram.transfer({
  fromPubkey: smartWallet,
  toPubkey: recipient,
  lamports: 1000000, // 0.001 SOL
});

// Execute through smart wallet
const executeTx = await lazorKit.executeInstructionTxn(
  passkeyPubkey,
  clientDataJsonRaw,      // WebAuthn client data
  authenticatorDataRaw,   // WebAuthn authenticator data  
  signature,              // Passkey signature
  payer.publicKey,
  smartWallet,
  transferIx,
  1 // Verify instruction index
);

const txSignature = await connection.sendTransaction(executeTx, [payer]);
```

### Account Fetching

#### Get Smart Wallet by Passkey

```typescript
const { smartWallet, smartWalletAuthenticator } = 
  await lazorKit.getSmartWalletByPasskey(passkeyPubkey);

if (smartWallet) {
  console.log('Smart wallet found:', smartWallet.toString());
}
```

#### Get Smart Wallet by Credential ID

```typescript
const { smartWallet, smartWalletAuthenticator } = 
  await lazorKit.getSmartWalletByCredentialId(credentialId);
```

#### Fetch Account Data

```typescript
// Get smart wallet configuration
const config = await lazorKit.getSmartWalletConfigData(smartWallet);
console.log('Last nonce:', config.lastNonce.toString());

// Get authenticator data
const auth = await lazorKit.getSmartWalletAuthenticatorData(smartWalletAuthenticator);
console.log('Passkey:', auth.passkeyPubkey);
```

### PDA Helper Functions

```typescript
// Get smart wallet config PDA
const configPda = lazorKit.smartWalletConfig(smartWallet);

// Get authenticator PDA
const [authPda, bump] = lazorKit.smartWalletAuthenticator(passkeyPubkey, smartWallet);

// Get latest smart wallet
const latestWallet = await lazorKit.getLastestSmartWallet();

// Get global config
const globalConfig = lazorKit.config;
```

### Message Building for Signing

```typescript
// Build message for passkey signing
const messageBuffer = await lazorKit.getMessage(smartWallet.toString());

// This message should be signed with the user's passkey
// The signature is then used in executeInstructionTxn
```

### Error Handling

```typescript
try {
  const tx = await lazorKit.executeInstructionTxn(/* ... */);
  const signature = await connection.sendTransaction(tx, [payer]);
} catch (error) {
  if (error.message.includes('PasskeyMismatch')) {
    console.error('Invalid passkey for this wallet');
  } else if (error.message.includes('NonceMismatch')) {
    console.error('Transaction nonce is invalid');
  } else if (error.message.includes('TimestampTooOld')) {
    console.error('Transaction timestamp is too old');
  }
  // Handle other errors...
}
```

## 👨‍💻 Developer Notes

### Local Testing Strategy

#### Using Solana Test Validator

```bash
# Start local validator
solana-test-validator

# In another terminal, run tests
anchor test --skip-local-validator
```

#### Anchor Test Suite

```bash
# Run all tests
anchor test

# Run specific test file
yarn run ts-mocha -p ./tsconfig.json tests/smart_wallet_with_default_rule.test.ts

# Run with custom timeout
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.test.ts
```

#### Environment Setup

Create a `.env` file:
```env
RPC_URL=http://localhost:8899
PRIVATE_KEY=your_base58_private_key_here
```

### Deployment and Updates

#### Deploy to Devnet

```bash
# Build the program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <PROGRAM_ID> --url devnet
```

#### Deploy to Mainnet

```bash
# Deploy to mainnet-beta
anchor deploy --provider.cluster mainnet-beta --provider.wallet ~/.config/solana/mainnet-wallet.json
```

#### Update Program

```bash
# Build with same program ID
anchor build

# Upgrade the program (requires upgrade authority)
solana program deploy ./target/deploy/lazorkit.so --program-id <PROGRAM_ID> --upgrade-authority ~/.config/solana/upgrade-authority.json
```

### IDL and Types Generation

#### Generate IDL

```bash
# Build generates IDL automatically
anchor build

# IDL is generated at: ./target/idl/lazorkit.json
```

#### Generate TypeScript Types

```bash
# Types are generated automatically during build
anchor build

# Types are available at: ./target/types/lazorkit.ts
```

#### Update SDK After Changes

```bash
# After modifying the program:
1. anchor build                    # Regenerates IDL and types
2. Update SDK if needed            # Modify sdk/lazor-kit.ts
3. Update tests                    # Modify test files
4. yarn test                       # Run tests to verify
```

### Development Tips

#### Testing with Real Passkeys

```typescript
// Use ecdsa-secp256r1 library for testing
import ECDSA from 'ecdsa-secp256r1';

const privateKey = ECDSA.generateKey();
const publicKeyBase64 = privateKey.toCompressedPublicKey();
const pubkey = Array.from(Buffer.from(publicKeyBase64, 'base64'));
```

#### Common Issues

1. **Nonce Mismatch**: Ensure the nonce in your message matches `smart_wallet_config.last_nonce`
2. **Timestamp Too Old**: Messages must be signed within 30 seconds of current time
3. **Invalid Signature**: Ensure you're signing the correct message format (authenticator_data + client_data_hash)
4. **Insufficient Compute**: Add compute budget instruction for complex transactions

#### Security Considerations

- Always verify signatures on-chain using the Secp256r1 program
- Implement proper nonce handling to prevent replay attacks
- Validate timestamp drift to prevent stale transactions
- Use credential IDs to link WebAuthn credentials to smart wallets
- Implement proper fee handling for program sustainability

### Program ID

- **Devnet/Localnet**: `9gJ7jZaAvUafgTFPoqkCwbuvC9kpZCPtHfHjMkQ66wu9`

### Dependencies

- **Anchor Framework**: ^0.31.0
- **Solana Web3.js**: ^1.98.2
- **ECDSA Secp256r1**: ^1.3.3 (for testing)
- **TypeScript**: ^5.7.3

---

For more information and examples, check the test files in the `tests/` directory.
