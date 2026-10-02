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
`V1WalletRetiredError`, on the paymaster's first answer: the retired program
answers every attempt with the same 4018, so it is not retried. Its funds are
safe; move it with `LazorKitClient.migrateV1Wallet` from `@lazorkit/sdk-legacy`,
or send the user to the LazorKit migration page.

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

## Sending transactions

Every send resolves once its transaction is **confirmed**, and rejects if it
failed on chain: `signAndSendTransaction`, `authorizeAndExecute`,
`authorizeDeferred`, `executeDeferred`, the session and authority sends,
`LazorkitWalletAdapter.sendTransaction` and the Wallet Standard
`signAndSendTransaction`. The paymaster's answer is not enough: a relayer
that answers once the RPC accepted a transaction answers before it has run.
Kora confirms before it answers by default, so there the wait is one status
read.

So two sends in a row are safe (`await` one, then the other). A passkey
signature commits to the passkey's counter, which the program checks
(`SignatureReused`, 3006): the wallet prepares each signature for a passkey
only after that passkey's previous transaction is confirmed, and reads the
counter at `confirmed` from an RPC node that has executed it
(`minContextSlot`). Calls for the same passkey made at the same time, through
the store, the adapter or both, run one after another. The store still
refuses a second call while one of its own is signing ("Already signing").

