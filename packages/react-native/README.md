# LazorKit React Native SDK

LazorKit allows you to build **Passkey-native** mobile applications.

It replaces complex seed phrases with the standard biometrics users already know: **FaceID** or **TouchID**.

## Features
- **Seedless**: Onboard users instantly with Passkeys
- **Gasless**: Sponsored transactions via Paymaster
- **Native**: Built for React Native & Expo
- **Secure**: Hardware-bound credentials

## Installation

```bash
npm install @lazorkit/wallet-mobile-adapter
```

## Usage

```tsx
import { LazorKitProvider, useWallet } from '@lazorkit/wallet-mobile-adapter';
import { View, Button, Text } from 'react-native';

// 1. Wrap App
export default function App() {
  return (
    <LazorKitProvider
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazor.sh"
      configPaymaster={{ paymasterUrl: "https://kora.devnet.lazorkit.com" }}
    >
      <WalletScreen />
    </LazorKitProvider>
  );
}

// 2. Use Hook
function WalletScreen() {
  const { connect, signMessage, isConnected } = useWallet();

  const handleSign = async () => {
    if (!isConnected) {
      await connect({ redirectUrl: 'myapp://home' });
      return;
    }

    const sig = await signMessage("Hello", { 
      redirectUrl: 'myapp://callback' 
    });
    console.log("Signed:", sig);
  };

  return <Button title="Action" onPress={handleSign} />;
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
the app used before v2. LazorKit's v2 relayer does not, so if `configPaymaster`
points at a v2 relayer, `v1ConfigPaymaster` is required:

```tsx
<LazorKitProvider
  configPaymaster={{ paymasterUrl: V2_PAYMASTER_URL }}
  v1ConfigPaymaster={{ paymasterUrl: EXISTING_PAYMASTER_URL }}
>
```

Show users the vault (`WalletInfo.smartWallet`, `useWallet().vaultPubkey`);
the exported PDA helpers derive v2 addresses and are wrong for a v1 wallet.

Once LazorKit retires v1, a v1 wallet's transactions fail with
`V1WalletRetiredError`. Its funds are safe; move it with
`LazorKitClient.migrateV1Wallet` from `@lazorkit/sdk-legacy`, or send the user
to the LazorKit migration page.

## Which wallet is the user's

A passkey's credential id is public — it sits in every account the passkey has
touched — and anyone can create a wallet that lists it, add it to a wallet of
their own, or hand it a wallet they have used first. So `connect` never takes
"the wallet this credential is on" at face value:

1. The passkey signs a challenge the SDK chose, a domain-separated ownership
   proof (see [Signing messages](#signing-messages)), in the connect reply
   when the portal supports it, otherwise in one more portal prompt. Only
   wallets whose stored key verifies that signature count.
2. Of those, one is used without asking only when it is the one wallet this
   passkey has signed for, and nothing else can spend from it: no other
   authority, live session, pending transaction or token approval, and a vault
   that is still a plain system account.
3. Anything else goes to the user — including their own wallet before its
   first transaction, and a user with two used wallets. A passkey proven on
   no live wallet gets a new v2 wallet, for its own key (below), saved as
   created (never looked up again).

This runs only on a fresh `connect`; a stored wallet and sign actions never
come through it. While a wallet is connected, `connect` returns it without
opening the portal (a `confirmWallet` naming another wallet throws: disconnect
first to connect another). It reads with `getProgramAccounts`, so `rpcUrl`
must allow that; a failed read fails `connect` rather than counting as "no
wallet".

**A passkey that has no wallet yet.** Every passkey starts without a v2
wallet, including one the user made on another device. Signing in never
reveals a passkey's public key, so the portal's reply carries the key it has
stored for it: none for a passkey made elsewhere, and possibly another
passkey's. A wallet for a key the passkey does not hold could never sign, so
the new wallet's key is always one a signature from this connect verifies
against: the reported key, once the proof from step 1 verifies against it
(as before); otherwise the key **recovered from two of the passkey's
signatures** over fresh challenges (`resolvePasskeyPublicKey`,
`@lazorkit/sdk-legacy` 1.3.0): the step 1 proof and the connect reply's
signature, or one more portal sign when the reply has none. That is **one
extra passkey prompt** over the case before it (a portal sign over a fresh
ownership-proof challenge, no transaction). So an existing passkey with no wallet now gets
one, for its real key. Closing that prompt rejects with
`PortalCancelledError`. If the signatures still do not settle on one key,
`connect` throws an error that says so. In both cases nothing is created.

A signature names its signer's key, never its passkey, and the wallet is
created under the passkey the connect reply names. So a recovered key is used
only when something ties it to that passkey: the connect reply's own
signature, or sign redirects that name the passkey they were made with (the
portal signs with the passkey the SDK asks for, its only `allowCredentials`
entry, and names it back). When a wallet is to be created, a sign redirect
that names another passkey fails `connect`, whichever key the reply reported;
so does recovery when nothing ties the key to the passkey. Nothing is created
in either case, since that passkey could never sign for a wallet with
another's key.

Beyond that, the recovered key is whoever signed. The signatures come back in
redirects, like the reported key and the step 1 proof, over challenges the
SDK chose and sent only in the portal URL it opens in the browser. So an app
that merely fires a deep link into your redirect scheme cannot sign them. An
app that can also *receive* your scheme's links (Android lets more than one
app claim a custom scheme) sees the portal's redirects, and the challenges in
them, and could answer in the portal's place with a key of its own. On iOS
the auth session hands the redirect to your app alone; on Android prefer a
redirect only your app can receive, such as a verified App Link. This is the
trust the reported-key check has always placed in the redirect; recovery adds
none.

```tsx
<LazorKitProvider
  onConfirmWallet="builtin"               // default
  trustedAuthorities={[BACKEND_ADMIN_KEY]} // your own Ed25519 keys, base58
  watchMints={[MY_TOKEN_MINT]}             // SPL mints your app receives
