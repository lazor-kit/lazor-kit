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
   no live wallet gets a new v2 wallet, saved as created (never looked up
   again).

This runs only on a fresh `connect`; a stored wallet and sign actions never
come through it. While a wallet is connected, `connect` returns it without
opening the portal (a `confirmWallet` naming another wallet throws: disconnect
first to connect another). It reads with `getProgramAccounts`, so `rpcUrl`
must allow that; a failed read fails `connect` rather than counting as "no
wallet".

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
calls its `onFail`).

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
| `transactionOptions.computeUnitLimit` | `number` | Max compute units. |
| `transactionOptions.addressLookupTableAccounts` | `AddressLookupTableAccount[]` | Lookup tables for v0 txs. |
| `transactionOptions.clusterSimulation` | `'devnet' \| 'mainnet'` | Network for simulation. |

| `options.redirectUrl` | `string` | Deep link URL |

**Returns**
`Promise<string>` - Signature
