---
'@lazorkit/wallet': major
---

4.0: Embedded mode, the Easy tier, and the `/core` and `/hooks` entry points.

**Breaking**

- `LazorkitProvider` requires `mode`: `"embedded"` or `"portal"`, with no default. Add `mode="portal"` to a 3.x app to keep its users' wallets. A missing mode does not compile, and throws `LazorkitConfigError('no-mode')` from JavaScript.
- A user rejection never sets the store's `error`, in either mode: a closed sheet or portal, "Not now", "None of these". The promise still rejects and `onFail` still runs. `PortalCancelledError` and `WalletConfirmationDeclinedError` now extend the new `UserRejectedError`, so they carry `code: 'USER_REJECTED'` and a `reason`; their names and messages are unchanged.
- A passkey whose public key cannot be recovered at connect rejects with `KeyRecoveryError` (`code: 'KEY_RECOVERY'`), in portal mode too, instead of a plain `Error`. The message is unchanged.
- The root and `/hooks` entries are client modules (`'use client'`). Server code imports from `@lazorkit/wallet/core`.
- The stored wallet is read synchronously when the provider first renders, so the first render can already be connected.
- The stored config is never read back: the provider's props are the config from the first render. (3.3.1 put its stored config in the state until the provider's effect replaced it.) What is stored is unchanged.
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
- `react` and `react-dom` are optional peer dependencies, for apps that use only `/core`.

**Deprecated**

- `isLoading`, `isConnecting` and `isSigning`: use `status`. They warn once when read.
- The session, authority and deferred functions on `useWallet`: they move to `/hooks` in a later 4.x, with the same names and parameters. They warn once each when first called.

**Unchanged**

- Portal mode's flows and stored bytes.
- The wallet adapter and the Wallet Standard wallet, which stay portal-only.
