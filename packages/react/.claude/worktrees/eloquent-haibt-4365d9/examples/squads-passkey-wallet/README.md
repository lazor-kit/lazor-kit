## LazorKit + Squads Multisig (v4) Quickstart

This guide shows how to use LazorKit Wallet Mobile Adapter together with Squads Multisig to:

- Create a multisig wallet
- Create a vault transaction
- Create a proposal
- Approve / Reject / Cancel a proposal
- Execute a vault transaction

All snippets are TypeScript/React Native and align with this project’s structure.

### Prerequisites

- Packages

```bash
npm install @sqds/multisig @solana/web3.js @lazorkit/wallet-mobile-adapter bs58 buffer
```

- Environment variables (example `.env`)

```
EXPO_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
# WARNING: for demo only. Do not embed private keys in production apps.
EXPO_PUBLIC_PRIVATE_KEY=...base58-secret-key...
```

- Hermes Buffer polyfill (already added in this repo)

```ts
// app/_layout.tsx
import { Buffer } from 'buffer';
// @ts-ignore
global.Buffer = Buffer;
```

- Provider setup (already added in this repo)

```tsx
// app/_layout.tsx
<LazorKitProvider
  rpcUrl={process.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
  ipfsUrl={process.env.EXPO_PUBLIC_IPFS_URL!}
  paymasterUrl={process.env.EXPO_PUBLIC_PAYMASTER_URL!}
  isDebug={true}
>
  {/* your app */}
</LazorKitProvider>
```

### Connect wallet (LazorKit)

```tsx
import { useLazorWallet } from '@lazorkit/wallet-mobile-adapter';

const { isConnected, connect, smartWalletPubkey, connection, signMessage } = useLazorWallet();

async function onConnect() {
  await connect({ redirectUrl: 'exp://localhost:8081' });
}
```

### Create a multisig

```ts
import * as multisigSdk from '@sqds/multisig';
import { Keypair, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';
import { SmartWalletActionArgs, SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';

async function createMultisig({ members, threshold }: { members: string[]; threshold: number }) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');

  // Payer for sending finalized txs (demo only)
  const payer = Keypair.fromSecretKey(base58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!));

  // Derive addresses
  const [multisigPda] = multisigSdk.getMultisigPda({ createKey: smartWalletPubkey });
  const programConfigPda = multisigSdk.getProgramConfigPda({})[0];
  const programConfig = await multisigSdk.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);

  // Build instruction
  const ix = multisigSdk.instructions.multisigCreateV2({
    createKey: smartWalletPubkey,
    creator: payer.publicKey,
    multisigPda,
    configAuthority: null,
    timeLock: 0,
    members: members.map((m) => ({ key: new PublicKey(m), permissions: multisigSdk.types.Permissions.all() })),
    threshold,
    treasury: programConfig.treasury,
    rentCollector: null,
  });

  // Ask LazorKit to co-sign and return raw transactions
 const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(
    action,
    {
      onSuccess: async (txns: any[]) => {
        for (const txn of txns) {
          if (txn.version === 0) {
            txn.sign([payer]);
            await connection.sendTransaction(txn, { skipPreflight: true });
          } else {
            txn.partialSign(payer);
            await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
          }
        }
      },
      onFail: (e: any) => {
        throw new Error(e?.message || 'Sign failed');
      },
      redirectUrl: 'exp://localhost:8081',
    }
  );

  return multisigPda.toBase58();
}
```

### Create a vault transaction

This example builds a simple SOL transfer from the vault. It demonstrates how to create a `TransactionMessage` and wrap it in Squads’ `vaultTransactionCreate` instruction.

