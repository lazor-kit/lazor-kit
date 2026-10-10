# LazorKit React SDK

LazorKit allows you to build **Passkey-native** Solana applications.

Traditionally, crypto requires users to manage complex seed phrases. LazorKit replaces this with the standard biometrics users already know: **FaceID**, **TouchID**, or **Windows Hello**.

## Features
- **Seedless**: Onboard users instantly with Passkeys
- **Gasless**: Sponsored transactions via Paymaster
- **Smart**: Programmable account logic (PDAs)
- **Secure**: Hardware-bound credentials

> **4.0 alpha.** This branch is the 4.0 alpha (Embedded mode, the Easy tier,
> `/core` and `/hooks`). Its API can still change after device testing. It is
> not published; 3.3.x is the release on npm. See
> [Upgrading from 3.x](#upgrading-from-3x).

## Two modes

`LazorkitProvider` takes a `mode`, with no default:

| | `mode="embedded"` | `mode="portal"` |
|---|---|---|
| Where the passkey lives | Your app's own domain (`rpId`) | `portal.lazor.sh` |
| What opens | Nothing: the OS passkey sheet, and the SDK's own small sheets in your page | The LazorKit portal, in a dialog or a popup |
| Wallets | Your app's own; a user's wallet here is not their wallet in another app | Shared by every app on the portal |
| Who pays rent and fees | Your relayer (`paymasterConfig`; required on mainnet) | Your relayer, as in 3.x |
| For | New apps | 3.x apps (they keep their users' wallets), and apps that want shared wallets |

Moving an existing app from portal to Embedded mode is not an SDK upgrade: it
gives every user a new wallet on your domain. Keep `mode="portal"` for an app
that has users.

## Installation

```bash
npm install @lazorkit/wallet @coral-xyz/anchor @solana/web3.js
```

## Usage

### Embedded mode

```tsx
import { LazorkitProvider, ConnectButton, useWallet } from '@lazorkit/wallet';
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

export const App = () => (
  <LazorkitProvider
    mode="embedded"
    rpId="app.example.com"            // this page's host name; permanent (see below)
    appName="Example"                 // passkeys are named "Example · Ab3d…9xYz"
    rpcUrl={RPC_URL}
    cluster="devnet"
    paymasterConfig={{ paymasterUrl: YOUR_RELAYER_URL }}
  >
    <ConnectButton />
    <Pay />
  </LazorkitProvider>
);

function Pay() {
  const { status, address, signAndSend } = useWallet();
  if (status !== 'connected' || !address) return null;
  const vault = new PublicKey(address);
  return (
    <button
      onClick={() =>
        signAndSend({
          instructions: [
            SystemProgram.transfer({ fromPubkey: vault, toPubkey: new PublicKey('RECIPIENT'), lamports: 0.1 * LAMPORTS_PER_SOL }),
          ],
          onSubmitted: (signature) => console.log('sent', signature), // before confirmation
        })
      }
    >
      Send 0.1 SOL
    </button>
  );
}
```

`<ConnectButton>` shows "Continue with passkey", then the short vault address
with a menu (Copy address, Sign out). `signAndSend` first shows a review sheet
(what the transaction does, and a simulation), then the passkey prompt, and
resolves once the transaction is confirmed. See [Embedded mode](#embedded-mode-1).

### Portal mode (3.x apps)

```tsx
import { LazorkitProvider, useWallet } from '@lazorkit/wallet';
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

export const App = () => (
  <LazorkitProvider
    mode="portal"
    rpcUrl={process.env.LAZORKIT_RPC_URL}
    portalUrl={process.env.LAZORKIT_PORTAL_URL}
    paymasterConfig={{ paymasterUrl: process.env.LAZORKIT_PAYMASTER_URL }}
  >
    <WalletContent />
  </LazorkitProvider>
);

function WalletContent() {
  const { connect, signAndSend, status, vaultPubkey } = useWallet();

  const handleTx = async () => {
    // Connect: the stored wallet, or the portal.
    const wallet = status === 'connected' ? null : await connect();
    const vault = vaultPubkey ?? new PublicKey(wallet!.vaultPda!);

    const sig = await signAndSend({
      instructions: [
        SystemProgram.transfer({
          fromPubkey: vault,
          toPubkey: new PublicKey('RECIPIENT'),
          lamports: LAMPORTS_PER_SOL * 0.1,
        }),
      ],
    });
    console.log('Tx:', sig);
  };

  return <button onClick={handleTx}>Execute Transaction</button>;
}
```

Everything below about connecting, sending, keys and messages applies to both
modes unless it says otherwise.

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
  mode="portal"
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
  a portal "sign" over a fresh ownership-proof challenge, with no
  transaction, for the same passkey.

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
  mode="portal"
  onConfirmWallet="builtin"            // default: the SDK's chooser
  trustedAuthorities={[BACKEND_ADMIN]}  // your own Ed25519 keys, base58
  watchMints={[MY_TOKEN_MINT]}          // SPL mints your app receives
>
```

- **`'builtin'`** (default) — a "Which wallet is yours?" dialog ("Is this your
  wallet?" for one), drawn in the portal dialog's frame, or in Embedded mode
  in the SDK's own sheet. Each row shows the vault address (full address
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
| `PortalCancelledError` | The user closed the portal dialog (X, Escape, a click outside) or its popup window before it answered — on connect and on every signing action. Raised at once, not after the timeout (60 s; 10 minutes for `createSession`, `revokeSession` and `removeAuthority` on a v2 wallet, whose screen the user may take time to read). Also what a `connect` still running rejects with when `disconnect` is called: its portal or chooser closes and it connects nothing. |

If the chain cannot be read, `connect` fails; that is never taken as "no
wallet". Portal errors carry the portal's own message.

The wallet-adapter takes the same options in its config (`new
LazorkitWalletAdapter({ onConfirmWallet, trustedAuthorities, watchMints, ...
})`), and `adapter.connect({ confirmWallet, onConfirmWallet })` per call. With
`'throw'`, catch the error (wallet-adapter's `onError`), then set
`adapter.confirmWallet = choice.vault` and connect again. A second `connect`
while one is running waits for it rather than opening another portal.
`adapter.disconnect()` deletes the session key the SDK keeps, as the store's
`disconnect()` does; `adapter.disconnect({ keepSessionKeys: true })` keeps it
(see [Session and authority keys](#session-and-authority-keys)). It
disconnects the store too, since both connect the same stored wallet:
`useWallet()` shows no wallet, a `connect` the store is running is abandoned,
and a kept key signs only once its wallet is connected again. So does the
Wallet Standard `standard:disconnect`.

`registerLazorkitWallet({ ... })` (the Wallet Standard wallet) takes the same
options except `onConfirmWallet: 'throw'`, which it rejects: `standard:connect`
cannot pass `confirmWallet`, so the user could never finish. Use `'builtin'`
or your own handler there.

Finding wallets yourself with `@lazorkit/sdk-legacy`? Do not take the first
wallet `findWalletsByAuthority(credentialIdHash)` returns — anyone can plant
one there. Use `LazorKitClient.findOwnPasskeyWallet` with a proof over
`createOwnershipChallenge()` from this package, which is domain-separated
(see [Signing messages](#signing-messages)) where sdk-legacy's own gives bare
random bytes; `pickOwnWallet`, `verifyOwnershipProof` and
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
| `UnlistedSolOutflowError` | A `signAndSendWithSession` or `signAndSendWithAuthority` transaction would have lowered the wallet's SOL balance (rent for a new account included), and the session's limits or the delegate's policy name no SOL (`ActionUnlistedSolOutflow`, 3037). Nothing in it ran, and it is not resent. Its message is "This session is not allowed to spend SOL" ("This key …" for a delegate); `signer` is `'session'` or `'authority'`, and `cause` the failure as it came. See [What a policy bounds](#what-a-policy-bounds). |
| `UnlistedTokenOutflowError` | The same for a token whose mint the limits do not name (`ActionUnlistedTokenOutflow`, 3038): "This session is not allowed to spend this token". |
| `PortalReplyMismatchError` | `createSession`, `revokeSession` or `removeAuthority`: the portal's reply does not match the request the wallet prepared (another operation, slot, counter or kind). Nothing was sent. `reason` says what differed. See [What the user approves](#what-the-user-approves-and-when-a-session-ends). |
| `RequestOutOfDateError` | The portal refused a typed request with `stale-counter`: its view of the passkey's counter was behind. The passkey signed nothing; `retryable` is `true`. |
| `PortalRefusedError` | The portal refused a typed request; the passkey signed nothing. `code`: `request-invalid` (it would fail on chain), `wrong-network`, `challenge-mismatch`, `typed-malformed`, `typed-unsupported` or `chain-unavailable`. |
| `TypedRequestTooLargeError` | The typed request, or the portal URL carrying it, is over its cap (8,192 / 16,384 characters). Nothing was opened. |

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
1. `isKeyWalletMismatchError` is true for a `KeyWalletMismatchError` (a
kept session or authority key that was not used because its wallet is not the
connected one, or was disconnected during the send, see
[Session and authority keys](#session-and-authority-keys)),
from either copy and wrapped the same way. The other error classes have no
predicate: compare `error.name` (`'TransactionFailedError'`,
`'PaymasterError'`, `'V1WalletMigratedError'`,
`'WalletNeedsConfirmationError'`, …), which holds across copies too.

`isUnlistedSolOutflowError` and `isUnlistedTokenOutflowError` are true for
`UnlistedSolOutflowError` and `UnlistedTokenOutflowError` from either copy,
wrapped the same way, and for a raw 3037 or 3038 (`0xbdd`, `0xbde`): one whose
logs name another program as the first to fail is not LazorKit's, one with no
logs is (no Anchor error uses these codes). `ERROR_NAMES` and `errorFromCode`
name 3036 to 3038 and 4018 as well.

The portal's transaction preview is compiled without lookup tables whenever it
fits in a packet, so the portal sees every account the transaction touches.
Only a payload over the 1232-byte limit is compiled with the lookup tables the
transaction is sent with (`transactionOptions.addressLookupTableAccounts`, or
those of a dApp's v0 transaction), and a preview still over the limit no longer
fails the call before the prompt.

## Session and authority keys

`createSession()` without `sessionKey`, and `addAuthority({ role })`, generate an
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

**A kept key signs only for its own wallet.** Each key is stored with the
wallet it was registered for (its wallet PDA), its session or authority PDA,
and a session's expiry. `signAndSendWithSession`, `signAndSendWithAuthority`
and `revokeSession()` (without `sessionPda`) use the key only while that same
wallet is connected. With no wallet connected, or another one, they reject
with `KeyWalletMismatchError` before anything is signed or sent: `reason` is
`'no-wallet'` or `'other-wallet'`, `keyWallet` the wallet PDA the key signs
for, `connectedWallet` the connected one. The key itself checks again when it
signs, and again right before each attempt to send what it signed, so a
wallet that disconnects or switches while a send is being built stops it too.
Connect `keyWallet` again and the key signs, or create a session (add an
authority) for the connected wallet, which replaces it.

A send that loaded its key before a disconnect neither signs nor sends after
it, whichever way the wallet was disconnected: `disconnect()`,
`LazorkitWalletAdapter.disconnect()` or the Wallet Standard
`standard:disconnect`. It rejects with `KeyWalletMismatchError`, `reason`
`'no-wallet'`, or `'disconnected'` when the same wallet is connected again by
then (with `keepSessionKeys` the key is kept, but a send started before the
sign-out is not finished after it): send again. A refusal after the key
signed says the transaction it signed was not sent. If an earlier attempt to
send it got no answer, it may still land: the send rejects with
`TransactionOutcomeUnknownError` instead, and the transaction is not sent
again.

The stored wallet is checked on every use, not taken on trust: the session
or authority PDA in the record must derive from that wallet and the key (no
network needed). A record that does not (one altered in IndexedDB, or made
on another cluster) is checked as an earlier release's entry is (see
**Upgrading** below): bound to the wallet its account on chain names, or
refused as `'unbound'`.

```ts
import { isKeyWalletMismatchError } from '@lazorkit/wallet';

try {
  await signAndSendWithSession({ instructions });
} catch (error) {
  if (isKeyWalletMismatchError(error)) {
    // Not this wallet's session: ask for the passkey and create one for it.
    await createSession({ spendingLimits });
  } else throw error;
}
```

A stored session key whose session has expired is deleted the next time it is
read (a send, or `revokeSession()`), which then rejects with "No session key
found: the stored session … expired at …". It is deleted once the cluster
clock (the Clock sysvar, read at the connection's commitment) is past the
session's `expiresAt`: never while the session can still sign. (A key kept
by a release that measured sessions in slots, or a v1 wallet's, is compared
with the slot instead: "expired after slot …".) Revoke an expired
session by its PDA (`revokeSession({ sessionPda })`) if you want its account
closed.

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

Such an entry names its wallet, but 3.2 never checked it. On its first use
the key is bound to that wallet if the program derives the entry's session or
authority PDA from that wallet and the key (v2 or v1, on the cluster the app
is on). Otherwise it is bound to the wallet the PDA's account on chain names,
if that account is LazorKit's and names this key. The binding is stored, and
the key then signs only for that wallet, as above. **An entry whose wallet
cannot be confirmed either way stays unbound and is never used**: every send
rejects with `KeyWalletMismatchError` and `reason: 'unbound'`, whichever
wallet is connected. Create the session (add the authority) again, which
replaces it. (`forgetStoredKeys()` deletes it as well, but it also deletes
the other kept key.)

**If your app removed `lazorkit-session` / `lazorkit-authority` at sign-out**
(or called `localStorage.clear()`), that no longer removes the keys: they are
in IndexedDB now. `disconnect` deletes the session key; call
`forgetStoredKeys()` as well to delete the authority key too:

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
  IndexedDB holds keys and could not be cleared. A `createSession` or
  `addAuthority` still waiting for its transaction when it runs does not keep
  its key once it lands (a warning is logged; the session or authority stays
  on chain).
- A stored session key is deleted when it is read after its session expired.
- `disconnect()` deletes the session key: from IndexedDB, this page's memory
  and any plaintext an earlier release left (with `keyStorage="memory"`, from
  memory and plaintext; IndexedDB is not used then). It deletes the key
  whichever wallet it belongs to, so a key kept for another wallet with
  `keepSessionKeys` goes too. A `createSession` still waiting for its
  transaction when you disconnect does not keep its key once it lands: the
  call still succeeds, a warning is logged, and the session stays on chain
  until it expires. `disconnect({ keepSessionKeys: true })` keeps the key (that
  session's too). If IndexedDB fails to delete it, `disconnect` still succeeds
  and logs a warning; the key stays bound to its wallet. `forgetStoredKeys()`
  rejects instead, for a sign-out that must know.
- `LazorkitWalletAdapter.disconnect()` (what a wallet-adapter UI's Disconnect
  calls) and the Wallet Standard `standard:disconnect` delete the session key
  the same way: from IndexedDB, this page's memory and any plaintext, whatever
  `keyStorage` the provider uses. `adapter.disconnect({ keepSessionKeys: true
  })` keeps it; `standard:disconnect` takes no options, so it always deletes
  it. They keep the authority key, as `disconnect()` does, and disconnect the
  store too, so it signs only once its wallet is connected again. (Earlier
  releases left the session key in place on these two paths, and up to 3.3.1
  left the store connected, where the authority key, and a session key kept
  with `keepSessionKeys`, went on signing.)
- `disconnect` keeps the authority key. Like a kept session key, it signs only
  once the wallet it was registered for is connected again (see above). On a
  shared computer, call `forgetStoredKeys()` at sign-out.

**Several tabs.** `disconnect()` ends the connection in its own tab only: the
connected wallet is not shared between tabs, so another tab of the app stays
connected, and there the authority key keeps signing for that wallet (and so
does a session key that tab holds in memory). The keys in IndexedDB are shared
by every tab, so a `disconnect()` in one tab deletes the session key another
tab is using. To end signing in every tab, call `forgetStoredKeys()` at
sign-out: a tab still open then finds no key in IndexedDB.

If a key cannot be stored after its session or authority has landed, the call
still succeeds: the key signs for the rest of this page, and a warning is
logged. If IndexedDB only failed this time, the key is stored on its next use
here, unless another tab has stored a newer key meanwhile.

**What bounds a kept key** is what was registered on chain, not where the key
is kept. A session is bounded by its `spendingLimits` and its expiry (see
[What a policy bounds](#what-a-policy-bounds)). An
authority is bounded by the role you give it, which `addAuthority` requires
(there is no default, and a missing or unknown role throws before the passkey
prompt):

| Role | What the key may do |
|---|---|
| `ROLE_OWNER` (0) | Add and remove any authority, other owners included (never the last owner), and spend without limit. On a v2 wallet the protocol SDK adds an owner only with `allowOwner`, which `addAuthority` does not pass, so it refuses `ROLE_OWNER` there before anything is read or prompted. On a v1 wallet it adds one. |
| `ROLE_ADMIN` (1) | Add and remove delegates only, and spend without limit: no policy, no expiry, until `removeAuthority`. |
| `ROLE_SPENDER` (2), the delegate rank | Manage no authority; spend only within its `policy` (required for this rank on v2; build it with `serializeActions([...])`). |

For a key your app holds, use `ROLE_SPENDER` with a `policy`:

```ts
import { ROLE_SPENDER, serializeActions, Actions, PublicKey } from '@lazorkit/wallet';

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

await addAuthority({
  role: ROLE_SPENDER,
  // Up to 0.1 SOL and 5 USDC a transaction. No other token can leave the wallet.
  policy: serializeActions([
    Actions.solMaxPerTx(100_000_000n),
    Actions.tokenMaxPerTx({ mint: USDC, max: 5_000_000n }),
  ]),
});
```

**Signatures.** Ed25519 as RFC 8032 defines it is deterministic: Chromium and
Node sign exactly as web3.js's `Keypair` does with the same seed (the package's
tests check this byte for byte). Safari signs with a random nonce instead, so
the same message gets a different signature each time. Each one is valid, and
nothing in the SDK depends on the signature bytes.

### What the user approves, and when a session ends

`createSession`, `revokeSession` and `removeAuthority` send the portal the
operation itself, not only its challenge: a *typed request* in the URL
fragment (`#/?lk1=…`), next to the query earlier releases sent. A portal that
reads it shows exactly what the passkey approves, for example "Let MyApp spend
up to 0.002 SOL per payment and 5 USDC in total, until about 6:50 PM". It
recomputes the challenge from what it shows, and picks the slot it signs when
the user taps Approve. A portal that does not read typed requests signs the
challenge in the query, as before. `signAndSendTransaction`, `addAuthority`
and the deferred actions open the portal as before.

Before anything is sent, the wallet checks the portal's reply against the
request it prepared: the passkey must have signed this operation, at the slot
and counter the portal names in its reply (`typed`), or at the prepared ones
when it names none. A reply that does not match rejects with
`PortalReplyMismatchError`, and nothing is sent. The portal's refusals mean
the passkey signed nothing: `RequestOutOfDateError` (`stale-counter`, the
portal's node was behind; `retryable: true`, a new request may go through) or
`PortalRefusedError` with the portal's `code`. A request whose URL would be
over 16,384 characters is refused with `TypedRequestTooLargeError` before the
portal opens; it is never truncated. Wallets made before LazorKit v2 send no
typed request.

```ts
import { PortalReplyMismatchError, RequestOutOfDateError } from '@lazorkit/wallet';

try {
  await createSession({ spendingLimits, expiresInSeconds: 3600 });
} catch (error) {
  if (error instanceof RequestOutOfDateError) {
    // Nothing was signed: offer to try again.
  } else throw error;
}
```

A session ends by the **cluster clock** (the Clock sysvar's Unix time, which
the program compares against), not by slot:

- `expiresInSeconds`: how long it lasts, more than 0 and at most 30 days
  (`MAX_SESSION_SECONDS`), counted from the cluster's time when
  `createSession` reads it.
- `expiresAt`: when it ends, as a Unix time in seconds, after the cluster's
  time and at most 30 days ahead of it.
- Neither: `DEFAULTS.SESSION_EXPIRY_SECONDS`, 5 hours.
- `expiresInSlots` is deprecated. It is still accepted: it is converted to
  seconds with the cluster's measured slot time (recent performance samples),
  with a warning, and it throws when the slot time cannot be read. Give at
  most one of the three.

An expiry the program would refuse throws before the passkey is asked.
Recurring limits count seconds too: `solRecurring: { limit, windowSeconds:
86_400n }` is a day, and a `windowSlots` from an earlier release throws
rather than being read as seconds.

A wallet made before LazorKit v2 (v1) still counts in slots: with no expiry
its session lasts `DEFAULTS.SESSION_EXPIRY_SLOTS` (50,000 slots), as before;
`expiresInSlots` is used as given; `expiresInSeconds` and `expiresAt` are
converted to slots with the measured slot time. A recurring limit's
`windowSeconds` is converted to slots the same way.

The portal waits up to 10 minutes for the user on these three screens (other
signing keeps its 60 seconds): the portal picks the slot it signs at when the
user taps Approve, so time spent reading costs nothing.

### What a policy bounds

A session's `spendingLimits` and a delegate's `policy` name what may leave the
wallet, and under LazorKit v2 nothing they do not name may (from the program
release that adds errors 3037 and 3038: until then an asset they do not name
is not bounded at all, see the end of this section):

- **SOL** leaves only with a SOL limit (`solPerTxMax`, `solLifetimeCap` or
  `solRecurring`; an `Actions.sol*` action in a policy). Without one, a
  transaction that lowers the wallet's SOL balance is refused, rent the
  wallet pays for a new account included (a recipient's token account, say):
  `UnlistedSolOutflowError` (3037). The network fee is the fee payer's, not
  the wallet's.
- **A token** leaves only with a limit that names its mint: an entry in
  `spendingLimits.tokens` (an `Actions.token*` action in a policy). Any other
  mint is refused: `UnlistedTokenOutflowError` (3038). wSOL is a mint of its
  own: the SOL limits do not cover it.
- Limits are net over one transaction, and what comes in always passes. A
  swap needs a limit for the mint it sells, and a SOL limit when the wallet
  pays the rent of its output token account. A program whitelist names
  programs, not assets.
- The wallet's token accounts a transaction passes writable may change only
  their balance: owner, delegate, close authority and state stay as they were
  (`SessionTokenAuthorityChanged`, 3032).
- A policy must fit in the transaction that registers it, beside the
  passkey's response: at most 224 bytes of actions (and 16 actions). A SOL
  limit takes 19 bytes (`solRecurring` 43), a token's `lifetimeCap` or
  `perTxMax` 51 and its `recurring` 75. That is `solPerTxMax` with `perTxMax`
  and `lifetimeCap` for 2 mints (223 bytes), or `solPerTxMax` with `perTxMax`
  for 4 (223). The transaction holds 1232 bytes, and the passkey's
  clientDataJSON, which the browser writes, is sized at 320 of them (as
  `@lazorkit/sdk-legacy` sizes it).

A session made with `unrestricted: true` has no policy, and none of these
bounds: it can move anything the wallet holds until it expires.

So name every mint the app's session may spend:

```ts
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

await createSession({
  spendingLimits: {
    solPerTxMax: 10_000_000n, // 0.01 SOL a transaction, rent included
    // 5 USDC a transaction, 100 USDC in all. Amounts in the mint's base units.
    tokens: [{ mint: USDC, perTxMax: 5_000_000n, lifetimeCap: 100_000_000n }],
  },
});
```

Each `tokens` entry takes `mint` (a `PublicKey` or base58) and at least one of
`lifetimeCap`, `perTxMax` and `recurring: { limit, windowSeconds }`, as the SOL
limits do. `createSession` checks the limits before anything is read or the
passkey is asked: an entry with no limit, a mint named twice, an amount
outside a u64, a window of 0 seconds, or more than 224 bytes of actions throws.
`addAuthority` does not check a `policy`'s size: keep it within the same 224
bytes, or the transaction may not fit once the passkey has signed. Nothing is
added that you did not ask for: SOL limits alone let the session spend no
token, and token limits alone no SOL. `spendingLimitsToActions(limits)` gives
the actions a `SpendingLimits` stands for, so
`serializeActions(spendingLimitsToActions(limits))` is a delegate `policy`
with the same limits.

The program enforces this from the release that adds errors 3037 and 3038.
Until that release an asset the limits do not name is not bounded at all: a
session with token limits only can spend all the wallet's SOL, and one with
SOL limits only any token. After it, a session or delegate made with SOL
limits only, as every session this SDK made before `tokens`, can move no
token: make a new one that names the mints it spends. A session key the SDK
generates is new each time. For a `sessionKey` of your own that already has a
session, `createSession` resolves with that session as it was made, whatever
limits you pass: revoke it first (`revokeSession({ sessionPda })`), or
register a new key.

## Signing messages

`signMessage` (the hook and the store), `LazorkitWalletAdapter.signMessage`
and the Wallet Standard `solana:signMessage` never sign the app's bytes as the
passkey's WebAuthn challenge. Message signatures are domain-separated from
every other passkey challenge: they sign this challenge instead (format v1):

```
tag       = UTF-8 "LazorKit signed message v1"     (26 bytes)
challenge = tag || SHA-256(tag || message)        (58 bytes)
```

`message` is the UTF-8 bytes of a string, or the bytes given.
`signedMessageChallenge(message)` computes it, and `SIGNED_MESSAGE_DOMAIN` is
the tag. The other challenges the SDK asks a passkey for have shapes of their
own, so no challenge of one kind can be another:

| Challenge | Shape |
|---|---|
| Transaction (what the programs verify) | a 32-byte hash |
| Message | 58 bytes, starting with `LazorKit signed message v1` |
| Ownership proof (connect) | 59 bytes: `LazorKit ownership proof v1` then 32 random bytes (`createOwnershipChallenge()`, `OWNERSHIP_PROOF_DOMAIN`) |

The portal gets the challenge as `message` and the text to show as
`displayMessage` (a string, or bytes that are valid UTF-8); a portal that
shows `displayMessage` checks that `message` is its challenge. The SDK checks
the portal's reply: one over any other challenge is refused.

**What comes back.** The hook and the store resolve with a
`SignMessageResult`:

| Field | What it is |
|---|---|
| `signature` | The P-256 signature, 64 bytes (r \|\| s, low-S), base64. |
| `signedPayload` | What the passkey signed: authenticatorData \|\| SHA-256(clientDataJSON), base64. |
| `clientDataJsonBase64` | The WebAuthn clientDataJSON, base64. Its `challenge` is base64url(challenge). |
| `authenticatorDataBase64` | The WebAuthn authenticatorData, base64. |

`LazorkitWalletAdapter.signMessage` and the Wallet Standard `signature` are,
as before, the UTF-8 bytes of a JSON object, now with these four fields. They
are not a 64-byte Ed25519 signature: a LazorKit wallet's address is a program
account, with no key to sign with, so the signer is the wallet's passkey.

**Checking one: which wallet signed.** A message signature proves that a
passkey key signed the message, not which wallet that key belongs to. To
authenticate a wallet, read the key from the chain, never from the client: a
server that takes the key from the request accepts anyone's passkey for any
wallet they name. `verifyWalletMessage` does the lookup:

```ts
import { Connection } from '@solana/web3.js';
import { verifyWalletMessage } from '@lazorkit/wallet';

// In the app
const result = await signMessage('Sign in to example.com\nNonce: 8f2c…');
// send { wallet: wallet.vaultPda, credentialId: wallet.credentialId, ...result }

// On the server
const ok = await verifyWalletMessage({
  connection: new Connection(RPC_URL),
  cluster: 'mainnet',              // when RPC_URL does not say which cluster
  wallet,                          // the wallet the client claims (vault or wallet address)
  credentialId,                    // the passkey's credential id, base64
  rpId: 'portal.lazor.sh',         // the passkey's relying party: the portal's hostname
  message: 'Sign in to example.com\nNonce: 8f2c…',
  ...result,                       // signature, clientDataJsonBase64, authenticatorDataBase64, signedPayload
  origin: 'https://portal.lazor.sh', // optional: the page that ran the passkey
});
```

It is `true` only when the signature is over `signedMessageChallenge(message)`
(a `webauthn.get` with the user present, under `rpId`) and verifies against
the key stored on chain in an Owner authority of `wallet` for `credentialId`
(v2 or v1), and the wallet account still exists. It reads the chain with one
`getProgramAccounts` per program, as connect does, so use an RPC endpoint that
allows it. It rejects when the chain cannot be read (treat that as not
verified). For an adapter or Wallet Standard signature, pass
`...JSON.parse(new TextDecoder().decode(signature))` instead of `...result`.
Put your domain and a fresh nonce in the message, and check them, as with any
sign-in message.

`verifySignedMessage({ message, publicKey, ...result })` is the offline part
of that check, with no RPC: `true` only when `publicKey`'s passkey signed
`signedMessageChallenge(message)`, and `false` for any other challenge, the
raw message bytes included. It never throws. Use it alone only with a key you
read from the claimed wallet's authority on chain yourself.

`useWallet().verifyMessage` and `verifySignatureBrowser` are deprecated and
must not be used for authentication: they check only that `signature` is over
`signedPayload`, not which message was signed, so any assertion the passkey
ever made passes.

## Embedded mode

In Embedded mode the passkey is created under your app's own domain, and the
SDK runs every passkey ceremony in your page with WebAuthn. No portal, iframe,
popup or `postMessage` is involved.

### Provider props

| Prop | Required | Description |
|---|---|---|
| `mode` | yes | `"embedded"`. |
| `rpId` | yes | The relying party: this page's host name (`app.example.com`), or a registrable parent of it (`example.com`). Lowercase ASCII (punycode for an international name), no scheme, port, path or trailing dot, not an IP address. `localhost` works in development. Permanent, so write it as a constant, never from `location`. A mistake throws `LazorkitConfigError` when the provider renders. |
| `appName` | yes | Your app's name. Passkeys are named `"<appName> · <short vault>"`, at most 60 bytes, and the sheets show it. |
| `paymasterConfig` | on mainnet | Your relayer: it pays fees and the rent of every new wallet (D11). On mainnet, leaving it out throws; LazorKit's relayer is for devnet and testing. |
| `cluster` | when the RPC URL does not say | `'devnet'` or `'mainnet'`. An RPC URL that names neither is taken as mainnet. The review sheet simulates on this cluster. |
| `rpcUrl` | no | Your RPC. Embedded mode reads with a back-off for HTTP 429. |
| `confirm` | no | Show the review sheet before every `signAndSend` (default `true`). |
| `onConfirmWallet`, `trustedAuthorities`, `watchMints`, `keyStorage`, `v1PaymasterConfig` | no | As in portal mode. |
| `onEvent` | no | Experimental: one call per passkey ceremony, sheet, connect and transaction (`LazorkitEvent`), for metrics. |

A `localhost` rpId on mainnet throws: every local dev server on every port
shares it.

The page itself must be served from a domain (not an IP address) over https,
or `http://localhost`. If it is not, or the browser has no WebAuthn (an in-app
browser view), nothing throws: `availability` says `'misconfigured'` or
`'unavailable'`, and `connect()` rejects with `LazorkitConfigError` or
`PasskeyUnavailableError`.

### Connecting

There is one button, "Continue with passkey", for new and returning users:

1. One `navigator.credentials.get()` asks for any passkey this rpId has. No
   network request comes first. In Chrome with immediate mediation
   (`getClientCapabilities().immediateGet`), and only when the call comes
   from a click, it uses `uiMode: 'immediate'`: a user with no passkey on this
   device sees no sheet at all. After one immediate request fails, the page
   uses the normal sheet from then on.
2. If no passkey comes back, the browser does not say whether there is none
   or the user closed the sheet. The SDK then shows **No passkey on this
   device?** with three choices:
   - **Create a passkey**, with the name prefilled and editable;
   - **Use a passkey on another device**, which asks again with the phone or
     security key offered first (`hints: ['hybrid']`);
   - **Not now**, which rejects `connect()` with `UserRejectedError`.

   A passkey is never created without the user asking. If the user closes the
   create sheet, the screen stays. If the authenticator already holds one of
   this app's passkeys, the screen says so.
3. A new passkey's `user.id` is its wallet's seed, so the wallet is at
   `findWallet(user.id)`. The wallet is created through your relayer, and read
   back before it is saved: it must have exactly one Owner, holding this
   passkey's key, credential and rpId. The relayer's answer must also be its
   own signature over the transaction the SDK built. If the wallet cannot be
   created, the screen offers **Try again**, which needs no new passkey (the
   chain is read again first). A later sign-in with that passkey also creates
   it, with one prompt.
4. A passkey that comes back with a 32-byte `userHandle` (one this SDK made)
   names its wallet. The SDK reads that wallet and this passkey's authority
   directly, with no search by credential:
   - It is used without asking when this passkey has signed for it and
     nothing else can spend from it.
   - It is also used without asking when it has never been used, but its first
     transaction was exactly this passkey's `CreateWallet` and nothing else.
   - Anything else goes to the chooser.
5. Any other passkey (made elsewhere, or by another app on this rpId) goes
   through the lookup portal mode uses, on v2 and v1. If it holds no wallet,
   one more prompt, pinned to the same passkey, recovers its public key, and
   a wallet is created for it.

A read that fails is a `NetworkError`. Nothing is created after a failed read.
`disconnect()` during a connect closes its sheets, and the connect rejects
with `UserRejectedError` (reason `'abandoned'`) and saves nothing.

What each flow costs the user (passkey prompts / sheets the user acts on /
portal dialogs), as the devnet playground's end-to-end run measured them
(Chromium with a virtual authenticator, 2026-10-03; immediate mode not
available there):

| Flow | Count |
|---|---|
| New user (with immediate mode, by design: 1 / 1 / 0) | 2 / 1 / 0 |
| Returning user, any device with the passkey | 1 / 0 / 0 |
| Returning user, wallet never used | 1 / 0 / 0 (1 / 1 / 0 for a passkey made elsewhere) |
| Passkey with no wallet | 2 / 0 / 0 |
| Reload | 0 / 0 / 0 |
| A transaction (review sheet on / off) | 1 / 1 / 0, 1 / 0 / 0 |
| Sign a message | 1 / 0 / 0 |

### What is stored, and reloads

Embedded mode keeps its data under `lazorkit:embedded:<rpId>:` in
localStorage, and never writes the portal's keys:

- `:store` and `:wallet` hold the connected wallet, so a reload is connected at
  once with no prompt (the store reads it synchronously when the provider
  first renders). A record from another rpId, mode or cluster is never
  restored.
- `:known` holds up to 10 credential ids of this app's passkeys seen here, for
  `excludeCredentials`.
- `:pending:<id>` holds a passkey whose wallet has not landed yet.

`disconnect()` deletes the wallet record and the session key (unless
`keepSessionKeys`), but keeps the known ids and pending passkeys.
`forgetEmbeddedDevice(rpId)` deletes those too. None of it is a secret.
`LazorkitWalletAdapter.disconnect()` and the Wallet Standard
`standard:disconnect` on the same page disconnect the Embedded store too,
its record included, so the next `connect()` asks for the passkey.

Session and authority keys work as in portal mode (see
[Session and authority keys](#session-and-authority-keys)): a send that
loaded its key before a disconnect neither signs nor sends after it, and a
session's `spendingLimits` name what may leave the wallet
([What a policy bounds](#what-a-policy-bounds)), checked before the passkey
is asked.

**Sessions on the chooser (D10).** A wallet with a live session is not used
without asking, unless the session's key is one this device holds, bound to
that wallet. That only happens when the key was kept at sign-out
(`disconnect({ keepSessionKeys: true })`). A plain `disconnect()` deletes it.

### Sending

`signAndSend` (the same function as `signAndSendTransaction`):

1. Shows the **review sheet**, unless the provider or the call passes
   `confirm: false`. The sheet decodes each instruction: SOL transfers, SPL
   Token and Token-2022 transfers, with the recipient token account's owner
   and a warning when it is not a token account of that mint. It also shows
   approvals, authority changes and closes that hand over the vault or its
   tokens (in red), associated token accounts, compute budget and memos.
   Anything else is shown as an unrecognized instruction with its program and
   accounts. The sheet also shows a simulation on your cluster with the vault's
   balance change, and that your app pays the fee. A failed simulation makes
   **Cancel** the main button and **Approve anyway** the other.
2. Prepares the passkey challenge only after the sheet is approved. A
   challenge names a slot and expires about 150 slots later, so no challenge
   waits on a person. What is signed is a copy of the instructions taken when
   the sheet opened, so changing the instruction objects afterwards changes
   nothing.
3. Asks the passkey once, pinned to the connected credential, and sends.
4. Calls `onSubmitted(signature)` as soon as the transaction is sent. The
   promise resolves once it is confirmed.

Cancelling the sheet or closing the passkey prompt rejects with
`UserRejectedError`; nothing is signed or sent. Sends read the wallet's
passkey authority directly (no `getProgramAccounts`), so any RPC works for
them.

The review sheet catches **your app's** mistakes: a wrong amount or recipient.
It does not protect against a malicious app, because your page draws it. The
passkey prompt itself shows nothing about the transaction.

### Errors

Every error has a kind, `errorKind(error)`, and words to show,
`userMessage(error, 'connect' | 'send')`:

| Kind | Class | `userMessage` |
|---|---|---|
| `rejected` | `UserRejectedError` (`PortalCancelledError` and `WalletConfirmationDeclinedError` are subclasses) | connect: `null` (show nothing); send: "Nothing signed, nothing sent." |
| `other-passkey` | `PasskeyMismatchError` | "Another passkey answered. Nothing was created or sent." |
| `key-recovery` | `KeyRecoveryError` | "Nothing was created; try again." |
| `unavailable` | `PasskeyUnavailableError` | "Passkeys don't work in this browser view. Open this page in Safari or Chrome." |
| `config` | `LazorkitConfigError` (`problem` says which) | The developer message |
| `network` | `NetworkError`, `PaymasterError` without a program error | "Couldn't reach the network. Nothing was created." (or "sent") |
| `wallet-mismatch` | `WalletVerificationError` | "The wallet that was created isn't this passkey's. Nothing was saved; try again." |
| `tx-failed` | `TransactionFailedError` | "The transaction failed: …. Nothing else changed." |
| `tx-expired` | `TransactionExpiredError` | "It didn't go through. It's safe to try again." |
| `tx-unknown` | `TransactionOutcomeUnknownError`, `ConfirmationTimeoutError` | "Checking whether it went through. Don't send it again yet." |
| `previous-pending` | `PreviousTransactionPendingError` | "Your previous transaction is still pending. Nothing was signed." |
| `signature-reused` | `SignatureReusedError` | "Nothing was sent. Try again." |
| `v1-retired` | `V1WalletRetiredError` | "This wallet's old version is retired. Move it to the new version to continue." |
| `v1-migrated` | `V1WalletMigratedError` | "This wallet moved. Sign in again." |
| `key-mismatch` | `KeyWalletMismatchError` | By `reason`: `'other-wallet'` "This key belongs to another wallet. Nothing was sent."; `'no-wallet'` "No wallet is connected. Nothing was sent; connect and send again."; `'disconnected'` "The wallet was disconnected during this send. Nothing was sent; send it again."; `'unbound'` "This key couldn't be matched to a wallet. Nothing was sent." |
| `policy` | `UnlistedSolOutflowError`, `UnlistedTokenOutflowError` | "This session isn't allowed to spend SOL. Nothing was spent." ("This key …" for a delegate, "… this token" for 3038) |

A user rejection never sets the store's `error`, in either mode. `onFail`
still runs for it.

### Status

`useWallet().status` is `'disconnected'`, `'connecting'`, `'connected'` or
`'signing'`. It replaces `isConnecting`, `isSigning` and `isLoading`, which
still work in 4.x and warn once when read. For a button of your own,
`useWalletStatus()` from `@lazorkit/wallet/hooks` also gives the step that is
running: `checking-passkey`, `no-passkey`, `creating-passkey`, `other-device`,
`finding-wallet`, `choose-wallet`, `one-more-check`, `creating-wallet`,
`reviewing`, `preparing`, `awaiting-passkey` or `submitted`.

`<ConnectButton>` takes `label`, `autofill` (passkey autofill in a field under
the button; off by default), `className`, `style`, `onConnect` and `onError`.
It is themed, like the sheets, with CSS custom properties: `--lk-accent`,
`--lk-bg`, `--lk-fg`, `--lk-radius`, `--lk-font`. Elements tests can target
carry `data-lk` attributes:
- the button: `connect`, `menu`, `copy`, `sign-out`;
- the no-passkey sheet: `no-passkey`, `passkey-name`, `create`,
  `other-device`, `not-now`, `retry-wallet`;
- the chooser: `wallet-choice`, `use-wallet`, `none`;
- the review sheet: `review`, `approve`, `cancel`.

### Embedded security model

Your domain holds your users' wallets. Read this before shipping:

- **Anything that can call WebAuthn for your rpId can sign for every wallet:**
  - your frontend and every script it loads, so its supply chain too;
  - with a parent-domain rpId (`example.com`), every subdomain;
  - origins your rpId lists in `/.well-known/webauthn` (Related Origins);
  - Android and iOS apps your domain vouches for (`assetlinks.json`, Associated
    Domains);
  - whoever registers the domain if it ever lapses.

  The program checks the rpId's hash, not the page. Serve wallet pages with a
  strict Content-Security-Policy and Subresource Integrity, keep the domain's
  registration and DNS locked, and use the page's own host as the rpId unless
  you need a parent.
- **The rpId is permanent.** Every passkey and every wallet is bound to it.
  Changing domains means listing the new one through the old rpId's Related
  Origins, never changing `rpId`.
- **There is no recovery authority yet.** A wallet has one Owner, the passkey
  on your rpId. Losing the domain loses every wallet until a second Owner
  exists (planned: D15).
- **The review sheet is not a security boundary** (see above).
- **Wallets are not portable to portal apps** and back. Moving a portal user to
  Embedded mode needs a new Owner added from the portal (planned: D12).

## Entry points

| Import | What | React |
|---|---|---|
| `@lazorkit/wallet` | Easy: `LazorkitProvider`, `ConnectButton`, `useWallet`, and everything in `/core` | yes (client module) |
| `@lazorkit/wallet/hooks` | Advanced: `useWallet`, `useWalletStore`, `useLazorkitClient`, `useWalletStatus` | yes (client module) |
| `@lazorkit/wallet/core` | No React: `createLazorkitClient`, the errors, `verifyWalletMessage`, the protocol helpers, the adapter | no |

All three share one store and one client per page. The React entries start
with `'use client'`. Server code, such as a route handler that checks a signed
message, imports from `@lazorkit/wallet/core`. `react` and `react-dom` are
optional peers for `/core` users.

```ts
import { createLazorkitClient } from '@lazorkit/wallet/core';

const client = createLazorkitClient({ mode: 'embedded', rpId: 'app.example.com', appName: 'Example', cluster: 'devnet' });
client.subscribe((state) => render(state.status, state.address));
button.onclick = () => client.connect().catch(() => {});
```

Write `rpId` as a constant; never derive it from `location`. A derived rpId
lets a preview or staging host, or a mirror that serves your bundle, create
wallets under its own host name, and after a domain move your users would
quietly get new, empty wallets. With a constant, a page on any other host
fails with `LazorkitConfigError('rp-id-refused')` instead.

A second `createLazorkitClient` call with an equal config returns the same
client. One with a different mode, rpId, relayer, RPC, cluster, portal, trusted
keys, `watchMints` or `confirm`, other `ui` screens or another
`onConfirmWallet` throws `LazorkitConfigError('reconfigured')`, unless it
passes `{ replace: true }`. `ui` and `onConfirmWallet` are compared by
identity, so pass the same object and function again.

## Upgrading from 3.x

**Breaking:**

1. **`mode` is required.** Add `mode="portal"` to keep your users' wallets:

   ```bash
   perl -0777 -pi -e 's/<LazorkitProvider(?![\w-])(?![^>]*\bmode=)/<LazorkitProvider mode="portal"/g' \
     $(grep -rl '<LazorkitProvider' src)
   ```

   It works the same on macOS and Linux, and running it twice changes nothing.
   It skips a tag that already sets `mode`, unless a prop before `mode` holds
   a `>` (an arrow function): then TypeScript reports the duplicate. Without
   `mode` the app does not compile, and throws
   `LazorkitConfigError('no-mode')` from JavaScript.
2. **A user rejection no longer sets `error`.** This covers a closed portal or
   sheet, and "None of these". The promise still rejects, and `onFail` still
   runs. `PortalCancelledError` and `WalletConfirmationDeclinedError` are now
   `UserRejectedError`s, with `code: 'USER_REJECTED'` and a `reason`; their
   names and messages are unchanged. Branch on `errorKind(e) === 'rejected'`.
3. **A passkey whose key cannot be recovered** at connect rejects with
   `KeyRecoveryError` (`code: 'KEY_RECOVERY'`), in portal mode too, instead
   of a plain `Error`. The message is unchanged.
4. **The root and `/hooks` entries are client modules** (`'use client'`).
   Next.js server code imports helpers from `@lazorkit/wallet/core`.
5. **The first render can already be connected**: the stored wallet is read
   synchronously. `connect()` on mount still works; it returns the stored
   wallet.
6. **The stored config is never read back.** The provider's props are the
   config from the first render; 3.x put the config it had stored in the
   state until the provider's effect replaced it. What is stored is unchanged.
7. **`@lazorkit/sdk-legacy` 1.3.1 or later.**

**New:** `status`, `address`, `signAndSend`, `onSubmitted`, `ConnectButton`,
`useWalletStatus`, `createLazorkitClient`, `errorKind`, `userMessage`, `onEvent`,
`/core` and `/hooks`. `react` and `react-dom` are optional peers, for apps
that use only `/core`.

**Deprecated:**
- `isLoading`, `isConnecting` and `isSigning`: use `status`. They warn once,
  and are removed in 5.0.
- The session, authority and deferred functions on `useWallet`: they move to
  hooks in `/hooks` in a later 4.x, with the same names and parameters. They
  still work, and warn once each when first called.

**Unchanged:**
- portal mode's flows and its stored bytes;
- the `signMessage` format (changed in 3.3);
- `addAuthority`'s required `role`;
- the wallet adapter and the Wallet Standard wallet, which stay portal-only in
  4.0 (their disconnect still disconnects the page's store, in either mode).

**Not in the alpha:**
- "remember this device" (the `session` prop is reserved);
- the session, authority and deferred hooks;
- Embedded mode for the adapter and the Wallet Standard;
- the mobile adapter's Easy API;
- a recovery Owner.

## API Reference

### `useWallet()`

**Easy fields:** `status` (`'disconnected' | 'connecting' | 'connected' |
'signing'`), `address` (the vault, base58, or `null`), `wallet`, `error`,
`connect`, `disconnect`, `signAndSend`, `signMessage`. The 3.x fields are all
still there.

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
`isSigning` until it ends, but a session or authority send among them neither
signs nor sends after the disconnect, even if its wallet is connected again by
then. `LazorkitWalletAdapter.disconnect()` and the Wallet Standard
`standard:disconnect` disconnect the store the same way. The session key the
SDK keeps is deleted, unless
`options.keepSessionKeys` is `true`, and so is the key of a `createSession`
that lands after the disconnect; the authority key is kept. A kept key signs
only once its wallet is connected again. This tab only: another tab of the
app stays connected (see
[Session and authority keys](#session-and-authority-keys) and
`forgetStoredKeys()` below).

**Parameters**

| Param | Type | Description |
|---|---|---|
| `options.keepSessionKeys` | `boolean` | Keep the session key (default `false`: it is deleted). |
| `options.onSuccess` | `() => void` | Runs once the disconnect is over, right before the promise resolves. |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns** 
`Promise<void>`

#### `signMessage(message, options?)`

Signs a message with the passkey. The passkey signs
`signedMessageChallenge(message)`, never the message's bytes (see
[Signing messages](#signing-messages)).

**Parameters**

| Param | Type | Description |
|---|---|---|
| `message` | `string` | Message content, signed as its UTF-8 bytes |
| `options.onSuccess` | `(result: SignMessageResult) => void` | Runs once `isSigning` is `false`, right before the promise resolves (see [Callbacks](#sending-transactions)). |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns**
`Promise<SignMessageResult>`: `{ signature, signedPayload, clientDataJsonBase64, authenticatorDataBase64 }`,
all base64. Check it with `verifyWalletMessage`.

#### `signAndSend(payload)` / `signAndSendTransaction(payload)`

Signs and sends transaction via Paymaster. The two names are the same
function. In Embedded mode the review sheet comes first (see
[Sending](#sending)).

**Parameters**

| Param | Type | Description |
|---|---|---|
| `payload.instructions` | `TransactionInstruction[]` | Instructions |
| `payload.transactionOptions` | `object` | Optional config |
| `transactionOptions.feeToken` | `string` | Token address for gas fees (e.g. USDC). |
| `transactionOptions.computeUnitLimit` | `number` | Max compute units. |
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Lookup tables for v0 txs (the portal preview uses them too). |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Portal mode: network for the portal's simulation. Embedded mode simulates on the provider's cluster. |
| `payload.onSubmitted` | `(signature: string) => void` | Called once, as soon as the transaction is sent, before it is confirmed. Never for one that was not sent. What it throws is logged. |
| `payload.confirm` | `boolean` | Embedded mode: show the review sheet (default: the provider's `confirm`, `true`). |
| `payload.onSuccess` | `(signature: string) => void` | Runs once `isSigning` is `false`, right before the promise resolves (see [Callbacks](#sending-transactions)). |
| `payload.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns**
`Promise<string>` - Transaction signature, once the transaction is confirmed
(see [Sending transactions](#sending-transactions)).

### `verifyWalletMessage(params)`

A function the package exports. Resolves `true` when `params.wallet` signed
`params.message`: the signature is over `signedMessageChallenge(message)` and
verifies against the key stored on chain in an Owner authority of the wallet
for `credentialId`, created under `rpId`, and the wallet account still exists.
A key the client sends is never used. Rejects when the chain cannot be read.
See [Signing messages](#signing-messages).

| Param | Type | Description |
|---|---|---|
| `connection` | `Connection` | The cluster the wallet lives on. |
| `wallet` | `string \| PublicKey` | The wallet the signer claims: its vault address or wallet PDA. |
| `credentialId` | `string` | The passkey's credential id, base64. |
| `rpId` | `string` | The passkey's relying party: the portal's hostname (portal mode), or your `rpId` (Embedded mode). |
| `cluster` | `'mainnet' \| 'devnet'` | Optional, for an RPC URL that does not say. |
| `message`, `signature`, `clientDataJsonBase64`, `authenticatorDataBase64`, `signedPayload`, `origin` | | As for `verifySignedMessage`. |

**Returns**
`Promise<boolean>`

### `verifySignedMessage(params)`

A function the package exports. `true` when `params.publicKey`'s passkey
signed a `webauthn.get` over `signedMessageChallenge(params.message)` with the
user present, and `false` otherwise; it never throws. It says nothing about
which wallet the key belongs to: to authenticate a wallet, use
`verifyWalletMessage`, or pass a key read from the wallet's authority on
chain. See [Signing messages](#signing-messages).

| Param | Type | Description |
|---|---|---|
| `message` | `string \| Uint8Array` | The message that was signed. |
| `publicKey` | `string \| Uint8Array \| number[]` | The passkey's P-256 key, read from chain: 33 bytes (compressed), 65 or 64, or their base64. |
| `signature` | `string \| Uint8Array` | The 64-byte signature, or its base64. |
| `clientDataJsonBase64` | `string` | From the `SignMessageResult`. |
| `authenticatorDataBase64` | `string` | From the `SignMessageResult`. |
| `signedPayload` | `string` | Optional; checked when given. |
| `rpId` | `string` | Optional: the authenticatorData's rpIdHash must be its SHA-256. |
| `origin` | `string` | Optional: clientDataJSON's `origin` must equal it. |

**Returns**
`boolean`

### `forgetStoredKeys()`

A function the package exports, not a `useWallet()` method. Deletes the
session key and the authority key the SDK keeps, whatever `keyStorage` is:
both IndexedDB slots, this page's memory copies, and any plaintext an earlier
release left in localStorage. A session or authority stays on chain; only the
key is gone, and a `createSession` or `addAuthority` still waiting for its
transaction does not keep its key once it lands. See
[Session and authority keys](#session-and-authority-keys).

**Returns**
`Promise<void>`. Rejects when IndexedDB holds keys and could not be cleared.
