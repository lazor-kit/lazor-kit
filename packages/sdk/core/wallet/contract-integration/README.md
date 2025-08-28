# LazorKit Contract Integration

This directory contains the TypeScript integration code for the LazorKit smart wallet program. The code has been refactored to provide a clean, well-organized API with clear separation of concerns.

## 📁 Directory Structure

```
contract-integration/
├── anchor/           # Generated Anchor types and IDL
├── client/           # Main client classes
├── pda/             # PDA derivation functions
├── webauthn/        # WebAuthn/Passkey utilities
├── auth.ts          # Authentication utilities
├── transaction.ts   # Transaction building utilities
├── utils.ts         # General utilities
├── messages.ts      # Message building utilities
├── constants.ts     # Program constants
├── types.ts         # TypeScript type definitions
├── index.ts         # Main exports
└── README.md        # This file
```

## 🚀 Quick Start

```typescript
import { LazorkitClient } from './contract-integration';

// Initialize client
const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new LazorkitClient(connection);

// Create a smart wallet
const { transaction, smartWalletId, smartWallet } =
  await client.createSmartWalletTransaction({
    payer: payer.publicKey,
    passkeyPubkey: [
      /* 33 bytes */
    ],
    credentialIdBase64: 'base64-credential-id',
    isPayForUser: true,
  });
```

## 📚 API Overview

### Client Classes

#### `LazorkitClient`

The main client for interacting with the LazorKit program.

**Key Methods:**

- **PDA Derivation**: `configPda()`, `smartWalletPda()`, `walletDevicePda()`, etc.
- **Account Data**: `getSmartWalletData()`, `getWalletDeviceData()`, etc.
- **Low-level Builders**: `buildCreateSmartWalletInstruction()`, `buildExecuteTransactionInstruction()`, etc.
- **High-level Builders**: `createSmartWalletTransaction()`, `executeTransactionWithAuth()`, etc.

#### `DefaultPolicyClient`

Client for interacting with the default policy program.

### Authentication

The integration provides utilities for passkey authentication:

```typescript
import { buildPasskeyVerificationInstruction } from './contract-integration';

// Build verification instruction
const authInstruction = buildPasskeyVerificationInstruction({
  passkeyPubkey: [
    /* 33 bytes */
  ],
  signature64: 'base64-signature',
  clientDataJsonRaw64: 'base64-client-data',
  authenticatorDataRaw64: 'base64-auth-data',
});
```

### Transaction Building

Utilities for building different types of transactions:

```typescript
import {
  buildVersionedTransaction,
  buildLegacyTransaction,
} from './contract-integration';

// Build versioned transaction (v0)
const v0Tx = await buildVersionedTransaction(connection, payer, instructions);

// Build legacy transaction
const legacyTx = await buildLegacyTransaction(connection, payer, instructions);
```

## 🔧 Type Definitions

### Core Types

```typescript
// Authentication
interface PasskeySignature {
  passkeyPubkey: number[];
  signature64: string;
  clientDataJsonRaw64: string;
  authenticatorDataRaw64: string;
}

// Smart Wallet Actions
enum SmartWalletAction {
  UpdatePolicy = 'update_policy',
  InvokePolicy = 'invoke_policy',
  ExecuteTransaction = 'execute_transaction',
}

// Action Arguments
type SmartWalletActionArgs = {
  type: SmartWalletAction;
  args: ArgsByAction[SmartWalletAction];
};

// Transaction Parameters
interface CreateSmartWalletParams {
  payer: PublicKey;
  passkeyPubkey: number[];
  credentialIdBase64: string;
  policyInstruction?: TransactionInstruction | null;
  isPayForUser?: boolean;
  smartWalletId?: BN;
}

interface ExecuteTransactionParams {
  payer: PublicKey;
  smartWallet: PublicKey;
  passkeySignature: PasskeySignature;
  policyInstruction: TransactionInstruction | null;
  cpiInstruction: TransactionInstruction;
}
```

## 🏗️ Architecture

### Separation of Concerns

1. **Authentication (`auth.ts`)**: Handles passkey signature verification
2. **Transaction Building (`transaction.ts`)**: Manages transaction construction
3. **Message Building (`messages.ts`)**: Creates authorization messages
4. **PDA Derivation (`pda/`)**: Handles program-derived address calculations
5. **Client Logic (`client/`)**: High-level business logic and API

### Method Categories

#### Low-Level Instruction Builders

Methods that build individual instructions:

- `buildCreateSmartWalletInstruction()`
- `buildExecuteTransactionInstruction()`
- `buildInvokePolicyInstruction()`
- `buildUpdatePolicyInstruction()`
- `buildCreateTransactionSessionInstruction()`
- `buildExecuteSessionTransactionInstruction()`

#### High-Level Transaction Builders

Methods that build complete transactions with authentication:

- `createSmartWalletTransaction()`
- `executeTransactionWithAuth()`
- `invokePolicyWithAuth()`
- `updatePolicyWithAuth()`
- `createTransactionSessionWithAuth()`
- `executeSessionTransaction()`

#### Utility Methods

Helper methods for common operations:

- `generateWalletId()`
- `getSmartWalletData()`
- `buildAuthorizationMessage()`
- `getSmartWalletByPasskey()`