**Callbacks.** Every action of `useWallet()` and the store takes `onSuccess`
and `onFail` (`connect` and `disconnect` in their options, `removeAuthority`
and `signMessage` as their second argument). Exactly one of them runs per
call, and it agrees with the promise: `onSuccess` with what the promise
resolves with, `onFail` with the error it rejects with, a refusal ("Already
signing", "No wallet connected") included. It runs once the action is over,
with `isSigning` (or `isConnecting`) already `false`, right before the promise
settles. So a send made from `onSuccess` runs, as one made on the line after
`await` does. The one exception is a call refused because another is running
("Already signing", "Already connecting"): its `onFail` runs at once, and the
flag stays `true`, since it belongs to the call that is running. What a
callback throws is logged and changes nothing: a transaction that landed is
never reported as failed, `onFail` is not called for it and `error` stays
clear, and a throwing `onFail` does not replace the error. A refusal because
another call is signing leaves `error` alone (it is that call's); one for want
of a wallet sets it. `disconnect` leaves `isSigning` to an action still
running, which goes on to its end and its callbacks; until then a new action
is refused with "Already signing". `@lazorkit/wallet-mobile-adapter` keeps the
same contract. `LazorkitWalletAdapter` and the Wallet Standard wallet call
each `connect`, `disconnect` or `change` listener on its own, and log what one
throws: it neither stops the listeners after it nor fails a connect that has
happened.

| Error | When |
|---|---|
| `TransactionFailedError` | The transaction landed and failed: fees were paid, nothing else changed. `signature`, `transactionError`, `slot`, and `logs` when they were read. |
| `TransactionExpiredError` | It did not land before its blockhash expired, so it never will. Concluded only from an RPC node past that point, in its transaction history, never from a status cache that has forgotten a landed transaction. |
| `TransactionOutcomeUnknownError` | Whether it landed is not known: check before sending it again. `signature` is `undefined` when the paymaster's answer was lost (a network error, a timeout, a gateway error, or a resend of the same bytes that found them already processed). |
| `ConfirmationTimeoutError` | A `TransactionOutcomeUnknownError`: no outcome within two minutes, and it may still land. Check `signature` before sending again. |
| `PreviousTransactionPendingError` | Nothing was signed or sent: the passkey's previous transaction (`pendingSignature`) still has no known outcome, and a new signature could be bound to the counter it may use. Try again later. |
| `SignatureReusedError` | LazorKit rejected the passkey signature (3006): its counter was already used. Left for the same passkey signing somewhere else at the same moment, or a paymaster reading older state than the wallet. That signature can never be valid, so it is not resent, and no new prompt opens on its own: ask the user to sign again. An inner program's error with the same code (Anchor's `AccountNotMutable`) is told apart by the logs and reported as the failure it is. |
| `PaymasterError` | The paymaster refused the transaction: `code` and `data` of its JSON-RPC error, or `httpStatus`. |
| `DeferredExpiredError` | TX2 of a deferred execution (`authorizeAndExecute`, `executeDeferred`) came after its authorization expired (`DeferredAuthorizationExpired`, 3014), so nothing in it ran. `authorizeSignature` (TX1, when this call sent it), `deferredExecPda` (the account holding the paymaster's rent until the Authorize payer reclaims it) and `expiresAtSlot`. The passkey approval is spent: ask the user to approve again. An inner program's 3014 is not reported as this (see below). |

Every status read and paymaster request is bounded in time, so one that never
answers cannot hold a passkey's queue. The slot the passkey's last transaction
landed in, and a send whose outcome is not known yet, are also kept in
localStorage (the slot for ten minutes): a reload or a second tab of the same
app reads its first challenge from a node that has that transaction. Two tabs
that sign for the same passkey at the same moment are still not serialized.

**Deferred execution.** `authorizeAndExecute` and `authorizeDeferred` take
`expiryOffset`: how many slots after TX1 the program still accepts TX2 (10 to
9000). The default, `DEFAULTS.DEFERRED_EXPIRY_SLOTS`, is 1500. The window is
counted in slots, whose length depends on the cluster and its load, and it
starts at TX1's slot, not when `authorizeDeferred` resolves. The wallet may
wait up to two minutes for TX1 to be confirmed before it sends TX2, so do not
pass a small value. The window is also how long an approval that is never
executed stays executable, with the paymaster's rent in it: the program has no
way to cancel an authorization before it expires.

An authorization that has already expired is not sent, and a paymaster's 3014
is not retried. A 3014 rejects with `DeferredExpiredError` only when it is the
authorization's own: its logs name LazorKit as the first program to fail, it
landed on chain after `expires_at`, or the chain is past `expires_at` when the
wallet reads it again (at `processed`). An inner program may return 3014 too
(Anchor's `AccountNotAssociatedTokenAccount`): that error, and a 3014 whose
program cannot be told, is thrown as it came. An error from sending TX2 carries
`deferredExecPda`, `authorizeSignature` (when the call sent TX1) and
`expiresAtSlot` (when it was read): `DeferredFailureContext`.
`isDeferredExpiredError` is true for a `DeferredExpiredError`, and for a 3014
whose logs name LazorKit as the first program to fail; not for a 3014 that
names no program.

**Recognising errors.** `isSignatureReusedError`, `isDeferredExpiredError` and
`isRetiredDeploymentError(error, version?)` are true for the SDK's own error
(`SignatureReusedError`, `DeferredExpiredError`, `V1WalletRetiredError`):
- from whichever copy of the package made it. An app whose dependencies load
  both the ESM and the CJS build has two copies of every class, and
  `instanceof` fails between them; the predicates match by `name` and `code`.
- wrapped, in `cause` or in a wallet-adapter `WalletError`'s `error`. A dApp
  that reaches the wallet through the Wallet Standard gets every error as
  `WalletSendTransactionError(message, error)`.

They also recognise the raw program error, as web3.js text (`0xbbe`, `0xbc6`,
`0xfb2`), a TransactionError (`"Custom":3006`), Kora's text (`Custom(3006)`)
or with the logs in a paymaster's `data`. For a raw error the logs decide
whose it is: a 3006 with no logs counts as LazorKit's, a 3014 with no logs
does not, and a 4018 counts when the logs name the v1 program or `version` is
1. The other error classes have no predicate: compare `error.name`
(`'TransactionFailedError'`, `'PaymasterError'`, `'V1WalletMigratedError'`,
`'WalletNeedsConfirmationError'`, …), which holds across copies too.

The portal's transaction preview is compiled without lookup tables whenever it
fits in a packet, so the portal sees every account the transaction touches.
Only a payload over the 1232-byte limit is compiled with the lookup tables the
transaction is sent with (`transactionOptions.addressLookupTableAccounts`, or
those of a dApp's v0 transaction), and a preview still over the limit no longer
fails the call before the prompt.

## Session and authority keys

`createSession()` without `sessionKey`, and `addAuthority()`, generate an
Ed25519 key in the browser and register its public key on chain with one
passkey approval. The SDK keeps the key, so `signAndSendWithSession` and
`signAndSendWithAuthority` sign with no passkey prompt. It keeps one key of
each kind: a new session or authority replaces the last one.

Where the key is kept is set by `keyStorage` on `LazorkitProvider`. The
default is `'auto'`, which uses the best of these the browser has:

1. **A non-extractable WebCrypto Ed25519 key in IndexedDB** (database
   `lazorkit-keys`), which signs with `crypto.subtle`. No script can read its
   secret: a script running on the page can make it sign while the page is
   open, but cannot copy it out. Supported in Chrome and Edge 137+, Firefox
   129+, Safari and iOS 17+, and Android WebView 137+.
2. **The seed, sealed with AES-GCM** under a non-extractable AES key in the
   same database. This is for browsers without WebCrypto Ed25519 (iOS 16,
   older Chrome and WebViews), and for an IndexedDB that cannot hold an
   Ed25519 key. It only keeps the key out of localStorage. Any script running
   on the page can read the sealed seed and have the AES key decrypt it, so
   against XSS this tier is no better than 3.2's plaintext. Once the browser
   has Ed25519, the seed is moved to (1).
3. **This page's memory.** This is used without IndexedDB (storage blocked,
   some private windows), outside a secure context, or where IndexedDB cannot
   hold a WebCrypto key at all. The key is gone on reload. Its session stays
   on chain until it expires, with no one holding the key.

`keyStorage="memory"` uses (3) everywhere and keeps nothing at rest. With it,
keys that an earlier `'auto'` run stored in IndexedDB are not read.

Nothing is written to localStorage any more, and a `sessionKey` you pass in is
never stored: only you hold its secret.

**What this does not protect against.** In (1) and (2) the key is still at
rest in the browser profile. Chromium writes a non-extractable key's bytes to
the profile's IndexedDB files unencrypted (checked in Chrome for Testing 147;
Firefox and Safari were not checked), and in (2) the AES key is stored next to
the seed it seals. So malware that can read the browser profile can copy the
key, as it could the localStorage entry in 3.2. A script injected into your
page can make the key sign anything while the page is open, in every tier. For
no key at rest at all, use `keyStorage="memory"`.

**Upgrading from 3.2 or earlier.** Those releases kept these keys in
localStorage as plaintext secret keys (`lazorkit-session`,
`lazorkit-authority`). Such a key is moved when `LazorkitProvider` mounts, or
on its first use, and the plaintext is deleted once the move has been written.
If the write fails, or IndexedDB does not open (an error, or no answer within
5 seconds), the plaintext stays, the key still signs on this page, and the
move is tried again on the next use. A write that keeps failing (a full disk,
say) leaves the plaintext where it is until one succeeds. Where the key can
only go to memory (3), the plaintext is deleted anyway. An entry in those
slots that this SDK did not write is left untouched, and no key is read from
it. After the move, going back to 3.2 or earlier finds no key ("No session key
found. Create a session first."), and the user creates a new session.

**If your app removed `lazorkit-session` / `lazorkit-authority` at sign-out**
(or called `localStorage.clear()`), that no longer removes the keys: they are
in IndexedDB now. Call `forgetStoredKeys()` instead:

```tsx
import { forgetStoredKeys, useWallet } from '@lazorkit/wallet';

function SignOutButton() {
  const { disconnect } = useWallet();
  return (
    <button
      onClick={async () => {
        await disconnect();
        await forgetStoredKeys();
      }}
    >
      Sign out
    </button>
  );
}
```

**When a kept key is deleted.**
- `revokeSession()` deletes the kept session key once the revoke lands.
  Revoking a different session leaves it alone.
- `removeAuthority` deletes the kept authority key when it removes that
  authority.
- `forgetStoredKeys()` deletes both, wherever they are kept: IndexedDB, this
  page's memory, and any plaintext an earlier release left. It rejects if
  IndexedDB holds keys and could not be cleared.
- `disconnect` keeps both keys. A kept key also signs with no wallet
  connected: `signAndSendWithSession` and `signAndSendWithAuthority` sign for
  the wallet the key was registered for, whichever wallet is connected, or
  none. On a shared computer, call `forgetStoredKeys()` at sign-out.

If a key cannot be stored after its session or authority has landed, the call
still succeeds: the key signs for the rest of this page, and a warning is
logged. If IndexedDB only failed this time, the key is stored on its next use
here, unless another tab has stored a newer key meanwhile.

**What bounds a kept key** is what was registered on chain, not where the key
is kept. A session is bounded by its `spendingLimits` and its expiry.
`addAuthority` defaults to `ROLE_ADMIN`, which has no spending policy and no
expiry. For a key that only spends, prefer `ROLE_SPENDER` with a `policy`.

**Signatures.** Ed25519 as RFC 8032 defines it is deterministic: Chromium and
Node sign exactly as web3.js's `Keypair` does with the same seed (the package's
tests check this byte for byte). Safari signs with a random nonce instead, so
the same message gets a different signature each time. Each one is valid, and
nothing in the SDK depends on the signature bytes.

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
| `options.onSuccess` | `(wallet: WalletInfo) => void` | Runs once `isConnecting` is `false`, right before the promise resolves (see [Callbacks](#sending-transactions)). |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns**
`Promise<WalletInfo>`

#### `disconnect(options?)`

Disconnects the wallet. `options.onSuccess` / `options.onFail` run once it is
over, as every action's do. An action still running is not abandoned: it keeps
`isSigning` until it ends. The session and authority keys the SDK keeps stay
(see `forgetStoredKeys()` below).

**Returns** 
`Promise<void>`

#### `signMessage(message, options?)`

Signs a message string key.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `message` | `string` | Message content |
| `options.onSuccess` | `(result: { signature: string, signedPayload: string }) => void` | Runs once `isSigning` is `false`, right before the promise resolves (see [Callbacks](#sending-transactions)). |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

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
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Lookup tables for v0 txs (the portal preview uses them too). |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Network for simulation. |
| `payload.onSuccess` | `(signature: string) => void` | Runs once `isSigning` is `false`, right before the promise resolves (see [Callbacks](#sending-transactions)). |
| `payload.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns**
`Promise<string>` - Transaction signature, once the transaction is confirmed
(see [Sending transactions](#sending-transactions)).

### `forgetStoredKeys()`

A function the package exports, not a `useWallet()` method. Deletes the
session key and the authority key the SDK keeps, whatever `keyStorage` is:
both IndexedDB slots, this page's memory copies, and any plaintext an earlier
release left in localStorage. A session or authority stays on chain; only the
key is gone. See [Session and authority keys](#session-and-authority-keys).

**Returns**
`Promise<void>`. Rejects when IndexedDB holds keys and could not be cleared.
