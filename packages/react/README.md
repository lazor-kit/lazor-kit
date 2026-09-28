# LazorKit React SDK

LazorKit allows you to build **Passkey-native** Solana applications.

Traditionally, crypto requires users to manage complex seed phrases. LazorKit replaces this with the standard biometrics users already know: **FaceID**, **TouchID**, or **Windows Hello**.

## Features
- **Seedless**: Onboard users instantly with Passkeys
- **Gasless**: Sponsored transactions via Paymaster
- **Smart**: Programmable account logic (PDAs)
- **Secure**: Hardware-bound credentials

## Installation

```bash
npm install @lazorkit/wallet @coral-xyz/anchor @solana/web3.js
```

## Usage

```tsx
import { LazorkitProvider, useWallet } from '@lazorkit/wallet';
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

// 1. Wrap App with Provider
export const App = () => (
  <LazorkitProvider
    rpcUrl={process.env.LAZORKIT_RPC_URL}
    portalUrl={process.env.LAZORKIT_PORTAL_URL}
    paymasterConfig={{ paymasterUrl: process.env.LAZORKIT_PAYMASTER_URL }}
  >
    <WalletContent />
  </LazorkitProvider>
);

// 2. Use Hook
function WalletContent() {
  const { connect, signAndSendTransaction, isConnected } = useWallet();

  const handleTx = async () => {
    // Connect (Auto-reconnects)
    if (!isConnected) await connect();

    // Sign and Send
    const sig = await signAndSendTransaction({
      instructions: [
        SystemProgram.transfer({
          fromPubkey: smartWalletPubkey,
          toPubkey: new PublicKey('RECIPIENT'),
          lamports: LAMPORTS_PER_SOL * 0.1
        })
      ],
      transactionOptions: { feeToken: 'USDC' }
    });
    
    console.log("Tx:", sig);
  };

  return <button onClick={handleTx}>Execute Transaction</button>;
}
```


## Wallets made before LazorKit v2

LazorKit v2 runs at its own program id; v1 keeps its old one until it is
retired. This package serves both: `connect` finds a user's existing v1 wallet
and keeps using it, and only a new user gets a v2 wallet. Everything routes by
the connected wallet, so there is nothing to branch on in your app — but
`useWallet().protocolVersion` tells you which one a user is on (1 or 2), e.g.
to offer the move to v2.

Your app's v1 users need a relayer that still sponsors LazorKit v1 — the one
the app used before v2. LazorKit's v2 relayer does not, so if `paymasterConfig`
points at a v2 relayer, `v1PaymasterConfig` is required:

```tsx
<LazorkitProvider
  paymasterConfig={{ paymasterUrl: V2_PAYMASTER_URL }}
  v1PaymasterConfig={{ paymasterUrl: EXISTING_PAYMASTER_URL }}
>
```

`connect` adopts a wallet only when the passkey is shown to hold its key —
the credential-id hash alone is public, and anyone can list it on a wallet of
their own. Signing in with an existing passkey on a new device therefore costs
one extra passkey prompt. Show users the vault (`WalletInfo.vaultPda`); the
exported PDA helpers derive v2 addresses and are wrong for a v1 wallet.

Once LazorKit retires v1, a v1 wallet's transactions fail with
`V1WalletRetiredError`. Its funds are safe; move it with
`LazorKitClient.migrateV1Wallet` from `@lazorkit/sdk-legacy`, or send the user
to the LazorKit migration page.

## API Reference

### `useWallet()`

#### `connect()`

Connects to the wallet. Auto-reconnects if session exists.

**Returns**
`Promise<WalletAccount>`

#### `disconnect()`

Disconnects the wallet.

**Returns** 
`Promise<void>`

#### `signMessage(message)`

Signs a message string key.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `message` | `string` | Message content |

**Returns**
`Promise<{ signature: string, signedPayload: string }>`

#### `signAndSendTransaction(payload)`

Signs and sends transaction via Paymaster.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `payload.instructions` | `TransactionInstruction[]` | Instructions |
| `payload.transactionOptions` | `object` | Optional config |
| `transactionOptions.feeToken` | `string` | Token address for gas fees (e.g. USDC). |
| `transactionOptions.computeUnitLimit` | `number` | Max compute units. |
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Signup tables for v0 txs. |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Network for simulation. |

**Returns**
`Promise<string>` - Transaction signature.