>
```

- **`onConfirmWallet`** — how the user is asked:
  - `'builtin'` (default): `LazorKitProvider` shows a chooser, "Which wallet is
    yours?", with each wallet's vault address (selectable), SOL balance, a
    "Legacy (v1)" tag, a note for a wallet not used with this passkey yet, and
    "Also controlled by: …" for anything else that can spend from it. Nothing
    is pre-selected or marked as safe; the order is not a recommendation. A
    wallet whose vault was handed to another program is shown with a warning
    and cannot be chosen there. "None of these" and the Android back button
    decline.
  - a function `(request) => { wallet } | null` (or a promise of it): your own
    chooser. `request.candidates` are `WalletChoice`s — vault, balance,
    `signatureCount`, `vaultIsSystemAccount`, and every other authority,
    session, pending transaction and token grant, each marked `trusted` or
    not. Resolve with the chosen `vault` (or `wallet`), or `null`. Never pick
    for the user.
  - `'throw'`: `connect` throws `WalletNeedsConfirmationError` with
    `credentialId` and `candidates`. Show them, then call
    `connect({ redirectUrl, confirmWallet: choice.vault })`; within two
    minutes that adopts it without opening the portal again (an address that
    is none of them throws at once, and they stay remembered). Disconnecting,
    or any `connect` that opens the portal, forgets the candidates.

  `connect({ redirectUrl, onConfirmWallet })` overrides it for one call.
  While the chooser (or your function) waits for the user, `isLoading` is
  `false` and `isConnecting` stays `true`, so an overlay you show while
  loading does not cover it.

  **iOS shows one modal at a time.** The built-in chooser is a React Native
  `Modal` that `LazorKitProvider` renders beside your app, and iOS will not
  present it over another modal that is open — your own `<Modal>`, or a
  screen presented modally (`presentation: 'modal'` in Expo Router /
  React Navigation). If you connect from inside one, render the chooser
  there as well; while it is mounted it draws instead of the provider's:

  ```tsx
  import { WalletChooser } from '@lazorkit/wallet-mobile-adapter';

  <Modal visible={signInOpen}>
    <SignInScreen />
    <WalletChooser />
  </Modal>
  ```

  If the chooser still is not on screen within a few seconds, `connect`
  rejects with `WalletChooserNotShownError` instead of waiting for an answer
  nobody can give. Android shows it over anything.
- **`confirmWallet`** — the user's pick, by vault or wallet PDA. It must be a
  wallet this passkey is proven to hold a key of; any other address throws
  rather than being ignored. While a wallet is connected it must name that
  one.
- **`trustedAuthorities`** — Ed25519 keys you control (a backend admin, session
  keys your app issues). An authority, session or token approval held by one
  of them does not stop a wallet from being used. Passkeys, pending
  transactions and a vault handed to another program are never waived.
- **`watchMints`** — the vault's token account for each of these mints (on top
  of wSOL, USDC, USDT and devnet USDC) is checked for having been handed to
  someone else. A handed-away account for a mint nobody watches cannot be
  seen at all, which is why a wallet this passkey never signed for always
  goes to the user.

Errors:

| Error | When |
|---|---|
| `WalletNeedsConfirmationError` | `onConfirmWallet: 'throw'` and the user has to choose. |
| `WalletConfirmationDeclinedError` | The user chose "None of these" (or your handler returned `null`). Nothing was saved, and no wallet was created. |
| `PortalCancelledError` | The user closed the portal (iOS cancel, or an Android Custom Tab dismissed without a redirect), or `disconnect` was called while `connect` ran — then that connect saves and remembers nothing, and its chooser closes. Also for sign actions. |
| `WalletChooserNotShownError` | iOS could not show the built-in chooser (another modal is open); see above. Nothing was saved. |
| `LazorKitError` with `code: 'PORTAL_ERROR'` | The portal redirected with an `error`; its text is the message. |

A second sign action while one is running rejects with `SigningError` (and
calls its `onFail` at once, while `isSigning` is still `true`: the flag is the
running action's). Each action's promise settles, and its `onSuccess` or
`onFail` runs, only once `isSigning` is `false` again, so the next call can be
made on the line after `await`, or from `onSuccess`. `disconnect` leaves
`isSigning` to an action still running, which goes on to its end and its
callbacks.

The same holds for every action, from the store as from the hook: `connect`
and `disconnect` call back once `isConnecting` is `false` (the store's
`connect` honours them too, and its `disconnect` takes them), except a
`connect` refused because another is running ("Already connecting"), which
calls back at once. Exactly one
callback runs per call, and it agrees with the promise: `onSuccess` with what
it resolves with, `onFail` with the error it rejects with, a refusal included
(another call signing, "No wallet connected", `transferSol` too). What a
callback throws is logged and changes nothing: a transaction that landed is
never reported as failed, and a throwing `onFail` does not replace the error.
The web SDK, `@lazorkit/wallet`, keeps the same contract.

## Sending transactions

Every send resolves once its transaction is **confirmed**, and rejects if it
failed on chain: `signAndSendTransaction`, `transferSol`, `authorizeAndExecute`,
`authorizeDeferred`, `executeDeferred`, `reclaimDeferred` and the session and
authority sends. The paymaster's answer is not enough: a relayer that answers
once the RPC accepted a transaction answers before it has run.

So two sends in a row are safe (`await` one, then the other). A passkey
signature commits to the passkey's counter, which the program checks
(`SignatureReused`, 3006): the adapter prepares each signature for a passkey
only after that passkey's previous transaction is confirmed, and reads the
counter at `confirmed` from an RPC node that has executed it
(`minContextSlot`).

| Error | When |
|---|---|
| `TransactionFailedError` | The transaction landed and failed: fees were paid, nothing else changed. `signature`, `transactionError`, `slot`, and `logs` when they were read. |
| `TransactionExpiredError` | It did not land before its blockhash expired, so it never will. Concluded only from an RPC node past that point, in its transaction history, never from a status cache that has forgotten a landed transaction. |
| `TransactionOutcomeUnknownError` | Whether it landed is not known: check before sending it again. `signature` is `undefined` when the paymaster's answer was lost (a network error, a timeout, a gateway error, or a resend of the same bytes that found them already processed). |
| `ConfirmationTimeoutError` | A `TransactionOutcomeUnknownError`: no outcome within two minutes, and it may still land. Check `signature` before sending again. |
| `PreviousTransactionPendingError` | Nothing was signed or sent: the passkey's previous transaction (`pendingSignature`) still has no known outcome, and a new signature could be bound to the counter it may use. Try again later. |
| `SignatureReusedError` | LazorKit rejected the passkey signature (3006): its counter was already used. Left for the same passkey signing somewhere else at the same moment, or a paymaster reading older state than the adapter. That signature can never be valid, so it is not resent, and no new portal trip opens on its own: ask the user to sign again. An inner program's error with the same code (Anchor's `AccountNotMutable`) is told apart by the logs and reported as the failure it is. |
| `PaymasterError` | The paymaster refused the transaction: `code` and `data` of its JSON-RPC error, or `httpStatus`. |
| `DeferredExpiredError` | TX2 of a deferred execution (`authorizeAndExecute`, `executeDeferred`) came after its authorization expired (`DeferredAuthorizationExpired`, 3014), so nothing in it ran. `authorizeSignature` (TX1, when this call sent it), `deferredExecPda` (the account holding the paymaster's rent: `reclaimDeferred` it) and `expiresAtSlot`. The passkey approval is spent: ask the user to approve again. An inner program's 3014 is not reported as this (see below). |
| `UnlistedSolOutflowError` | A `signAndSendWithSession` transaction would have lowered the wallet's SOL balance (rent for a new account included), and the session's actions name no SOL (`ActionUnlistedSolOutflow`, 3037). Nothing in it ran. Its message is "This session is not allowed to spend SOL"; `signer` is `'session'`, and `cause` the failure as it came. See [What a session's actions bound](#what-a-sessions-actions-bound). |
| `UnlistedTokenOutflowError` | The same for a token whose mint the actions do not name (`ActionUnlistedTokenOutflow`, 3038): "This session is not allowed to spend this token". |
| `PortalReplyMismatchError` | `createSession`, `revokeSession` or `removeAuthority`: the portal's redirect does not match the request the adapter prepared (another operation, slot, counter or kind; a forged deep link). Nothing was sent. `reason` says what differed. See [What the user approves](#what-the-user-approves-and-when-a-session-ends). |
| `RequestOutOfDateError` | The portal refused a typed request with `stale-counter`: its view of the passkey's counter was behind. The passkey signed nothing; `retryable` is `true`. |
| `PortalRefusedError` | The portal refused a typed request; the passkey signed nothing. `code`: `request-invalid` (it would fail on chain), `wrong-network`, `challenge-mismatch`, `typed-malformed`, `typed-unsupported` or `chain-unavailable`. |
| `TypedRequestTooLargeError` | The typed request, or the portal URL carrying it, is over its cap (8,192 / 16,384 characters). Nothing was opened. |

Every status read and paymaster request is bounded in time, so one that never
answers cannot hold a passkey's queue. The slot the passkey's last transaction
landed in, and a send whose outcome is not known yet, are also kept in
AsyncStorage (the slot for ten minutes): the app, restarted, reads its first
challenge from a node that has that transaction.

**Deferred execution.** `authorizeAndExecute` and `authorizeDeferred` take
`expiryOffset`: how many slots after TX1 the program still accepts TX2 (10 to
9000). The default, `DEFAULTS.DEFERRED_EXPIRY_SLOTS`, is 1500. The window is
counted in slots, whose length depends on the cluster and its load, and it
starts at TX1's slot, not when `authorizeDeferred` resolves. The adapter may
wait up to two minutes for TX1 to be confirmed before it sends TX2, so do not
pass a small value. The window is also how long an approval that is never
executed stays executable, with the paymaster's rent in it: the program has no
way to cancel an authorization before it expires.

An authorization that has already expired is not sent: the call rejects with
`DeferredExpiredError`. A 3014 from TX2 rejects with `DeferredExpiredError`
only when it is the authorization's own: its logs name LazorKit as the first
program to fail, it landed on chain after `expires_at`, or the chain is past
`expires_at` when the adapter reads it again (at `processed`). An inner program
may return 3014 too (Anchor's `AccountNotAssociatedTokenAccount`): that error,
and a 3014 whose program cannot be told, is thrown as it came. An error from
sending TX2 carries `deferredExecPda`, `authorizeSignature` (when the call sent
TX1) and `expiresAtSlot` (when it was read): `DeferredFailureContext`.
`isDeferredExpiredError` is true for a `DeferredExpiredError`, and for a 3014
whose logs name LazorKit as the first program to fail; not for a 3014 that
names no program.

**Recognising errors.** `isSignatureReusedError`, `isDeferredExpiredError` and
`isRetiredDeploymentError(error, version?)` are true for the SDK's own error
(`SignatureReusedError`, `DeferredExpiredError`, `V1WalletRetiredError`) from
whichever copy of the package made it (matched by `name` and `code`, since
`instanceof` fails between two copies), and for one wrapped in `cause` or in a
wallet-adapter `WalletError`'s `error`. They also recognise the raw program
error, as web3.js text (`0xbbe`, `0xbc6`, `0xfb2`), a TransactionError
(`"Custom":3006`), Kora's text (`Custom(3006)`) or with the logs in a
paymaster's `data`. For a raw error the logs decide whose it is: a 3006 with
no logs counts as LazorKit's, a 3014 with no logs does not, and a 4018 counts
when the logs name the v1 program or `version` is 1. The other error classes
have no predicate: compare `error.name` (`'TransactionFailedError'`,
`'PaymasterError'`, `'V1WalletMigratedError'`, `'SigningError'`, …), which
holds across copies too.

`isUnlistedSolOutflowError` and `isUnlistedTokenOutflowError` are true for
`UnlistedSolOutflowError` and `UnlistedTokenOutflowError` from either copy,
wrapped the same way, and for a raw 3037 or 3038 (`0xbdd`, `0xbde`): one whose
logs name another program as the first to fail is not LazorKit's, one with no
logs is (no Anchor error uses these codes). `ERROR_NAMES` and `errorFromCode`
name 3036 to 3038 and 4018 as well.

The portal's transaction preview is compiled without lookup tables whenever it
fits in a packet, so the portal sees every account the transaction touches.
Only a payload over the 1232-byte limit is compiled with
`transactionOptions.addressLookupTableAccounts`, and a preview still over the
limit no longer fails `signAndSendTransaction`, `authorizeAndExecute` or
`authorizeDeferred` before the portal opens.

## Session keys

`createSession` registers a session key that your app generates, and
`signAndSendWithSession` signs with the `Keypair` you pass it. The adapter
never stores a session key, or the Ed25519 key you pass to
`addAuthorityEd25519`. What it keeps in AsyncStorage is the connected wallet's
public record, the configuration, and each passkey's transaction state; none of
it is secret. (The web SDK, `@lazorkit/wallet`, generates and keeps the key
itself, as a non-extractable WebCrypto key.)

### What the user approves, and when a session ends

`createSession`, `revokeSession` and `removeAuthority` send the portal the
operation itself, not only its challenge: a *typed request* in the URL
fragment (`#/?lk1=…`), next to the query earlier releases sent. A portal that
reads it shows exactly what the passkey approves, for example "Let MyApp spend
up to 0.002 SOL per payment and 5 USDC in total, until about 6:50 PM". It
recomputes the challenge from what it shows, and picks the slot it signs when
the user taps Approve. A portal that does not read typed requests signs the
challenge in the query, as before. Other passkey actions open the portal as
before.

