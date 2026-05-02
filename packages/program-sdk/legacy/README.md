# @lazorkit/sdk-legacy

TypeScript SDK for the LazorKit smart wallet on Solana. Built for `@solana/web3.js` v1. (A `@lazorkit/sdk` for web3.js v2 is coming soon.)

Provides:

- Hand-written instruction builders for every LazorKit instruction
- `LazorKitClient` — high-level API that auto-derives PDAs, fetches slots, reads counters, packs compact instructions, and handles protocol fees
- Two-phase passkey signing (`prepare*` / `finalize*`) for async WebAuthn flows
- `DeferredPayload` serialization for TX1-on-device / TX2-on-relayer flows
- Wallet lookup by credential hash (no need to track `walletPda` yourself)

## Install

```bash
npm install @lazorkit/sdk-legacy
```

## Quick start

```typescript
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import { LazorKitClient, ed25519 } from '@lazorkit/sdk-legacy';
import * as crypto from 'crypto';

// Cluster is inferred from the RPC endpoint:
//   - URLs containing "mainnet" → mainnet program ID
//   - URLs containing "devnet"  → devnet program ID
//   - localhost / 127.0.0.1     → devnet program ID (local-validator convention)
//   - anything else              → throws; pass an explicit programId
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const client = new LazorKitClient(connection);

// Custom RPC providers without a recognisable hostname, forks, or local
// deployments using a different keypair → pass the program ID explicitly:
//
// import { PROGRAM_ID_MAINNET, PROGRAM_ID_DEVNET } from '@lazorkit/sdk-legacy';
// const client = new LazorKitClient(connection, PROGRAM_ID_MAINNET);
```

### Cluster + program IDs

LazorKit is deployed at two distinct, cluster-specific program IDs (the SBF
binary embeds the ID via `declare_id!`, so a binary built for one cluster
cannot serve the other):

| Cluster | Program ID |
|---|---|
| mainnet-beta | `LazorjRFNavitUaBu5m3WaNPjU1maipvSW2rZfAFAKi` |
| devnet | `4h3XoNReAgEcHVxcZ8sw2aufi9MTr7BbvYYjzjWDyDxS` |

Both are exported as `PROGRAM_ADDRESS_MAINNET` / `PROGRAM_ID_MAINNET` and
`PROGRAM_ADDRESS_DEVNET` / `PROGRAM_ID_DEVNET`. The `LazorKitClient`
constructor auto-selects the right one based on the connection's RPC
endpoint; pass an explicit `programId` argument to override.

### Create a wallet

The `owner` field accepts either of two auth types. A wallet can later hold any mix of Ed25519 and Secp256r1 authorities across its owner / admin / spender roles.

**Passkey owner** (Secp256r1 — end-user WebAuthn flows):

```typescript
const { instructions, walletPda, vaultPda, authorityPda } = await client.createWallet({
  payer: payer.publicKey,
  userSeed: crypto.randomBytes(32),
  owner: {
    type: 'secp256r1',
    credentialIdHash,    // SHA-256 of WebAuthn credential ID
    compressedPubkey,    // 33-byte compressed public key
    rpId: 'your-app.com',
  },
});
await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);

// Later: find the same wallet back from just the credential hash
const [wallet] = await client.findWalletsByAuthority(credentialIdHash);
```

**Ed25519 owner** (regular Solana keypair — bots, backends, programmatic signing):

```typescript
const ownerKp = Keypair.generate();
const { instructions, walletPda, vaultPda, authorityPda } = await client.createWallet({
  payer: payer.publicKey,
  userSeed: crypto.randomBytes(32),
  owner: {
    type: 'ed25519',
    publicKey: ownerKp.publicKey,
  },
});
await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);

// Lookup — pass 'ed25519' as the second arg
const [wallet] = await client.findWalletsByAuthority(ownerKp.publicKey.toBytes(), 'ed25519');
```

### Add more authorities

Any mix of auth types on the same wallet. Typical patterns:

