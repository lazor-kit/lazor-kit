---
'@lazorkit/wallet': major
---

4.0 (alpha on `feat/wallet-4-embedded`): Embedded mode, the Easy tier, and the `/core` and `/hooks` entry points.

**Breaking**

- `LazorkitProvider` requires `mode`: `"embedded"` or `"portal"`, with no default. Add `mode="portal"` to a 3.x app to keep its users' wallets. A missing mode does not compile, and throws `LazorkitConfigError('no-mode')` from JavaScript.
- A user rejection never sets the store's `error`, in either mode: a closed sheet or portal, "Not now", "None of these". The promise still rejects and `onFail` still runs. `PortalCancelledError` and `WalletConfirmationDeclinedError` now extend the new `UserRejectedError`; their names and messages are unchanged.
- The root and `/hooks` entries are client modules (`'use client'`). Server code imports from `@lazorkit/wallet/core`.
- The stored wallet is read synchronously when the provider first renders, so the first render can already be connected.
- Requires `@lazorkit/sdk-legacy` 1.3.1 or later.

**Embedded mode**

The passkey lives on the app's own `rpId`, and the SDK runs every ceremony in the app's page, with no portal, iframe or popup:

- `rpId` and `appName` are required. `rpId` must be a bare, canonical host name, not an IP; `localhost` is allowed. On mainnet the app's own `paymasterConfig` is required, and a `localhost` rpId is refused.
- One "Continue with passkey" connect:
  - one discoverable `get()`, with Chrome's immediate mediation when it is available and the call comes from a click;
  - a "No passkey on this device?" sheet: create, use a passkey on another device (hybrid), or not now;
  - new passkeys get `user.id` = the wallet's seed, so a returning user's wallet is read where the seed puts it, with no `getProgramAccounts` scan for the credential;
  - an unused wallet the passkey created alone is adopted without asking;
  - other passkeys go through the 3.3 lookup (v1 and v2) and key recovery, pinned to the same passkey.
- A new wallet is read back before it is saved: one Owner, this passkey's key, credential and rpId. A relayer's answer must be its own signature over the transaction the SDK built.
- `signAndSend` shows a review sheet first (`confirm`, on by default):
  - decoded instructions, and a simulation on the provider's cluster with the vault's balance change;
  - the review comes before the passkey challenge is prepared, and what is signed is a copy the app cannot change meanwhile;
  - sends read the passkey authority directly, with no scan.
- `signMessage` keeps the 3.3 format.
- Silent reconnect from `lazorkit:embedded:<rpId>:*`. Embedded never writes the portal's keys.

**New**

- `status` and `address` on `useWallet()`.
- `signAndSend` with `onSubmitted`.
- `<ConnectButton>`, `useWalletStatus()`, `useLazorkitClient()`.
- `createLazorkitClient()` and `getLazorkitClient()`: one client per page. A conflicting reconfigure throws `LazorkitConfigError('reconfigured')`.
- New error classes, with `errorKind()` and `userMessage()`.
- `onEvent` instrumentation (experimental).
- `forgetEmbeddedDevice()`.
- `passkeyCapabilities()`.

**Deprecated**

- `isLoading`, `isConnecting` and `isSigning`: use `status`. They warn once when read.
- The session, authority and deferred functions on `useWallet`: they move to `/hooks` in a later 4.x, with the same names and parameters.

**Unchanged**

- Portal mode's behaviour and stored bytes.
- The wallet adapter and the Wallet Standard wallet, which stay portal-only.