Before anything is sent, the adapter checks the redirect against the request
it prepared: the passkey must have signed this operation, at the slot and
counter the portal names (`typedV`, `typedKind`, `typedSlot`, `typedCounter`,
`typedSysvarIx`), or at the prepared ones when the portal names none. A
redirect that does not match, a forged deep link included, rejects with
`PortalReplyMismatchError` and nothing is sent. The portal's refusals
(`type=error&code=…`) mean the passkey signed nothing: `RequestOutOfDateError`
(`stale-counter`, the portal's node was behind; `retryable: true`, a new
request may go through) or `PortalRefusedError` with the portal's `code`
(`request-invalid`, `wrong-network`, `challenge-mismatch`, `typed-malformed`,
`typed-unsupported`, `chain-unavailable`). A request whose URL would be over
16,384 characters is refused with `TypedRequestTooLargeError` before the
browser opens; it is never truncated. Wallets made before LazorKit v2 send no
typed request.

A session ends by the **cluster clock** (the Clock sysvar's Unix time, which
the program compares against), not by slot:

- `expiresInSeconds`: how long it lasts, more than 0 and at most 30 days
  (`MAX_SESSION_SECONDS`), counted from the cluster's time when
  `createSession` reads it.
- `expiresAt`: when it ends, as a Unix time in seconds, after the cluster's
  time and at most 30 days ahead of it.