- Passkey owner + Ed25519 admin — user's phone is the owner, a backend bot manages sessions on their behalf.
- Ed25519 owner + Secp256r1 spender — the backend creates and manages the wallet, the user's passkey does day-to-day spends.

```typescript
import { ROLE_ADMIN, ROLE_SPENDER } from '@lazorkit/sdk-legacy';

// Ed25519 owner adds an Ed25519 admin
const adminKp = Keypair.generate();
const { instructions, newAuthorityPda } = await client.addAuthority({
  payer: payer.publicKey,
  walletPda,
  adminSigner: ed25519(ownerKp.publicKey),
  newAuthority: { type: 'ed25519', publicKey: adminKp.publicKey },
  role: ROLE_ADMIN,
});
await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer, ownerKp]);

// Ed25519 owner adds a Secp256r1 (passkey) spender — the user's phone
const { instructions: addPasskeyIxs } = await client.addAuthority({
  payer: payer.publicKey,
  walletPda,
  adminSigner: ed25519(ownerKp.publicKey),
  newAuthority: {
    type: 'secp256r1',
    credentialIdHash,
    compressedPubkey,
    rpId: 'your-app.com',
  },
  role: ROLE_SPENDER,
});
```

To let a **passkey** admin add the new authority, use `prepareAddAuthority` + `finalizeAddAuthority` (same two-phase pattern as `prepareExecute` below).

## Signing a transaction

### Ed25519 authority (simple)

The keypair signs the transaction at the Solana level — no prepare/finalize needed. Just pass the public key as the signer and include the keypair in the tx signers.

```typescript
const { instructions } = await client.execute({
  payer: payer.publicKey,
  walletPda,
  signer: ed25519(ownerKp.publicKey),
  instructions: [SystemProgram.transfer({
    fromPubkey: vaultPda, toPubkey: recipient, lamports: 1_000_000,
  })],
});
await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer, ownerKp]);

// Convenience helper:
const { instructions: xferIxs } = await client.transferSol({
  payer: payer.publicKey,
  walletPda,
  signer: ed25519(ownerKp.publicKey),
  recipient,
  lamports: 1_000_000n,
});
```

### Passkey authority (two-phase flow)

Real WebAuthn is asynchronous — the browser popup happens between challenge computation and transaction construction. The SDK splits signing accordingly.

```typescript
// 1. SDK computes the challenge
const prepared = await client.prepareExecute({
  payer: payer.publicKey,
  walletPda: wallet.walletPda,
  secp256r1: {
    credentialIdHash,
    authorityPda: wallet.authorityPda,
    // publicKeyBytes is optional — auto-fetched from on-chain authority if omitted
  },
  instructions: [SystemProgram.transfer({
    fromPubkey: wallet.vaultPda,
    toPubkey: recipient,
    lamports: 1_000_000,
  })],
});

// 2. Authenticator signs (your code calls navigator.credentials.get)
const credential = await navigator.credentials.get({
  publicKey: {
    challenge: prepared.challenge,
    rpId: 'your-app.com',
    allowCredentials: [{ type: 'public-key', id: credentialIdBytes }],
  },
});
const response = credential.response as AuthenticatorAssertionResponse;

// 3. SDK builds the transaction
const { instructions: execIxs } = client.finalizeExecute(prepared, {
  signature: normalizeToLowS(response.signature),
  authenticatorData: new Uint8Array(response.authenticatorData),
  clientDataJsonHash: await sha256(response.clientDataJSON),
  clientDataJson: new Uint8Array(response.clientDataJSON),
});
```

**Every passkey operation has this three-phase shape** — `prepareExecute`, `prepareAddAuthority`, `prepareRemoveAuthority`, `prepareTransferOwnership`, `prepareCreateSession`, `prepareRevokeSession`, `prepareAuthorize`. Each pairs with a `finalizeX` that takes the WebAuthn response.

Helper for wrapping the `navigator.credentials.get` → `WebAuthnResponse` conversion once:

```typescript
import type { WebAuthnResponse } from '@lazorkit/sdk-legacy';

async function getWebAuthnResponse(
  challenge: Uint8Array, rpId: string, credentialId: BufferSource,
): Promise<WebAuthnResponse> {
  const credential = await navigator.credentials.get({
    publicKey: { challenge, rpId, allowCredentials: [{ type: 'public-key', id: credentialId }] },
  });
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    signature: normalizeToLowS(response.signature),  // DER → raw r||s, low-S
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJsonHash: new Uint8Array(await crypto.subtle.digest('SHA-256', response.clientDataJSON)),
    clientDataJson: new Uint8Array(response.clientDataJSON),
  };
}
```

## High-level client API

Every method returns `{ instructions: TransactionInstruction[]; ...extraPdas }`.

### Wallet operations

```typescript
client.createWallet({ payer, userSeed, owner });

// Execute (Ed25519 or session key — for passkeys use prepareExecute/finalizeExecute)
client.execute({ payer, walletPda, signer, instructions });

// Convenience: SOL transfer
client.transferSol({ payer, walletPda, signer, recipient, lamports });

// Authority management — for passkeys use prepare/finalize pairs
client.addAuthority({ payer, walletPda, adminSigner, newAuthority, role });
client.removeAuthority({ payer, walletPda, adminSigner, targetAuthorityPda });
client.transferOwnership({ payer, walletPda, ownerSigner, newOwner });
```

### Protocol fees & auto-registration

When the protocol is initialized and enabled (admin-only operation), the SDK transparently appends the four fee accounts (`protocol_config`, `fee_record`, `treasury_shard`, `system_program`) to every fee-eligible instruction (`createWallet`, `execute`, `executeDeferred`). The on-chain entrypoint transfers the fee from the payer to a randomly-chosen treasury shard, then strips the accounts before dispatching to the processor.

```typescript
// Nothing extra to do — fee handling is automatic
await client.createWallet({ payer, userSeed, owner });   // 5000 lamport protocol fee
await client.execute({ payer, walletPda, signer, instructions });  // 5000 lamport protocol fee
```

**Auto-registration**: a `FeeRecord` PDA tracks per-payer cumulative fees. The SDK auto-prepends a one-time `RegisterPayer` instruction on the payer's first fee-paying tx (~0.00112 SOL of FeeRecord rent, paid by the payer). An in-memory cache short-circuits the existence check on subsequent calls. Fee collection works regardless — registration only enables stats tracking.

If you want to register explicitly (e.g. to front-load the cost during onboarding):

```typescript
const { instructions, feeRecordPda } = client.registerPayer({ payer: payer.publicKey });
await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);
```

The `registerPayer` instruction is **permissionless** — any payer registers themselves, no admin signature needed.

For advanced flows (custom tx assembly, gasless relayer pre-sim), the resolver methods are exposed:

```typescript
// Returns { protocolConfigPda, feeRecordPda, treasuryShardPda } | undefined
const fee = await client.resolveProtocolFee(payer);

// Same plus an optional `registerIx` to prepend if the FeeRecord doesn't exist yet
const { accounts, registerIx } = await client.resolveProtocolFeeWithRegister(payer) ?? {};
```

If the protocol isn't initialized or is disabled, both resolvers return `undefined` and the SDK skips fee accounts entirely.

### Sessions

```typescript
import { Actions } from '@lazorkit/sdk-legacy';

const { instructions, sessionPda } = await client.createSession({
  payer, walletPda,
  adminSigner: ed25519(ownerKp.publicKey),
  sessionKey: sessionKp.publicKey,
  expiresAt: currentSlot + 9000n,
  actions: [
    Actions.programWhitelist(SystemProgram.programId),
    Actions.solMaxPerTx(1_000_000_000n),
    Actions.solLimit(10_000_000_000n),
  ],
});

// Later, execute via session key
await client.execute({
  payer, walletPda,
  signer: session(sessionPda, sessionKp.publicKey),
  instructions: [...],
});

// Early revoke
client.revokeSession({ payer, walletPda, adminSigner, sessionPda });
```

Action builders (via `Actions`):

