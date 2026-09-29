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

Show users the vault (`WalletInfo.vaultPda`); the exported PDA helpers derive
v2 addresses and are wrong for a v1 wallet. How `connect` finds a returning
user's wallet on either protocol is below.

Once LazorKit retires v1, a v1 wallet's transactions fail with
`V1WalletRetiredError`. Its funds are safe; move it with
`LazorKitClient.migrateV1Wallet` from `@lazorkit/sdk-legacy`, or send the user
to the LazorKit migration page.

## Which wallet is the user's

When nothing is stored yet, `connect` looks the passkey's wallet up on chain.
Looking it up is not enough: the credential-id hash that finds it is public,
and `CreateWallet` / `AddAuthority` / `TransferOwnership` take any owner
without that owner's consent. Anyone can list a user's passkey on a wallet they
still control, or hand them one after quietly keeping a way into its vault.
So `connect`:

1. keeps only the wallets whose stored key the passkey is proven to hold — the
   key the portal reports, or a signature over a fresh challenge (at most one
   extra passkey prompt per connect, and one more only to create a wallet for
   a passkey whose key the portal cannot report — below);
2. uses one on its own only when it is **the one wallet this passkey has signed
   for, and nothing else can spend from it**: no other authority, live session,
   pending deferred transaction or token approval, and a vault still owned by
   the System Program;
3. otherwise asks the user which wallet is theirs (below) — including a user's
   own wallet before its first transaction, a wallet made on the LazorKit
   migration page, and any time the passkey has signed for two wallets (a
   signature can be replayed onto a planted copy);
4. creates a new (v2) wallet only when the passkey holds none, for the
   passkey's own key (below). A wallet it just created is saved as it is,
   never looked up again.

A stored wallet is used as stored; none of this runs for it or for signing.

### A passkey that has no wallet yet

Every passkey starts without a v2 wallet, including one the user made long
ago on another device or browser. Signing in with it never reveals its public
key (WebAuthn's `get()` does not return one), so the portal reports the key it
has stored for that passkey: none for a passkey made elsewhere, and possibly
another passkey's. A wallet created for a key the passkey does not hold could
never sign, and whatever reached its vault would be stuck. So the key a new
wallet gets is always one a signature from this connect verifies against:

- a passkey the portal registered just now: the key it reports (no extra
  prompt);
- otherwise the reported key, once the ownership proof of step 1 verifies
  against it — as before: the connect reply's signature when the portal makes
  one, else one portal sign;
- otherwise the key **recovered from two of the passkey's signatures** over
  fresh challenges. One ECDSA signature narrows its signer down to a couple of
  candidate keys; a second over another challenge leaves one
  (`resolvePasskeyPublicKey`, `@lazorkit/sdk-legacy` 1.3.0). The two are the
  ownership proof and the connect reply's signature, or one more portal sign
  when the reply has none: **one extra passkey prompt** over the case above,
  a portal "sign" over a random challenge, with no transaction, for the same
  passkey.

So an existing passkey with no wallet now gets one, for its real key. Closing
that extra prompt rejects `connect` with `PortalCancelledError`. If the
signatures still do not settle on one key, `connect` throws an error that
says so. In both cases nothing is created.

A signature names its signer's key, never its passkey, and the wallet is
created under the passkey the connect reply names. So a recovered key is used
only when something ties it to that passkey: the connect reply's own
signature, or portal signs that name the passkey they were made with (the
portal signs with the passkey the SDK asks for, its only `allowCredentials`
entry, and names it back). When a wallet is to be created, a portal sign that
names another passkey fails `connect`, whichever key the portal reported; so
does recovery when nothing ties the key to the passkey. Nothing is created in
either case, since that passkey could never sign for a wallet with another's
key. Beyond that, the recovered key is whoever signed: those signatures, like
the reported key and the passkey's credential id, reach the SDK only from the
portal's origin, so this trusts the portal no more than before.

### Asking the user: `onConfirmWallet`

```tsx
<LazorkitProvider
  onConfirmWallet="builtin"            // default: the SDK's chooser
  trustedAuthorities={[BACKEND_ADMIN]}  // your own Ed25519 keys, base58
  watchMints={[MY_TOKEN_MINT]}          // SPL mints your app receives
>
```

- **`'builtin'`** (default) — a "Which wallet is yours?" dialog, drawn in the
  portal dialog's frame. Each row shows the vault address (full address
  selectable, with a copy button), its SOL balance, "Legacy (v1)" for a wallet
  not yet migrated, "Not used with this passkey yet…" for a wallet it has
  never signed for, and "Also controlled by: …" for everything untrusted that
  can spend from it (other passkeys, backend keys with their role, session
  keys and until when, pending transactions, token approvals, token accounts
  handed to someone else), with the full addresses under "Addresses". A vault
  handed to another program gets a warning of its own and no "Use this
  wallet" button. Rows come in no meaningful order, nothing is pre-selected,
  and no row is called safe: the SDK cannot see everything a former holder of
  a wallet may have left on its vault. "None of these", the X, Escape or a
  click outside declines.