```ts
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage } from '@solana/web3.js';
import { SmartWalletActionArgs, SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';

async function createVaultTransaction({ multisig, to, lamports }: { multisig: string; to: string; lamports: number }) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');
  const payer = Keypair.fromSecretKey(base58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!));

  const multisigPda = new PublicKey(multisig);
  const [vaultPda] = multisigSdk.getVaultPda({ multisigPda, index: 0 });

  // Fetch and increment the transaction index as needed
  const multisigInfo = await multisigSdk.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const newTransactionIndex = BigInt(Number(multisigInfo.transactionIndex) + 1);

  // Build a transfer instruction that the vault will execute
  const transferIx = SystemProgram.transfer({
    fromPubkey: vaultPda,
    toPubkey: new PublicKey(to),
    lamports: Math.floor(lamports * LAMPORTS_PER_SOL),
  });

  const msg = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [transferIx],
  });

  const ix = multisigSdk.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: smartWalletPubkey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: msg,
    memo: 'Example vault transfer',
    rentPayer: payer.publicKey,
  });

  const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };

  await signMessage(
    action,
    {
      onSuccess: async (txns: any[]) => {
        for (const txn of txns) {
          if (txn.version === 0) {
            txn.sign([payer]);
            await connection.sendTransaction(txn, { skipPreflight: true });
          } else {
            txn.partialSign(payer);
            await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
          }
        }
      },
      onFail: (e: any) => {
        throw new Error(e?.message || 'Sign failed');
      },
      redirectUrl: 'exp://localhost:8081',
    }
  );
}
```

### Create a proposal

```ts
import { SmartWalletActionArgs, SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';

async function createProposal(multisig: string) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');
  const payer = Keypair.fromSecretKey(base58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!));

  const multisigPda = new PublicKey(multisig);
  const multisigInfo = await multisigSdk.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const currentTransactionIndex = Number(multisigInfo.transactionIndex);

  const ix = multisigSdk.instructions.proposalCreate({
    multisigPda,
    transactionIndex: BigInt(currentTransactionIndex),
    creator: smartWalletPubkey, // needs Voter permission
    rentPayer: payer.publicKey,
  });

 const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(action, {
    onSuccess: async () => {},
    onFail: (e: any) => {
      throw new Error(e?.message || 'Sign failed');
    },
    redirectUrl: 'exp://localhost:8081',
  });
}
```

### Approve / Reject / Cancel a proposal

```ts
import { SmartWalletActionArgs, SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';

async function approveProposal(multisig: string, transactionIndex: bigint) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');
  const ix = multisigSdk.instructions.proposalApprove({
    multisigPda: new PublicKey(multisig),
    transactionIndex,
    member: smartWalletPubkey,
  });
 const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(action, { redirectUrl: 'exp://localhost:8081' });
}

async function rejectProposal(multisig: string, transactionIndex: bigint) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');
  const ix = multisigSdk.instructions.proposalReject({
    multisigPda: new PublicKey(multisig),
    transactionIndex,
    member: smartWalletPubkey,
  });
 const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(action, { redirectUrl: 'exp://localhost:8081' });
}

async function cancelProposal(multisig: string, transactionIndex: bigint) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');
  const ix = multisigSdk.instructions.proposalCancel({
    multisigPda: new PublicKey(multisig),
    transactionIndex,
    member: smartWalletPubkey,
  });
  const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(action, { redirectUrl: 'exp://localhost:8081' });
}
```

### Execute a vault transaction

```ts
import { SmartWalletActionArgs, SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';

async function executeVaultTransaction(multisig: string, transactionIndex: bigint) {
  if (!smartWalletPubkey) throw new Error('Connect wallet first');

  const multisigPda = new PublicKey(multisig);
  const { instruction: ix } = await multisigSdk.instructions.vaultTransactionExecute({
    connection,
    multisigPda,
    transactionIndex,
    member: smartWalletPubkey, // needs Executor permission
  });

  const action: SmartWalletActionArgs = {
    type: SmartWalletAction.CreateChunk,
    args: {
      cpiInstructions: [ix],
      policyInstruction: null,
    },
  };
  await signMessage(action, { redirectUrl: 'exp://localhost:8081' });
}
```

### UI rules used in this repo (reference)

- Action availability by status:
  - Draft: Cancel only
  - Active: Approve / Reject (unless the connected wallet already voted)
  - Executing: visible in Available, no actions
- Tabs classification:
  - Available: Active, Draft, Executing
  - Not Available: everything else (Approved, Rejected, Executed, Cancelled)

### Notes

- The snippets use a demo payer key from `EXPO_PUBLIC_PRIVATE_KEY` to submit final transactions. In production, use secure key management.
- Always validate on-chain state (permissions, thresholds, member sets) before sending instructions.
- `redirectUrl` should be set to your development or production deep link.