| Builder | Notes |
|---|---|
| `Actions.solLimit(remaining, expiresAt?)` | Lifetime SOL cap |
| `Actions.solRecurringLimit({ limit, window, expiresAt? })` | Per-window SOL cap |
| `Actions.solMaxPerTx(max, expiresAt?)` | Max SOL per execute (gross outflow, not net) |
| `Actions.tokenLimit({ mint, remaining, expiresAt? })` | Lifetime token cap |
| `Actions.tokenRecurringLimit({ mint, limit, window, expiresAt? })` | Per-window token cap |
| `Actions.tokenMaxPerTx({ mint, max, expiresAt? })` | Max tokens per execute |
| `Actions.programWhitelist(programId, expiresAt?)` | Only allow these programs (repeatable) |
| `Actions.programBlacklist(programId, expiresAt?)` | Block these programs (repeatable) |

### Deferred execution (2-tx flow)

For payloads that don't fit in a single Secp256r1 Execute tx (e.g., Jupiter swaps with complex routing):

```typescript
// TX1 — on user's device
const prepared = await client.prepareAuthorize({
  payer, walletPda,
  secp256r1: { credentialIdHash, authorityPda },
  instructions: [jupiterSwapIx],
  expiryOffset: 300,  // slots (~2 min)
});
const webauthnResponse = await getWebAuthnResponse(prepared.challenge, rpId, credentialId);
const { instructions: tx1, deferredPayload } = client.finalizeAuthorize(prepared, webauthnResponse);
await sendAndConfirmTransaction(connection, new Transaction().add(...tx1), [payer]);

// Send `deferredPayload` to a relayer (HTTP, WebSocket, whatever)
import { serializeDeferredPayload } from '@lazorkit/sdk-legacy';
const wire = serializeDeferredPayload(deferredPayload);

// TX2 — on the relayer
import { deserializeDeferredPayload } from '@lazorkit/sdk-legacy';
const payload = deserializeDeferredPayload(receivedWire);
const { instructions: tx2 } = await client.executeDeferredFromPayload({
  payer: relayer.publicKey,
  deferredPayload: payload,
});
```

If TX2 never gets submitted and the expiry passes, the original payer can reclaim their rent via `client.reclaimDeferred(...)`.

### Wallet lookup

```typescript
// All wallets the credential can access
const wallets = await client.findWalletsByAuthority(credentialIdHash);

// Ed25519 authority lookup
const ed25519Wallets = await client.findWalletsByAuthority(pubkeyBytes, 'ed25519');

// Each: { walletPda, authorityPda, vaultPda, role, authorityType }
```

Uses `getProgramAccounts` with discriminator + authority_type + credential filters.

### PDA helpers

```typescript
import {
  findWalletPda, findVaultPda, findAuthorityPda, findSessionPda, findDeferredExecPda,
  findProtocolConfigPda, findFeeRecordPda, findTreasuryShardPda,
} from '@lazorkit/sdk-legacy';
```

### Generated account readers

```typescript
import {
  AuthorityAccount, SessionAccount, ProtocolConfigAccount, FeeRecordAccount, TreasuryShardAccount,
} from '@lazorkit/sdk-legacy';

const authority = await AuthorityAccount.fromAccountAddress(connection, authorityPda);
```

## Transactions (legacy + v0)

Every `client.*` method returns raw `TransactionInstruction[]` — composable so you can append your own ix (priority fees, custom CPIs) before sending. For when you want to skip the boilerplate, the SDK ships three small helpers:

```typescript
import {
  buildLegacyTx,
  buildV0Tx,
  createAndExtendLut,
} from '@lazorkit/sdk-legacy';
```

### Legacy

```typescript
const { blockhash } = await connection.getLatestBlockhash('confirmed');

const tx = buildLegacyTx({
  payer: payer.publicKey,
  instructions,
  blockhash,
  signers: [payer],
});

await connection.sendRawTransaction(tx.serialize());
```

### Versioned (v0) with Address Lookup Tables