- **a function** — your own UI. It gets `{ credentialId, candidates }` (a
  `WalletChoice[]`) and returns `{ wallet }` — the chosen `vault` (or
  `wallet`) — or `null`:

  ```ts
  onConfirmWallet={async ({ candidates }) => {
    const chosen = await myWalletPicker(candidates); // show c.vault, never pick for the user
    return chosen ? { wallet: chosen.vault } : null;
  }}
  ```
- **`'throw'`** — `connect` throws `WalletNeedsConfirmationError`, whose
  `candidates` are the same `WalletChoice[]`. Once the user picks one, call
  `connect({ confirmWallet: choice.vault })`; within 2 minutes that adopts it
  without a second passkey prompt (after that, or after `disconnect`, the
  portal opens again):

  ```ts
  try {
    await connect();
  } catch (e) {
    if (e instanceof WalletNeedsConfirmationError) {
      const choice = await askUser(e.candidates);
      if (choice) await connect({ confirmWallet: choice.vault });
    } else throw e;
  }
  ```

Each call can override the provider: `connect({ onConfirmWallet })`.

`confirmWallet` takes the vault or the wallet PDA of a wallet the passkey is
proven to hold, and can also name one the chooser would not offer a button for.
One that names none of them throws an error naming it — it is never ignored.
While a wallet is connected, a `confirmWallet` naming another one throws too:
disconnect first.

`trustedAuthorities` are your own Ed25519 keys — a backend admin, session keys
you issue. An authority, session or token approval held by one of them does
not stop a wallet from being used on its own, and is not listed in the
chooser. Passkeys cannot be trusted this way, nor can a pending deferred
transaction or a vault handed to another program. `watchMints` adds your
app's SPL mints to the ones whose vault token account is checked for having
been handed to someone else (wSOL, USDC, USDT and devnet USDC always are): an
account moved away for any other mint cannot be found.

Errors:

| Error | When |
|---|---|
| `WalletNeedsConfirmationError` | `onConfirmWallet: 'throw'` and the wallet needs the user. `credentialId`, `candidates: WalletChoice[]`. |
| `WalletConfirmationDeclinedError` | The user chose none ("None of these", or your handler returned `null`). Nothing was saved. |
| `PortalCancelledError` | The user closed the portal dialog (X, Escape, a click outside) or its popup window before it answered — on connect and on every signing action. Raised at once, not after the 60 s timeout. Also what a `connect` still running rejects with when `disconnect` is called: its portal or chooser closes and it connects nothing. |

If the chain cannot be read, `connect` fails; that is never taken as "no
wallet". Portal errors carry the portal's own message.

The wallet-adapter takes the same options in its config (`new
LazorkitWalletAdapter({ onConfirmWallet, trustedAuthorities, watchMints, ...
})`), and `adapter.connect({ confirmWallet, onConfirmWallet })` per call. With
`'throw'`, catch the error (wallet-adapter's `onError`), then set
`adapter.confirmWallet = choice.vault` and connect again. A second `connect`
while one is running waits for it rather than opening another portal.

`registerLazorkitWallet({ ... })` (the Wallet Standard wallet) takes the same
options except `onConfirmWallet: 'throw'`, which it rejects: `standard:connect`
cannot pass `confirmWallet`, so the user could never finish. Use `'builtin'`
or your own handler there.

Finding wallets yourself with `@lazorkit/sdk-legacy`? Do not take the first
wallet `findWalletsByAuthority(credentialIdHash)` returns — anyone can plant
one there. Use `LazorKitClient.findOwnPasskeyWallet` with a proof over
`createOwnershipChallenge()`; `pickOwnWallet`, `verifyOwnershipProof` and
`selectWalletByAddress` are re-exported here. To create a wallet for a passkey
whose key you do not have, see `resolvePasskeyPublicKey` in
`@lazorkit/sdk-legacy`, and its notes on where the signatures must come from.

## API Reference

### `useWallet()`

#### `connect(options?)`

Connects the stored wallet, or finds the passkey's own (see
[Which wallet is the user's](#which-wallet-is-the-users)).

**Parameters**

| Param | Type | Description |
|---|---|---|
| `options.confirmWallet` | `string` | Vault (or wallet) address the user recognised after `WalletNeedsConfirmationError`. |
| `options.onConfirmWallet` | `'builtin' \| 'throw' \| (req) => …` | Overrides the provider's for this call. |

**Returns**
`Promise<WalletInfo>`

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
