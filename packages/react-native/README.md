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

1. The passkey signs a challenge the SDK chose (in the connect reply when the
   portal supports it, otherwise in one more portal prompt). Only wallets whose
   stored key verifies that signature count.
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
extra passkey prompt** over the case before it (a portal sign over a random
challenge, no transaction). So an existing passkey with no wallet now gets
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
calls its `onFail`). Each action's promise settles, and its `onSuccess` or
`onFail` runs, only once `isSigning` is `false` again, so the next call can be
made on the line after `await`, or from `onSuccess`.

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

The portal's transaction preview is compiled without lookup tables whenever it
fits in a packet, so the portal sees every account the transaction touches.
Only a payload over the 1232-byte limit is compiled with
`transactionOptions.addressLookupTableAccounts`, and a preview still over the
limit no longer fails `signAndSendTransaction`, `authorizeAndExecute` or
`authorizeDeferred` before the portal opens.

### Transaction v1 (experimental, devnet only)

A SIMD-0385 v1 transaction carries up to 4096 bytes and 64 addresses. v0 stops
at 1232 bytes, and lookup tables do not lift its 64 account locks, which count
the accounts a table resolves. So payloads that v0 cannot carry even with
lookup tables, such as many swap routes, fit in v1.

It is opt-in, per call: pass `transactionOptions.txVersion: 'v1'` to
`signAndSendTransaction`, `transferSol`, `signAndSendWithSession`,
`authorizeAndExecute`, `authorizeDeferred` or `executeDeferred`. Without it
nothing changes: the adapter sends the same v0 transaction as before.
Connecting, sessions and authorities always send v0.

A `'v1'` request goes out as v1 only when all of these hold. Otherwise it goes
out as v0, exactly as with `'v0'`, and the reason is logged once:

- the paymaster says it signs v1 transactions:
  `configPaymaster={{ paymasterUrl, acceptsTxV1: true }}`;
- that paymaster has not refused a v1 transaction (JSON-RPC error -32051)
  since the app started;
- no `feeToken` is set;
- the wallet is on the devnet LazorKit v2 program. Mainnet, and wallets still
  on LazorKit v1, never send v1.

Do not set `acceptsTxV1` for `kora.devnet.lazorkit.com`: it cannot read v1
transactions.

- **Limits.** A v1 transaction carries its compute-unit limit and its
  loaded-accounts data size limit in the transaction itself, and the adapter
  always sets both. `computeUnitLimit` (1 to 1,400,000) and
  `loadedAccountsDataSizeLimit` (196,608 to 67,108,864 bytes) set them. Whatever
  is not set is measured by one simulation, bounded to 3 seconds: units × 1.2 +
  5,000 (at least 20,000), and loaded bytes × 1.1 rounded up to 32 KiB (at least
  196,608). When the simulation fails or does not answer in time, the
  transaction goes out with the maximums, which in v1 do not change the fee. A v1
  transaction has no SetComputeUnitLimit instruction. A limit out of range throws
  a `RangeError` before the portal opens. In `authorizeAndExecute` the limits
  apply to TX2, as `computeUnitLimit` does for v0.
- **No lookup tables.** v1 has none. `addressLookupTableAccounts` still serves
  the preview, and the transaction when it goes out as v0.
- **Too large.** A `'v1'` request that cannot be sent in the format chosen
  throws, and nothing is sent:

  | Error | When |
  |---|---|
  | `TransactionTooLargeError` | Over 4096 bytes or 64 addresses as v1; over 1232 bytes or 64 account locks as v0. `format`, `bytes`, `addresses`, and `v1Unavailable` (why v1 was not used). `stage: 'before-signing'`: found before the portal opened. `stage: 'after-signing'`: the passkey's answer was longer than estimated. The user approved, but nothing was sent and the approval was not used, so they can approve again. `transaction: 'tx2'`: TX2 of a deferred pair could not be carried, so TX1 was not sent either. |
  | `PayloadExceedsProgramLimitsError` | The payload is over the LazorKit program's ceilings, in any format: more than 16 instructions, or an instruction with more than 64 accounts while all of them have more than 128 (counting one per instruction). Before the portal opens. |

- **A paymaster that refuses v1.** It answers -32051 before signing anything.
  That call rejects with `PaymasterError` (`code: -32051`). It is not retried,
  and it is not sent again as v0. Later `'v1'` requests to that paymaster go out
  as v0 until the app restarts.
- **The portal** still shows the payload as a v0 transaction, as before.

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

#### `disconnect()`

Disconnects the wallet. A `connect` still running is abandoned: it rejects
with `PortalCancelledError` and connects nothing.

#### `signMessage(message, options)`

Signs a message string.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `message` | `string` | Content to sign |
| `options.redirectUrl` | `string` | Deep link URL |

**Returns**
`Promise<string>` - Signature

#### `signAndSendTransaction(payload, options)`

Signs and sends transaction.

**Parameters**

| Param | Type | Description |
|---|---|---|
| `payload.instructions` | `TransactionInstruction[]` | Instructions |
| `payload.transactionOptions` | `object` | Config options |
| `transactionOptions.feeToken` | `string` | Token address for gas fees (e.g. USDC). |
| `transactionOptions.computeUnitLimit` | `number` | Max compute units. v0: a SetComputeUnitLimit instruction. v1: the transaction's config. |
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Lookup tables for v0 txs (the portal preview uses them too). |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Network for simulation. |
| `transactionOptions.txVersion` | `'v0' \| 'v1'` | Default `'v0'`. `'v1'` is experimental and devnet only: see [Transaction v1](#transaction-v1-experimental-devnet-only). |
| `transactionOptions.loadedAccountsDataSizeLimit` | `number` | v1 only: the loaded-accounts data size limit, in bytes. Default: measured. |

| `options.redirectUrl` | `string` | Deep link URL |

**Returns**
`Promise<string>` - Signature, once the transaction is confirmed (see
[Sending transactions](#sending-transactions)).