## 🔄 Migration Guide

### From Old API to New API

**Old:**

```typescript
await client.createSmartWalletTx({
  payer: payer.publicKey,
  passkeyPubkey: [
    /* bytes */
  ],
  credentialIdBase64: 'base64',
  ruleInstruction: null,
});
```

**New:**

```typescript
await client.createSmartWalletTransaction({
  payer: payer.publicKey,
  passkeyPubkey: [
    /* bytes */
  ],
  credentialIdBase64: 'base64',
  policyInstruction: null,
});
```

### Key Changes

1. **Method Names**: More descriptive and consistent

   - `executeTxnDirectTx` → `executeTransactionWithAuth`
   - `callRuleDirectTx` → `invokePolicyWithAuth`
   - `changeRuleDirectTx` → `updatePolicyWithAuth`
   - `commitCpiTx` → `createTransactionSessionWithAuth`
   - `executeCommitedTx` → `executeSessionTransaction`

2. **Parameter Structure**: Better organized with typed interfaces

   - Authentication data grouped in `PasskeySignature` for methods that require signatures
   - Clear separation of required vs optional parameters
   - Consistent naming: `policyInstruction` instead of `ruleInstruction`

3. **Return Types**: More consistent and informative

   - All high-level methods return `VersionedTransaction`
   - Legacy methods return `Transaction` for backward compatibility

4. **Type Names**: More accurate and generic

   - `MessageArgs` → `SmartWalletActionArgs` (can be used anywhere, not just messages)

5. **Client Names**: Updated for consistency

   - `DefaultRuleClient` → `DefaultPolicyClient`

6. **Terminology**: All "rule" references changed to "policy"
   - `ruleInstruction` → `policyInstruction`
   - `ruleData` → `policyData`
   - `checkRule` → `checkPolicy`
   - `initRule` → `initPolicy`

## 🧪 Testing

The integration includes comprehensive type safety and can be tested with:

```typescript
// Test smart wallet creation
it('should create smart wallet successfully', async () => {
  const { transaction, smartWalletId, smartWallet } =
    await client.createSmartWalletTransaction({
      payer: payer.publicKey,
      passkeyPubkey: [
        /* test bytes */
      ],
      credentialIdBase64: 'test-credential',
      isPayForUser: true,
    });

  expect(smartWalletId).to.be.instanceOf(BN);
  expect(transaction).to.be.instanceOf(Transaction);
});
```

## 🔒 Security

- All authentication methods use proper passkey signature verification
- Transaction building includes proper instruction ordering
- PDA derivation follows secure patterns
- Type safety prevents common programming errors

## 📖 Examples

### Creating a Smart Wallet

```typescript
const { transaction, smartWalletId, smartWallet } =
  await client.createSmartWalletTransaction({
    payer: payer.publicKey,
    passkeyPubkey: [
      /* 33 bytes */
    ],
    credentialIdBase64: 'base64-credential',
    isPayForUser: true,
  });
```

### Executing a Transaction with Authentication

```typescript
const transaction = await client.executeTransactionWithAuth({
  payer: payer.publicKey,
  smartWallet: smartWallet.publicKey,
  passkeySignature: {
    passkeyPubkey: [
      /* 33 bytes */
    ],
    signature64: 'base64-signature',
    clientDataJsonRaw64: 'base64-client-data',
    authenticatorDataRaw64: 'base64-auth-data',
  },
  policyInstruction: null,
  cpiInstruction: transferInstruction,
});
```

### Creating a Transaction Session

```typescript
const sessionTx = await client.createTransactionSessionWithAuth({
  payer: payer.publicKey,
  smartWallet: smartWallet.publicKey,
  passkeySignature: {
    passkeyPubkey: [
      /* 33 bytes */
    ],
    signature64: 'base64-signature',
    clientDataJsonRaw64: 'base64-client-data',
    authenticatorDataRaw64: 'base64-auth-data',
  },
  policyInstruction: null,
  expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});
```

### Building Authorization Messages

```typescript
const message = await client.buildAuthorizationMessage({
  action: {
    type: SmartWalletAction.ExecuteTransaction,
    args: {
      policyInstruction: null,
      cpiInstruction: transferInstruction,
    },
  },
  payer: payer.publicKey,
  smartWallet: smartWallet.publicKey,
  passkeyPubkey: [
    /* 33 bytes */
  ],
});
```

### Using the Default Policy Client

```typescript
import { DefaultPolicyClient } from './contract-integration';

const defaultPolicyClient = new DefaultPolicyClient(connection);

// Build policy initialization instruction
const initPolicyIx = await defaultPolicyClient.buildInitPolicyIx(
  payer.publicKey,
  smartWallet.publicKey,
  walletDevice.publicKey
);

// Build policy check instruction
const checkPolicyIx = await defaultPolicyClient.buildCheckPolicyIx(
  walletDevice.publicKey
);

// Build add device instruction
const addDeviceIx = await defaultPolicyClient.buildAddDeviceIx(
  payer.publicKey,
  walletDevice.publicKey,
  newWalletDevice.publicKey
);
```

See the `tests/` directory for comprehensive usage examples of all the new API methods.