- Neither: `DEFAULTS.SESSION_EXPIRY_SECONDS`, 5 hours.
- `expiresAtSlot` is deprecated. It is still accepted: the slots left until it
  are converted to seconds with the cluster's measured slot time (recent
  performance samples), with a warning, and it throws when the slot time
  cannot be read. Give at most one of the three.

An expiry the program would refuse throws before the portal opens. Recurring
limits count seconds too: `Actions.solRecurringLimit({ limit, windowSeconds:
86_400n })` is a day.

To keep a session key across restarts, store it in the OS keystore with
`expo-secure-store` (iOS Keychain, Android Keystore). Never store it in
AsyncStorage, which is not encrypted on disk and is included in device backups.

```ts
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { Keypair, PublicKey } from '@solana/web3.js';

const SLOT = 'myapp.lazorkit-session';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// Once createSession has resolved. `walletPda`: the connected wallet's
// (`wallet.walletPda`), the only one this key may sign for.
// `expiresAt`: when the session ends, in Unix seconds.
async function keepSession(sessionKeypair: Keypair, sessionPda: PublicKey, expiresAt: bigint, walletPda: string) {
  const value = JSON.stringify({
    seed: Buffer.from(sessionKeypair.secretKey.slice(0, 32)).toString('base64'),
    sessionPda: sessionPda.toBase58(),
    expiresAt: expiresAt.toString(),
    walletPda,
  });
  await SecureStore.setItemAsync(SLOT, value, OPTIONS);
}

// The kept session, only for the wallet connected now (`wallet.walletPda`).
async function keptSession(connectedWalletPda: string | undefined) {
  const raw = await SecureStore.getItemAsync(SLOT, OPTIONS);
  if (!raw) return null;
  const { seed, sessionPda, expiresAt, walletPda } = JSON.parse(raw);
  if (!connectedWalletPda || walletPda !== connectedWalletPda) return null;
  return {
    sessionKeypair: Keypair.fromSeed(Buffer.from(seed, 'base64')),
    sessionPda: new PublicKey(sessionPda),
    expiresAt: BigInt(expiresAt),
  };
}

// Once revokeSession has resolved, the session has expired, or the user
// disconnects.
async function forgetSession() {
  await SecureStore.deleteItemAsync(SLOT, OPTIONS);
}
```

