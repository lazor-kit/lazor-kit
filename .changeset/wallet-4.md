---
'@lazorkit/wallet': major
---

4.0: Embedded mode and the Easy tier; typed approval requests, and session time in seconds.

Two changes ship together in this major:

- **Embedded mode** (`mode="embedded"`): the passkey lives on the app's own `rpId` and every ceremony runs in the app's page, with no portal, iframe or popup. With it come the Easy tier (`status`, `address`, `signAndSend` with a review sheet and `onSubmitted`, `<ConnectButton>`) and the `/core` and `/hooks` entry points.
- **Typed approval requests**: `createSession`, `revokeSession` and `removeAuthority` send the portal the operation itself, so it can show exactly what the passkey approves ("Let MyApp spend up to 0.002 SOL per payment and 5 USDC in total, until about 6:50 PM"), and sessions expire by the cluster clock instead of by slot.

Requires `@lazorkit/sdk-legacy` 2.0.0 and a LazorKit v2 program that measures sessions in seconds: release this together with that program upgrade.

**Breaking**

- `LazorkitProvider` requires `mode`: `"embedded"` or `"portal"`, with no default. Add `mode="portal"` to a 3.x app to keep its users' wallets. A missing mode does not compile, and throws `LazorkitConfigError('no-mode')` from JavaScript.
- Requires `@lazorkit/sdk-legacy` 2.0.0. Its `Actions.solRecurringLimit` / `tokenRecurringLimit` take `windowSeconds` instead of `window`, parsed actions carry `windowSeconds`, and `WalletFacts.liveSessions[].expiresAtSlot` is `expiresAt`; this package re-exports them.
- Session expiries are Unix seconds of the cluster clock (the Clock sysvar). A v2 program that still reads them as slots refuses them (3008).
- `SpendingLimits` recurring limits take `windowSeconds` (`86_400n` is a day) instead of `windowSlots`. A `windowSlots` throws before anything is read or prompted, rather than being read as seconds.
- v2 sessions default to `DEFAULTS.SESSION_EXPIRY_SECONDS` (18,000: 5 hours). `DEFAULTS.SESSION_EXPIRY_SLOTS` (50,000) is now the v1 default only.
- A session's actions (and a delegate's policy) fit in 224 bytes, down from 244: `@lazorkit/sdk-legacy` 2.0.0 sizes the passkey's clientDataJSON at 320 bytes and refuses more. `createSession` refuses a larger preset before the passkey is asked. `solPerTxMax` with `perTxMax` and `lifetimeCap` for 2 mints (223 bytes), or with `perTxMax` for 4 (223), still fits.
- A user rejection never sets the store's `error`, in either mode: a closed sheet or portal, "Not now", "None of these". The promise still rejects and `onFail` still runs. `PortalCancelledError` and `WalletConfirmationDeclinedError` now extend the new `UserRejectedError`, so they carry `code: 'USER_REJECTED'` and a `reason`; their names and messages are unchanged.
- A passkey whose public key cannot be recovered at connect rejects with `KeyRecoveryError` (`code: 'KEY_RECOVERY'`), in portal mode too, instead of a plain `Error`. The message is unchanged.
- The root and `/hooks` entries are client modules (`'use client'`). Server code imports from `@lazorkit/wallet/core`.
- The stored wallet is read synchronously when the provider first renders, so the first render can already be connected.
- The stored config is never read back: the provider's props are the config from the first render. (3.x put its stored config in the state until the provider's effect replaced it.) What is stored is unchanged.

**Embedded mode**

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
- `createSession`, `revokeSession` and `removeAuthority` prepare the same typed request as in portal mode; the passkey signs it in the page, and the signature is checked against the request (`verifyApprovalReply`) before anything is sent. There is no review sheet for these three yet.
- `signMessage` keeps the 3.3 format.
- Silent reconnect from `lazorkit:embedded:<rpId>:*`. Embedded never writes the portal's keys.
- Session and authority keys work as in portal mode: `spendingLimits` (with `tokens`) are checked before the passkey is asked, a send its limits do not cover is `UnlistedSolOutflowError` / `UnlistedTokenOutflowError`, and a send that loaded its key before a disconnect neither signs nor sends after it. The wallet adapter's and the Wallet Standard's disconnect disconnect the Embedded store too, its record included.