A LazorKit-tuned ALT containing the system program, sysvars, `protocol_config`, and all `treasury_shard` PDAs saves **~88 B per Secp256r1 Execute** — useful headroom when chaining multiple inner instructions or calling Jupiter/bridges.

```typescript
import {
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';

// One-time setup — bootstrap the LUT
const [protocolConfigPda] = client.findProtocolConfig();
const treasuryShards = Array.from({ length: numShards }, (_, i) =>
  client.findTreasuryShard(i)[0],
);

const lut = await createAndExtendLut({
  connection,
  authority: relayerKeypair,   // also pays rent + becomes the LUT authority
  addresses: [
    SystemProgram.programId,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    protocolConfigPda,
    ...treasuryShards,
  ],
});

// Per-tx — wrap any client.* result
const v0Tx = buildV0Tx({
  payer: payer.publicKey,
  instructions,
  blockhash,
  signers: [payer],
  lookupTables: [lut],
});

await connection.sendRawTransaction(v0Tx.serialize());
```

`createAndExtendLut` handles the slot-finalization quirk (the AddressLookupTable program rejects `recentSlot` from `confirmed` as too new), chunks extends in groups of 30, and waits one slot before returning so the table is usable in the same session.

**When to use which**: prefer v0+LUT for `execute` (especially Secp256r1) and `executeDeferred`. For tiny instructions (`removeAuthority`, `revokeSession`, `reclaimDeferred`) the v0 wrapper actually adds 2 B because the LUT reference itself costs more than was saved — keep using legacy for those. Full size deltas per instruction are in [`tests-sdk/tests/benchmark-fees.ts`](../../tests-sdk/tests/benchmark-fees.ts).

## Low-level builders

If you need to construct transactions outside the client API, the instruction builders are directly importable:

```typescript
import {
  createCreateWalletIx, createAddAuthorityIx, createExecuteIx,
  prepareSecp256r1, finalizeSecp256r1,
  packCompactInstructions, computeAccountsHash, computeInstructionsHash,
  buildDataPayloadForAdd, buildDataPayloadForTransfer, buildDataPayloadForSession,
} from '@lazorkit/sdk-legacy';
```

The ref implementations are in `tests-sdk/tests/05-replay.test.ts`, `06-counter.test.ts`, and `08-deferred.test.ts`.

## Constants

```typescript
// Instruction discriminators
DISC_CREATE_WALLET = 0
DISC_ADD_AUTHORITY = 1
DISC_REMOVE_AUTHORITY = 2
DISC_TRANSFER_OWNERSHIP = 3
DISC_EXECUTE = 4
DISC_CREATE_SESSION = 5
DISC_AUTHORIZE = 6
DISC_EXECUTE_DEFERRED = 7
DISC_RECLAIM_DEFERRED = 8
DISC_REVOKE_SESSION = 9
// Protocol admin (10-14)

// Auth types
AUTH_TYPE_ED25519 = 0
AUTH_TYPE_SECP256R1 = 1

// Roles
ROLE_OWNER = 0
ROLE_ADMIN = 1
ROLE_SPENDER = 2
```

## Error codes

| Code | Name |
|---|---|
| 3001 | InvalidAuthorityPayload |
| 3002 | PermissionDenied |
| 3005 | InvalidMessageHash |
| 3006 | SignatureReused (counter mismatch) |
| 3007 | InvalidSignatureAge |
| 3008 | InvalidSessionDuration |
| 3009 | SessionExpired |
| 3013 | SelfReentrancyNotAllowed |
| 3014 | DeferredAuthorizationExpired |
| 3015 | DeferredHashMismatch |
| 3016 | InvalidExpiryWindow |
| 3020–3029 | Action errors (buffer invalid, whitelist/blacklist, spending limits exceeded) |
| 3030 | SessionVaultOwnerChanged (H1 fix) |
| 3031 | SessionVaultDataLenChanged (H1 fix) |
| 3032 | SessionTokenAuthorityChanged (H1 fix) |
| 4001–4007 | Protocol fee errors |

See [`docs/Architecture.md`](../../docs/Architecture.md) for the full security model and account layouts.

## License

MIT