- Keep the wallet the session belongs to with the key, and use the key only
  while that wallet is connected: the session signs for its own wallet
  whichever wallet the app shows. The web SDK does this for the keys it keeps
  (`KeyWalletMismatchError`), and deletes its session key on `disconnect`.

- `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the item on this device: it is not
  restored to another one from a backup.
- On iOS, a Keychain item survives uninstalling the app. After a reinstall,
  the item may name a session that has expired or been revoked: check the
  session account still exists and `expiresAt` is after the cluster's time
  (`new LazorKitClient(connection).getClusterTime()`) before you use it, and
  delete the item if not.
- On Android, exclude SecureStore's data from Auto Backup (see the
  expo-secure-store docs). A restored item cannot be decrypted on another
  install.
- `requireAuthentication: true` asks for the user's biometrics on every read,
  and the item is lost when the enrolled biometrics change.
- What bounds a session key is what was registered on chain: its `actions`
  (spending limits) and its expiry, not where you keep it.

### What a session's actions bound

A session's `actions`, and the `policy` of a key added with
`addAuthorityEd25519` and `ROLE_SPENDER`, name what may leave the wallet, and
under LazorKit v2 nothing they do not name may (from the program release that
adds errors 3037 and 3038: until then an asset they do not name is not
bounded at all, see the end of this section):

- **SOL** leaves only with an `Actions.sol*` action (`solMaxPerTx`,
  `solLimit`, `solRecurringLimit`). Without one, a transaction that lowers the
  wallet's SOL balance is refused, rent the wallet pays for a new account
  included (a recipient's token account, say): `UnlistedSolOutflowError`
  (3037). The network fee is the fee payer's, not the wallet's.
- **A token** leaves only with an `Actions.token*` action (`tokenMaxPerTx`,
  `tokenLimit`, `tokenRecurringLimit`) that names its mint. Any other mint is
  refused: `UnlistedTokenOutflowError` (3038). wSOL is a mint of its own: a
  SOL action does not name it.
- Limits are net over one transaction, and what comes in always passes. A
  swap needs an action for the mint it sells, and a SOL action when the
  wallet pays the rent of its output token account. A program whitelist names
  programs, not assets.
- The wallet's token accounts a transaction passes writable may change only
  their balance: owner, delegate, close authority and state stay as they were
  (`SessionTokenAuthorityChanged`, 3032).
- A session or policy holds at most 16 actions, and at most one of each kind
  per mint, and they must fit in the transaction that registers them, beside
  the passkey's response: keep them within 244 bytes. `Actions.solMaxPerTx`
  and `solLimit` take 19 bytes (`solRecurringLimit` 43), `tokenMaxPerTx` and
  `tokenLimit` 51 and `tokenRecurringLimit` 75: `solMaxPerTx` with
  `tokenMaxPerTx` and `tokenLimit` for 2 mints (223 bytes), or `solMaxPerTx`
  with `tokenMaxPerTx` for 4 (223). The transaction holds 1232 bytes, and the
  passkey's clientDataJSON takes up to about 300 of them. Nothing checks this
  before the portal opens: actions that do not fit fail after the user
  approved.

A session made with `unrestricted: true` (no actions) has none of these
bounds: it can move anything the wallet holds until it expires.

So name every mint the session may spend, in the mint's base units:

```ts
import { Actions } from '@lazorkit/wallet-mobile-adapter';
import { PublicKey } from '@solana/web3.js';

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