**Typed requests (portal mode)**

- On a v2 wallet, the three operations open the portal with the request (`@lazorkit/sdk-legacy/approval`, v1) in the URL fragment (`#/?lk1=…`). The query is unchanged, so a portal that does not read typed requests signs as before. Wallets made before LazorKit v2, and every other passkey action, open the portal as before.
- The portal's reply is checked before anything is sent: the passkey must have signed this operation, at the slot and counter the portal names (`typed` in the reply), or at the prepared ones when it names none. The transaction is then finalized at that slot and counter. A reply that does not match rejects with `PortalReplyMismatchError` and nothing is sent.
- The portal waits up to 10 minutes for a typed approval (60 seconds for other signing as before), since the portal picks the signing slot when the user taps Approve. Closing the portal still ends the wait at once.

**Session expiry**

- `createSession` takes `expiresInSeconds` (more than 0, at most 30 days; default 5 hours) or `expiresAt` (Unix seconds, within 30 days of the cluster clock), checked against the cluster clock before the passkey is asked.
- Deprecated and still accepted: `expiresInSlots`. On a v2 wallet it is converted to seconds with the cluster's measured slot time (recent performance samples), with a warning, and throws when the slot time cannot be read.
- v1 wallets keep slot-based expiry: with no expiry, 50,000 slots ahead as before (no slot-time read); `expiresInSlots` is used as given; `expiresInSeconds` / `expiresAt` are converted to slots with the measured slot time. A recurring limit's `windowSeconds` is converted to slots for a v1 wallet.
- A kept session key is deleted once the cluster clock is past its session's expiry. A key kept by an earlier release, or a v1 wallet's, is still compared with the slot.
- The wallet chooser's `approxExpiresAt` reads a v2 session's expiry as a Unix time.

**Fixed**

- A send the program refuses with 3023 (`ActionSolMaxPerTxExceeded`: more SOL in one transaction than the session's or delegate's `solPerTxMax`) is not sent again by the paymaster's retries, like 3006, 3014, 3037, 3038 and 4018. The same bytes move the same amount.

**New**

- `status` and `address` on `useWallet()`.
- `signAndSend` with `onSubmitted`.
- `<ConnectButton>`, `useWalletStatus()`, `useLazorkitClient()`.
- `createLazorkitClient()` and `getLazorkitClient()`: one client per page. A conflicting reconfigure throws `LazorkitConfigError('reconfigured')`.
- New error classes, with `errorKind()` and `userMessage()` (`'policy'` for `UnlistedSolOutflowError` and `UnlistedTokenOutflowError`).
- Typed-request errors: `PortalReplyMismatchError`; `RequestOutOfDateError` (the portal refused with `stale-counter`; `retryable: true`); `PortalRefusedError` (another refusal, with the portal's `code`); `TypedRequestTooLargeError` (the request or its URL is over the cap, 8,192 / 16,384 characters; nothing is opened). The passkey signed nothing on a refusal.
- `MAX_SESSION_SECONDS` (30 days).
- `onEvent` instrumentation (experimental).
- `forgetEmbeddedDevice()`.
- `passkeyCapabilities()`.
- `react` and `react-dom` are optional peer dependencies, for apps that use only `/core`.

**Deprecated**

- `isLoading`, `isConnecting` and `isSigning`: use `status`. They warn once when read.
- The session, authority and deferred functions on `useWallet`: they move to `/hooks` in a later 4.x, with the same names and parameters. They warn once each when first called.
- `createSession`'s `expiresInSlots`: use `expiresInSeconds`.

**Unchanged**

- Portal mode's connect, sign and message flows, and its stored bytes.
- The wallet adapter and the Wallet Standard wallet, which stay portal-only (their disconnect still disconnects the page's store, in either mode).