await createSession(
  {
    sessionKey: sessionKeypair.publicKey,
    expiresInSeconds: 3600, // an hour, by the cluster clock
    actions: [
      Actions.solMaxPerTx(10_000_000n), // 0.01 SOL a transaction, rent included
      Actions.tokenMaxPerTx({ mint: USDC, max: 5_000_000n }), // 5 USDC a transaction
      Actions.tokenLimit({ mint: USDC, remaining: 100_000_000n }), // 100 USDC in all
    ],
  },
  { redirectUrl },
);
```

The program enforces this from the release that adds errors 3037 and 3038.
Until that release an asset the actions do not name is not bounded at all: a
session with token actions only can spend all the wallet's SOL, and one with
SOL actions only any token. After it, a session or delegate whose actions
name SOL only can move no token: revoke it (`revokeSession`, or
`removeAuthority` for a delegate) and register one whose actions name the
mints it spends. The program does not create a second session for the same
key while the first exists.

## Signing messages

`signMessage` never signs the app's bytes as the passkey's WebAuthn
challenge. Message signatures are domain-separated from every other passkey
challenge: they sign this challenge instead (format v1, the same as
`@lazorkit/wallet`'s):

```
tag       = UTF-8 "LazorKit signed message v1"     (26 bytes)
challenge = tag || SHA-256(tag || message)        (58 bytes)
```

`message` is the UTF-8 bytes of the string. `signedMessageChallenge(message)`
computes it, and `SIGNED_MESSAGE_DOMAIN` is the tag. The other challenges the
adapter asks a passkey for have shapes of their own, so no challenge of one
kind can be another:

| Challenge | Shape |
|---|---|
| Transaction (what the programs verify) | a 32-byte hash |
| Message | 58 bytes, starting with `LazorKit signed message v1` |
| Ownership proof (connect) | 59 bytes: `LazorKit ownership proof v1` then 32 random bytes (`createOwnershipChallenge()`, `OWNERSHIP_PROOF_DOMAIN`) |

The portal gets the challenge as `message` and the text as `displayMessage`;
a portal that shows `displayMessage` checks that `message` is its challenge.
The adapter checks the portal's redirect: a reply over any other challenge is
refused.

`signMessage` resolves with a `SignMessageResult`, all base64:

| Field | What it is |
|---|---|
| `signature` | The P-256 signature, 64 bytes (r \|\| s, low-S). |
| `signedPayload` | What the passkey signed: authenticatorData \|\| SHA-256(clientDataJSON). |
| `clientDataJsonBase64` | The WebAuthn clientDataJSON. Its `challenge` is base64url(challenge). |
| `authenticatorDataBase64` | The WebAuthn authenticatorData. |

**Checking one: which wallet signed.** A message signature proves that a
passkey key signed the message, not which wallet that key belongs to. To
authenticate a wallet, read the key from the chain, never from the client: a
server that takes the key from the request accepts anyone's passkey for any
wallet they name. `verifyWalletMessage` does the lookup:

```ts
import { Connection } from '@solana/web3.js';
import { verifyWalletMessage } from '@lazorkit/wallet-mobile-adapter';
// or, on a server without React Native: from '@lazorkit/wallet'

const ok = await verifyWalletMessage({
  connection: new Connection(RPC_URL),
  cluster: 'mainnet',              // when RPC_URL does not say which cluster
  wallet,                          // the wallet the client claims (its address)
  credentialId,                    // the passkey's credential id, base64
  rpId: 'portal.lazor.sh',         // the passkey's relying party (config.rpId)
  message: 'Sign in to example.com\nNonce: 8f2c…',
  ...result,                       // what signMessage resolved with
});
```

It is `true` only when the signature is over `signedMessageChallenge(message)`
(a `webauthn.get` with the user present, under `rpId`) and verifies against
the key stored on chain in an Owner authority of `wallet` for `credentialId`
(v2 or v1), and the wallet account still exists. It reads the chain with one
`getProgramAccounts` per program, as connect does, and rejects when the chain
cannot be read (treat that as not verified). Put your domain and a fresh
nonce in the message, and check them, as with any sign-in message.

`verifySignedMessage({ message, publicKey, ...result })` is the offline part
of that check, with no RPC: `true` only when `publicKey`'s passkey signed
`signedMessageChallenge(message)`, and `false` for any other challenge, the
raw message bytes included. It never throws. Use it alone only with a key you
read from the claimed wallet's authority on chain yourself.

## API Reference

### `useWallet()`

#### `connect(options)`

Connects to the wallet.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `options.redirectUrl` | `string` | Deep link URL |
| `options.confirmWallet` | `string` | The wallet the user chose (vault or wallet PDA). See [Which wallet is the user's](#which-wallet-is-the-users). |
| `options.onConfirmWallet` | `'builtin' \| 'throw' \| (request) => …` | Overrides the provider's setting for this call. |
| `options.onSuccess` | `(wallet: WalletInfo) => void` | Runs once `isConnecting` is `false`, right before the promise resolves. |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

#### `disconnect(options?)`

Disconnects the wallet. A `connect` still running is abandoned: it rejects
with `PortalCancelledError` and connects nothing. `options.onSuccess` /
`options.onFail` run once the disconnect is over.

#### `signMessage(message, options)`

Signs a message with the passkey. The passkey signs
`signedMessageChallenge(message)`, never the message's bytes (see
[Signing messages](#signing-messages)).

**Parameters**

| Param | Type | Description |
|---|---|---|
| `message` | `string` | Content to sign, signed as its UTF-8 bytes |
| `options.redirectUrl` | `string` | Deep link URL |
| `options.onSuccess` | `(result: SignMessageResult) => void` | Runs once `isSigning` is `false`, right before the promise resolves. |
| `options.onFail` | `(error: Error) => void` | Runs with the error the promise rejects with. |

**Returns**
`Promise<SignMessageResult>`: `{ signature, signedPayload, clientDataJsonBase64, authenticatorDataBase64 }`,
all base64. Check it with `verifyWalletMessage`.

#### `addAuthorityEd25519(payload, options)`

Adds an Ed25519 public key your app (or backend) holds as an authority of the
connected wallet, with one passkey approval. `payload.role` is required: there
is no default, and a missing or unknown role throws before anything is read or
the portal opens.

| Role | What the key may do |
|---|---|
| `ROLE_OWNER` (0) | Add and remove any authority, other owners included (never the last owner), and spend without limit. On a v2 wallet the protocol SDK adds an owner only with `allowOwner`, which this method does not pass, so `ROLE_OWNER` is refused there before anything is read or the portal opens. On a v1 wallet it adds one. |
| `ROLE_ADMIN` (1) | Add and remove delegates only, and spend without limit. |
| `ROLE_SPENDER` (2), the delegate rank | Manage no authority; spend only within its `policy` (required for this rank on v2; build it with `serializeActions([...])`). |

For a key your app holds, use `ROLE_SPENDER` with a `policy`.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `payload.newEd25519Pubkey` | `PublicKey` | The key to add. |
| `payload.role` | `number` | Required: `ROLE_OWNER`, `ROLE_ADMIN` or `ROLE_SPENDER`. |
| `payload.policy` | `Uint8Array` | The spending policy, for `ROLE_SPENDER`. It names what may leave the wallet: see [What a session's actions bound](#what-a-sessions-actions-bound). |
| `payload.unrestricted` | `boolean` | Required on a v1 wallet, where any added key can spend the whole vault. |
| `options.redirectUrl` | `string` | Deep link URL |

**Returns**
`Promise<{ signature: string; newAuthorityPda: PublicKey }>`

#### `signAndSendTransaction(payload, options)`

Signs and sends transaction.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `payload.instructions` | `TransactionInstruction[]` | Instructions |
| `payload.transactionOptions` | `object` | Config options |
| `transactionOptions.feeToken` | `string` | Token address for gas fees (e.g. USDC). |
| `transactionOptions.computeUnitLimit` | `number` | Max compute units. |
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Lookup tables for v0 txs (the portal preview uses them too). |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Network for simulation. |

| `options.redirectUrl` | `string` | Deep link URL |

**Returns**
`Promise<string>` - Signature, once the transaction is confirmed (see
[Sending transactions](#sending-transactions)).
