# @lazorkit/wallet

## 4.0.0-next.0

### Major Changes

- [#131](https://github.com/lazor-kit/lazor-kit/pull/131) [`97aef65`](https://github.com/lazor-kit/lazor-kit/commit/97aef65e5a7df0f10accabcc5131d8a815aca0ce) Thanks [@onspeedhp](https://github.com/onspeedhp)! - 4.0: Embedded mode and the Easy tier; typed approval requests, and session time in seconds.

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

## 3.4.1

### Patch Changes

- [#120](https://github.com/lazor-kit/lazor-kit/pull/120) [`3d88ce1`](https://github.com/lazor-kit/lazor-kit/commit/3d88ce18de3d386e205052ff42c117a70c693628) Thanks [@onspeedhp](https://github.com/onspeedhp)! - `signMessage` with bytes that start with a UTF-8 byte order mark (EF BB BF) now sends a `displayMessage` that keeps the BOM (`ignoreBOM: true`), so the text the portal shows encodes back to exactly the signed bytes. Before, the BOM was dropped from the text, and a portal that recomputes the challenge from what it shows refused the request. Strings were not affected.

## 3.4.0

### Minor Changes

- [#115](https://github.com/lazor-kit/lazor-kit/pull/115) [`b8596ef`](https://github.com/lazor-kit/lazor-kit/commit/b8596efe20982dd7d1a920a6821fe85332cb15e3) Thanks [@onspeedhp](https://github.com/onspeedhp)! - A session or authority send still running when the wallet is disconnected neither signs nor sends after the disconnect, whichever way it came, and `LazorkitWalletAdapter.disconnect()` disconnects the store too.

  In 3.3.1, `adapter.disconnect()` and the Wallet Standard `standard:disconnect` deleted the session key the SDK keeps, but left the store's wallet connected, and the kept key re-checks only the store's wallet when it signs. So a `signAndSendWithSession` or `signAndSendWithAuthority` that had already loaded its key went on to sign and send when the adapter disconnected during it (while its blockhash was fetched, say). And after the adapter's disconnect, `useWallet()` still showed the wallet, and the authority key (and a session key kept with `keepSessionKeys`) went on signing for it with no reconnect. The store's own `disconnect()` already stopped a send at signing. Now:

  - `adapter.disconnect()` and `standard:disconnect` disconnect the store as its own `disconnect()` does: its wallet goes (also from what the store persists, so not back after a reload), a `connect` it is running is abandoned (it rejects with `PortalCancelledError`), `error` is cleared, and `isSigning` is left to the action running. A kept key signs only once its wallet is connected again. `keepSessionKeys` still only decides whether the session key is deleted.
  - A send that loaded its kept key before any disconnect (the store's, the adapter's, the Wallet Standard's) is refused right before the key signs, and again right before each attempt to hand what it signed to the paymaster, retries included. It rejects with `KeyWalletMismatchError`: `reason: 'no-wallet'`, or the new `reason: 'disconnected'` when the same wallet is connected again by then (send again). A refusal after the key signed ends "The transaction it had signed was not sent." If an earlier attempt got no answer from the paymaster, that attempt may still land: the send rejects with `TransactionOutcomeUnknownError` and is not sent again.
  - `KeyWalletMismatchReason` gains `'disconnected'`. The `Paymaster` constructor's options take `beforeAttempt`: it runs right before each attempt to send, retries included, of every send that paymaster makes, and what it throws stops the send. A session or authority send gets a paymaster of its own with its key's check there, so the check holds whichever way the transaction is sent.

  `@lazorkit/wallet-mobile-adapter` is unchanged: it has no wallet-adapter or Wallet Standard disconnect, and keeps no session key (the app holds it).

- [#117](https://github.com/lazor-kit/lazor-kit/pull/117) [`5c94fa6`](https://github.com/lazor-kit/lazor-kit/commit/5c94fa69b80a018ccd52155b113d076298663bbe) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Session limits name every asset a session may spend**

  LazorKit v2's next program release bounds what a session (or a delegate key) may move by what its policy names, and nothing else: with no SOL limit the wallet's SOL may not fall, rent for a new account included (`ActionUnlistedSolOutflow`, 3037), and a token may leave only when a limit names its mint (`ActionUnlistedTokenOutflow`, 3038). A session made with SOL limits only, as `SpendingLimits` could express until now, will move no token. Until that release an asset the limits do not name is not bounded at all: a session with `tokens` limits only can spend all the wallet's SOL.

  - `SpendingLimits` takes `tokens`: one entry per mint, `{ mint, lifetimeCap?, perTxMax?, recurring?: { limit, windowSlots } }`, amounts in the mint's base units. wSOL is a mint of its own.
  - `createSession` checks the limits before anything is read or the passkey is asked, and throws on a `tokens` entry with no limit, a mint named twice, an amount outside a u64, a window of 0 slots (which the program refuses), more than 16 actions, or more than 244 bytes of actions: what fits in the CreateSession transaction beside the passkey's response (a clientDataJSON of up to 300 bytes). A SOL limit takes 19 bytes (`solRecurring` 43), a token's `lifetimeCap` or `perTxMax` 51, its `recurring` 75: `solPerTxMax` with `perTxMax` and `lifetimeCap` for 2 mints, or with `perTxMax` for 4. Nothing is added that was not asked for.
  - Changed: for a `sessionKey` of your own that already has a session, `createSession` now checks the limits before it looks for that session, so a call with no `spendingLimits` (and not `unrestricted`), or invalid ones, throws where it resolved with the existing session. With valid limits it still resolves with the session as it was made, whatever limits are passed: to change an external key's limits, revoke its session (`revokeSession({ sessionPda })`) or register a new key.
  - New: `spendingLimitsToActions(limits)`, the actions a `SpendingLimits` stands for; `serializeActions(spendingLimitsToActions(limits))` is a delegate `policy` for `addAuthority`.
  - New: `UnlistedSolOutflowError` ("This session is not allowed to spend SOL") and `UnlistedTokenOutflowError` ("This session is not allowed to spend this token"; "This key …" for a delegate), which `signAndSendWithSession` and `signAndSendWithAuthority` reject with for a 3037 / 3038, with `signer` and the original error as `cause`. A send whose outcome is unknown stays `TransactionOutcomeUnknownError`, and an Admin key's 3037 / 3038 is mapped only when the logs name LazorKit (an Admin has no policy). `isUnlistedSolOutflowError` / `isUnlistedTokenOutflowError` recognise them from either copy of the package, wrapped, or raw; `UNLISTED_SOL_OUTFLOW_CODE`, `UNLISTED_TOKEN_OUTFLOW_CODE`.
  - The paymaster does not resend a transaction refused with 3037 or 3038 (the same bytes move the same assets), unless an earlier attempt's answer was lost.
  - `ERROR_NAMES` / `errorFromCode` name 3036 (`SessionNotExpired`), 3037, 3038 and 4018 (`RetiredDeployment`).

  See the README, "What a policy bounds".

## 3.3.1

### Patch Changes

- [#112](https://github.com/lazor-kit/lazor-kit/pull/112) [`7bab56d`](https://github.com/lazor-kit/lazor-kit/commit/7bab56d29fefbd362532ab75483834ff5386ff12) Thanks [@onspeedhp](https://github.com/onspeedhp)! - `LazorkitWalletAdapter.disconnect()` and the Wallet Standard `standard:disconnect` delete the session key the SDK keeps, as the store's `disconnect()` does.

  In 3.3.0 only `useWallet().disconnect()` (and the store's) deleted it. A dApp that signs the user out through wallet-adapter (`useWallet().disconnect()` from `@solana/wallet-adapter-react`, a wallet-adapter UI's Disconnect) or through the Wallet Standard cleared the stored wallet but left the session key a `createSession` on the same page had kept, which then signed again once its wallet was connected. Now:

  - `adapter.disconnect()` deletes the session key from IndexedDB, this page's memory and any plaintext an earlier release left, whichever wallet it is for and whatever `keyStorage` the provider uses, before the adapter emits `'disconnect'`. A key IndexedDB fails to delete is logged, and the disconnect still succeeds.
  - `adapter.disconnect({ keepSessionKeys: true })` keeps it, as `DisconnectOptions.keepSessionKeys` does for the store. New type `LazorkitAdapterDisconnectOptions`.
  - `standard:disconnect` takes no options, so it always deletes it.
  - The authority key is kept on both paths, as by the store's `disconnect()`; `forgetStoredKeys()` deletes it.

- [#106](https://github.com/lazor-kit/lazor-kit/pull/106) [`caafdc1`](https://github.com/lazor-kit/lazor-kit/commit/caafdc179ae3953009bdf6c5014db0424dbadb26) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Drop the unused peer dependencies `@solana/kit` ^5, `@solana/kora` ^0.1 and `@solana-program/token` ^0.9, so the wallet installs next to `@solana/kit` 8

  Nothing in the wallet imports them; the published bundle and its types are unchanged. They were carried over from an older adapter. Because npm installs peers, an app on `@solana/kit` 8 (or 6 or 7) could not install the wallet: `npm install` failed with `ERESOLVE` (`peer @solana/kit@"^5.0" from @solana-program/token@0.9.0`) unless run with `--legacy-peer-deps`. An app without `@solana/kit` got kit 5, Kora and the token program installed for nothing (111 packages instead of 72).

- [#112](https://github.com/lazor-kit/lazor-kit/pull/112) [`b30046c`](https://github.com/lazor-kit/lazor-kit/commit/b30046c77903814959a996a395c5bcc33c071131) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Security: the sign dialog sends the stored credentials to the portal's origin only.

  When the sign dialog opened, `DialogManager` posted the stored credential id, passkey public key and wallet address (`SYNC_CREDENTIALS`) to its iframe with `postMessage(message, '*')`, six times over three seconds. `'*'` delivers to whatever page the iframe shows at that moment: a portal page that navigated or redirected the frame elsewhere handed them to that page. They are now addressed to the origin of `portalUrl`, so the browser delivers them only while the iframe shows a page of the portal's origin, and drops them otherwise. A `portalUrl` with no origin to address (not an absolute URL, or an opaque origin) sends nothing. No change for a portal that stays on its own origin: its replies were already accepted from that origin only.

  Fixes code-scanning alert `js/cross-window-information-leak` (`CredentialManager.ts`).

- [#113](https://github.com/lazor-kit/lazor-kit/pull/113) [`704ba51`](https://github.com/lazor-kit/lazor-kit/commit/704ba511e36fb45df20deaa08379747553f7cc34) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Security:** domain-separated passkey challenges for messages and ownership proofs

  Message signatures are now domain-separated from every other passkey challenge. `signMessage` on the hook and the store, `LazorkitWalletAdapter.signMessage` and the Wallet Standard `solana:signMessage` sign a fixed-format challenge, never the app's bytes:

  ```
  challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"   (58 bytes)
  ```

  Connect's ownership proofs get their own tag too: `createOwnershipChallenge()` now returns `UTF-8 "LazorKit ownership proof v1" || 32 random bytes` (59 bytes). `verifyOwnershipProof` accepts it unchanged. A transaction challenge is a 32-byte hash, so no challenge of one kind can be another.

  - The portal gets the message challenge as `message` and the text to show as `displayMessage`. The SDK refuses a portal reply over any other challenge.
  - `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs. The adapter's and the Wallet Standard `signature` stay JSON bytes, now with the same four fields.
  - New: `verifyWalletMessage` checks that a wallet signed a message, with the passkey's key read from the chain (the wallet's Owner authority for the credential), never taken from the client. `verifySignedMessage` is its offline part, for a key you read from chain yourself. Also `signedMessageChallenge`, `SIGNED_MESSAGE_DOMAIN` and `OWNERSHIP_PROOF_DOMAIN`.
  - Deprecated: `useWallet().verifyMessage` and `verifySignatureBrowser`. They check only that `signature` is over `signedPayload`, not which message was signed; do not use them for authentication.
  - `DialogManager.openSign` and the `challenge` option of `openConnect` are documented as internal: pass them only challenges the SDK computed.
  - Fixes the hook's `signMessage`, which signed the base64 decoding of the text instead of the text.

  A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).

## 3.3.0

### Minor Changes

- [#110](https://github.com/lazor-kit/lazor-kit/pull/110) [`75128cb`](https://github.com/lazor-kit/lazor-kit/commit/75128cb3e752d35b0511cf5e6e6645b7ca441754) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Breaking:** `addAuthority` has no default role any more: `role` is required

  3.2.1 gave a key added without a `role` the Admin rank: it can add and remove delegates and spend the whole vault, with no policy and no expiry, until `removeAuthority`. An app that forgot the argument handed out the most a key can get short of Owner, and the SDK kept that key in the browser.

  - `role` is required in the types (`AddAuthorityPayload.role: number`, on `useWallet().addAuthority` and on the store): a call without it does not compile.
  - At runtime, a missing role, or one that is not `ROLE_OWNER` (0), `ROLE_ADMIN` (1) or `ROLE_SPENDER` (2), is refused before anything is read or the passkey is prompted: the call rejects (and calls `onFail`, and sets `error`) with an error that says what each rank may do (Owner: manage every authority, other owners included, never the last one; Admin: manage delegates only; both spend without limit; `ROLE_SPENDER`, the delegate rank: manage nothing, spend only within its `policy`, which v2 requires) and suggests `ROLE_SPENDER` with a policy for a key the app holds.
  - `ROLE_OWNER` on a v2 wallet is refused the same way, before anything is read or the passkey is prompted: the protocol SDK adds an Owner only on an explicit opt-in this method does not pass, so 3.2.1 failed there too, after reading the chain. The error names `ROLE_ADMIN` and `ROLE_SPENDER`. On a v1 wallet `ROLE_OWNER` is accepted, as before.

  A breaking change in a minor release, deliberately: 3.x is days old, protocol v2 is not live on mainnet yet, and the old default silently produced an unbounded Admin key. Every `addAuthority` call that compiles against 3.3.0 adds the same authority 3.2.1 did.

  **Migration:** pass the role you relied on: `addAuthority({ role: ROLE_ADMIN, ... })` keeps 3.2.1's behaviour. For a key your app uses to spend, prefer `addAuthority({ role: ROLE_SPENDER, policy: serializeActions([...]) })`.

- [#109](https://github.com/lazor-kit/lazor-kit/pull/109) [`91ae852`](https://github.com/lazor-kit/lazor-kit/commit/91ae85245c4bb72bba89e4f732d935961c1ca9ed) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Callbacks run once the action is over, a send from `onSuccess` runs, and a throwing callback no longer turns a landed transaction into a failure

  The callback contract is now the one `@lazorkit/wallet-mobile-adapter` 2.2 ships. In 3.2.1, `onSuccess` and `onFail` ran while `isSigning` was still `true`, and inside the action's own error handling:

  - `onSuccess` and `onFail` run once the action is over, with `isSigning` (or `isConnecting` for `connect`) already `false`, right before the promise settles. A send started from `onSuccess` runs; in 3.2.1 it was refused with "Already signing".
  - What a callback throws is logged and changes nothing. In 3.2.1 a throwing `onSuccess` made a transaction that had landed reject, call `onFail` and set `error`, so an app that retries on failure sent it twice. A throwing `onFail` no longer replaces the action's error.
  - Exactly one callback per call, agreeing with the promise. A refusal now calls `onFail` too ("Already signing", "No wallet connected", "Already connecting"). A refusal because another call is running is reported at once, while that call still holds `isSigning` / `isConnecting`, and leaves `error`, which is that call's, alone. A refusal for want of a wallet or connection also sets `error`.
  - New: `disconnect(options?)`, `removeAuthority(targetAuthorityPda, options?)` and `signMessage(message, options?)` take `onSuccess` / `onFail`, on the store and on `useWallet()`. The store dropped them before (`signMessage` took none). `useWallet()`'s types declare the callbacks every action already took at runtime, and the package exports `ActionCallbacks`, `DisconnectOptions`, `RemoveAuthorityOptions` and `SignMessageOptions`.
  - `disconnect` no longer clears `isSigning` while an action runs, as on mobile. The action goes on to its end (its passkey prompt may still be open) and keeps the flag until then, so a second one is refused with "Already signing" instead of starting beside it, and the first no longer clears the second's flag when it ends.
  - `LazorkitWalletAdapter` calls each `connect` or `disconnect` listener on its own and logs what one throws, instead of failing a `connect()` that has connected (it also emitted `error`). A listener that throws no longer stops the ones after it, such as wallet-adapter-react's `WalletProvider`. The Wallet Standard wallet does the same for `change` listeners, and neither fails `standard:connect`.

  Minor rather than patch: the timing of every callback and the outcome of a nested send change, and `disconnect` / `removeAuthority` / `signMessage` gain options. Nothing is removed, and every behaviour that changes was a defect.

- [#110](https://github.com/lazor-kit/lazor-kit/pull/110) [`0e2a589`](https://github.com/lazor-kit/lazor-kit/commit/0e2a589d857c42ca4c397bbe4d496922b6b36fcd) Thanks [@onspeedhp](https://github.com/onspeedhp)! - A kept session or authority key signs only for the wallet it was registered for, `disconnect` deletes the session key, and an expired session's key is deleted

  In 3.2.1, `signAndSendWithSession` and `signAndSendWithAuthority` signed with the stored key for the wallet it was registered for, whichever wallet was connected, or none. A key left behind by one user signed for them after they disconnected, and after someone else connected on the same browser.

  - Every key the SDK keeps is stored with the wallet it was registered for (its wallet PDA), its session or authority PDA, and a session's expiry. `signAndSendWithSession`, `signAndSendWithAuthority` and `revokeSession()` (without `sessionPda`) use it only while that same wallet is connected. Otherwise they reject with the new `KeyWalletMismatchError` before anything is signed or sent, and call `onFail` once `isSigning` is `false`, as every action does. `reason` is `'no-wallet'` or `'other-wallet'`; `keyWallet` and `connectedWallet` are the wallet PDAs. The key checks again when it signs, so a wallet that disconnects or switches while a send is being built stops that send too.
  - New exports: `KeyWalletMismatchError`, `isKeyWalletMismatchError(error)` (true for one from either copy of the package, and wrapped in `cause` or a wallet-adapter `WalletError`, like the other `is*Error` predicates), and the type `KeyWalletMismatchReason`.
  - A key 3.2 left in localStorage named its wallet, unchecked. On its first use it is bound to that wallet if the program derives its session or authority PDA from that wallet and the key, or else to the wallet the PDA's account on chain names, if that account is LazorKit's and names the key. **An entry whose wallet cannot be confirmed either way is never used**: every send rejects with `KeyWalletMismatchError` and `reason: 'unbound'`. Create the session (add the authority) again, which replaces it; `forgetStoredKeys()` deletes it too, along with the other kept key.
  - A stored binding is checked on every use, offline: the record's session or authority PDA must derive from the wallet it names and the key. A record that does not (altered in IndexedDB, or made on another cluster) is checked as a 3.2 entry is, and refused as `'unbound'` unless its account on chain names its wallet.
  - `disconnect()` deletes the session key the SDK keeps (IndexedDB, the page's memory and any plaintext 3.2 left), whichever wallet it belongs to, and a `createSession` still waiting for its transaction does not keep its key once it lands (the call succeeds, a warning is logged, the session stays on chain until it expires). `disconnect({ keepSessionKeys: true })` keeps it. The authority key is kept, and signs only once its wallet is connected again; `removeAuthority` and `forgetStoredKeys()` delete it. A key IndexedDB fails to delete is logged, and `disconnect` still succeeds. New `DisconnectOptions.keepSessionKeys`.
  - `disconnect()` acts in its own tab: another tab of the app stays connected, and its authority key keeps signing there. The keys in IndexedDB are shared by every tab; `forgetStoredKeys()` at sign-out leaves none for any tab.
  - A stored session key whose session has expired is deleted when it is next read (a send, or `revokeSession()`), which rejects with "No session key found: the stored session … expired after slot …". It is deleted only once the chain, read at the connection's commitment, is past the session's `expiresAt`.

  **Migration:** an app that sends with a kept key must have the key's wallet connected first. An app that kept a session across sign-out and sign-in passes `disconnect({ keepSessionKeys: true })`; otherwise the user approves a new session after connecting again. Where it sent before `connect` resolved (on page load, say), wait for the wallet. Handle `isKeyWalletMismatchError(error)` by creating a session (adding an authority) for the connected wallet, or by asking the user to connect the wallet the key belongs to.

- [#110](https://github.com/lazor-kit/lazor-kit/pull/110) [`209c925`](https://github.com/lazor-kit/lazor-kit/commit/209c9250512977730d017d3b92927b5830e256ca) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Security: session and authority keys are no longer kept in localStorage as plaintext

  3.2.1 wrote the 64-byte secret key of every session key `createSession` generated, and of every authority key `addAuthority` generated, to localStorage as a JSON number array (`lazorkit-session`, `lazorkit-authority`). Any script on the page, a browser extension, a session-replay tool or a look at dev tools could copy it, and `addAuthority`'s key is an Admin by default, with no spending policy and no expiry.

  - The SDK now keeps such a key as a non-extractable WebCrypto Ed25519 key in IndexedDB (`lazorkit-keys`), which signs with `crypto.subtle` and whose secret no script can read (a script on the page can still make it sign). Where the browser has no WebCrypto Ed25519 (iOS 16, Chrome 136 and older), the seed is sealed with AES-GCM under a non-extractable key in the same database, and moved to a non-extractable Ed25519 key once the browser has one; any script on the page can decrypt that seed, so this tier only keeps the key out of localStorage. Without IndexedDB, or outside a secure context, the key is kept in the page's memory and is gone on reload. Nothing is written to localStorage.
  - What it does not change: the key is still at rest in the browser profile. Chromium writes a non-extractable key's bytes to the profile's IndexedDB files unencrypted, so malware that reads the profile can copy it, as with 3.2's localStorage entry. `keyStorage: 'memory'` keeps nothing at rest.
  - Migration: a plaintext key an earlier release left is moved when `LazorkitProvider` mounts, or on its first use, and the plaintext is deleted once the move has committed. A move that fails, or an IndexedDB that does not open (an error, or no answer within 5 seconds), leaves the plaintext, which is tried again on the next use; the key signs from memory meanwhile. Only where the key can go nowhere but memory (no IndexedDB, no WebCrypto, an IndexedDB that cannot hold a WebCrypto key) is the plaintext deleted. An entry the SDK did not write is left untouched.
  - New export `forgetStoredKeys()`: deletes both kept keys wherever they are (IndexedDB, memory, plaintext left by an earlier release), and a `createSession` or `addAuthority` still waiting for its transaction does not keep its key once it lands. A kept key signs only for the wallet it was registered for (see the changeset on binding keys to their wallet). **If your app removed `lazorkit-session` / `lazorkit-authority` from localStorage at sign-out, or called `localStorage.clear()`, that no longer removes the keys: call `forgetStoredKeys()`.**
  - New `LazorkitProvider` prop and `WalletConfig` field `keyStorage: 'auto' | 'memory'`. The default is `'auto'`. `'memory'` keeps nothing at rest.
  - A key that cannot be stored after its session or authority landed is kept in the page's memory and signs from there; if IndexedDB only failed that once, the key is stored on its next use, unless another tab stored a newer one meanwhile. The call succeeds, and a warning is logged. (In 3.2.1 a localStorage quota or `SecurityError` at that point called `onFail` for a transaction that had landed.)
  - `revokeSession()` deletes the kept session key once the revoke lands, whether or not the session was passed by PDA. `removeAuthority` deletes the kept authority key when it removes that authority; 3.2.1 never deleted it.
  - A key passed as `createSession({ sessionKey })` is still never stored.
  - Signatures: where WebCrypto signs deterministically, as RFC 8032 specifies (Chromium, Node), a kept key signs exactly as web3.js's `Keypair` does with the same seed. Safari's signatures use a random nonce and are equally valid.
  - Fix: the portal dialog no longer leaves a timer polling every 500 ms for the rest of the page's life when a sign request is answered or closed within its first half second.

  Minor rather than patch: there is a new optional prop and a new export, and the migration is one-way. After it, 3.2.1 or earlier finds no key ("No session key found. Create a session first."), and the user creates a new session. No exported API changes shape. No exported API ever returned the secret key; the JSDoc did say it was kept in localStorage.

### Patch Changes

- [#109](https://github.com/lazor-kit/lazor-kit/pull/109) [`878bb2a`](https://github.com/lazor-kit/lazor-kit/commit/878bb2ac6adb35cd34b1c075a2fd60a1970fcc6c) Thanks [@onspeedhp](https://github.com/onspeedhp)! - `isSignatureReusedError` and `isRetiredDeploymentError` are true for the SDK's own errors, and every `is*Error` predicate reads through wrapped errors

  3.2.1 checked only an error's text, so `isSignatureReusedError(new SignatureReusedError())` and `isRetiredDeploymentError(new V1WalletRetiredError())` were `false` (the bug 3.2.1 fixed in `isDeferredExpiredError`).

  - `isSignatureReusedError`, `isRetiredDeploymentError` and `isDeferredExpiredError` are true for `SignatureReusedError`, `V1WalletRetiredError` and `DeferredExpiredError`, including one from another copy of the package (an app that loads both the ESM and the CJS build has two; matched by `name` and `code`).
  - They read through what wraps an error: `cause`, and the `error` of a wallet-adapter `WalletError`. A dApp on the Wallet Standard gets every error as `WalletSendTransactionError(message, error)`, so these were always `false` there.
  - For a raw error they read the message, the logs, a paymaster's `data` and a TransactionError, in the error and in its causes (a cause that is a plain object, or holds the code only in its `data`, was missed). The documented rules for raw errors are unchanged: a 3006 with no logs counts as LazorKit's, and a 3014 with no logs does not.
  - `isRetiredDeploymentError` also accepts Kora's `Custom(4018)` text, a 4018 whose logs are only in the paymaster's `data`, and a TransactionError object. The store and the adapter map a retired v1 wallet's failure to `V1WalletRetiredError` with this predicate, so these now reach the app as `V1WalletRetiredError` instead of a raw `PaymasterError`, and an error that already is one is no longer wrapped again.
  - The `Paymaster` no longer retries a 4018. 3.2.1 sent it three times, 1 s and 2 s apart, though a retired v1 program answers every attempt the same way. It now fails on the first answer, as mobile does, with `V1WalletRetiredError` when the 4018 is the retired v1 program's: the logs name v1, or the paymaster is a v1 wallet's (`new Paymaster(config, { protocolVersion: 1 })`, which the store and the adapter pass). A 4018 whose program it cannot tell is thrown as the `PaymasterError`, and the store and the adapter map it by the wallet's protocol. After an earlier attempt whose answer was lost it stays a `PaymasterError` with `maybeSent`.
  - The README says which error classes have no predicate: compare `error.name` for those.

## 3.2.1

### Patch Changes

- [#104](https://github.com/lazor-kit/lazor-kit/pull/104) [`6a00a27`](https://github.com/lazor-kit/lazor-kit/commit/6a00a27b5f35a215aa87699175a97f92aec1b612) Thanks [@onspeedhp](https://github.com/onspeedhp)! - An inner program's 3014 is no longer reported as `DeferredExpiredError`, and `isDeferredExpiredError` is true for every `DeferredExpiredError`

  3.2.0 reported a 3014 from TX2 as an expired authorization unless a re-read of the DeferredExec account showed it still open. When that read failed, or the wallet's RPC node did not have the account yet (an `executeDeferred` on another device just after TX1), an inner program's 3014 (Anchor's `AccountNotAssociatedTokenAccount`, in the swaps the deferred flow exists for) became `DeferredExpiredError`: the user was told to approve again, and every retry spent another approval and another rent deposit and failed the same way. The re-read was also made at `confirmed`, which trails the bank a paymaster simulates on, so a real expiry at the window's edge came back as a plain `PaymasterError` without TX1's signature or the account.

  - A 3014 is `DeferredExpiredError` only when it is established: its logs name LazorKit as the first program to fail, it landed on chain after `expires_at` (the program checks the slot before any inner instruction runs, and returns 3014 nowhere else), or the chain is past `expires_at` when the account is read again, now at `processed`. Otherwise the error is thrown as it came.
  - Any error from sending TX2 carries `deferredExecPda`, `authorizeSignature` (when the call sent TX1) and `expiresAtSlot` (when it was read). New type export: `DeferredFailureContext`.
  - `isDeferredExpiredError` is true for any `DeferredExpiredError`, including the one thrown before sending (it was false) and one from another copy of the package (by `name` and `code`). For a raw 3014 it is true only when the logs name LazorKit as the first program to fail; a 3014 that names no program is no longer claimed.
  - The README says the window is also how long an unused approval stays executable (nothing cancels it before it expires).

## 3.2.0

### Minor Changes

- [#102](https://github.com/lazor-kit/lazor-kit/pull/102) [`8e33d7d`](https://github.com/lazor-kit/lazor-kit/commit/8e33d7df91b6f1e8774bc740742ec0ab473f21e1) Thanks [@onspeedhp](https://github.com/onspeedhp)! - A deferred execution's window now outlasts the wallet's own wait for TX1, and an expired one is reported as `DeferredExpiredError`

  `authorizeAndExecute` authorized TX2 for the SDK's default of 300 slots, but it waits up to two minutes for TX1 to be confirmed before sending TX2. At devnet's 230 ms a slot, 300 slots is about 69 s. After a slow confirmation, TX1 landed and used the passkey's counter, its DeferredExec account kept the paymaster's rent, and TX2 failed with a generic `PaymasterError` (3014) that carried neither TX1's signature nor the account. The paymaster request was also retried three times.

  - `authorizeAndExecute` and `authorizeDeferred` now authorize `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500) slots by default, and take `expiryOffset` (10 to 9000; other values throw a `RangeError` before the prompt).
  - Before TX2 is sent (`authorizeAndExecute`, `executeDeferred`), the authorization's `expires_at` is read. One that has expired is not sent. A 3014 from the paymaster or the chain is checked against the account and rejects with `DeferredExpiredError`: `authorizeSignature`, `deferredExecPda`, `expiresAtSlot`. The `Paymaster` no longer retries a 3014.
  - New exports: `DeferredExpiredError`, `isDeferredExpiredError`, `DEFERRED_EXPIRED_CODE`, `MIN_DEFERRED_EXPIRY_SLOTS`, `MAX_DEFERRED_EXPIRY_SLOTS`, and the `DeferredTxPayload` type.

## 3.1.0

### Minor Changes

- [#100](https://github.com/lazor-kit/lazor-kit/pull/100) [`d40a197`](https://github.com/lazor-kit/lazor-kit/commit/d40a1979d2b4191cf03e87f357131e8009d4f5d9) Thanks [@onspeedhp](https://github.com/onspeedhp)! - An existing passkey with no wallet can now connect: the wallet is created for the passkey's real key, recovered from two of its signatures

  Every passkey starts without a LazorKit v2 wallet. Signing in never reveals a passkey's public key, so the portal reports one from its own storage: none for a passkey made on another device or browser, and sometimes another passkey's. `connect` would not create a wallet for a key it could not verify, because such a wallet can never sign. Instead it failed with "The portal reported a public key this passkey does not hold, so no wallet was created", or "signing in with an existing passkey does not reveal its public key". Those passkeys could never get a wallet.

  - When the reported key is missing or is not the signer's, `connect` now recovers the passkey's key from two of its signatures over challenges the SDK chose (`resolvePasskeyPublicKey`, `@lazorkit/sdk-legacy` 1.3.0). The signatures are the connect proof and the connect reply's own signature, or one more portal sign when the reply has none. That is one extra passkey prompt (a sign over a random challenge, with no transaction). The wallet is created for the recovered key. The same applies to `useWallet().connect` and `LazorkitWalletAdapter`.
  - Unchanged: a passkey the portal registered just now uses the key it reports. A reported key that the connect proof verifies against is used with no extra prompt. Wallet lookup, adoption and the chooser work as before.
  - A wallet is still never created for a key that no signature from this connect verifies against. If the user closes the extra prompt, `connect` rejects with `PortalCancelledError`. If the signatures do not settle on one key, it throws an error that says so. In both cases nothing is created.
  - The recovered key must also belong to the passkey the wallet is created under, the one the connect reply names. Either the connect reply's own signature is one of the two, or the portal's sign replies name that passkey. The portal signs with the passkey the SDK asks for (its only `allowCredentials` entry) and names it back, and sign results now carry that name as `SignResult.credentialId`. When a wallet is to be created, a sign reply that names another passkey fails `connect`, whatever key the portal reported; wallet lookup and adoption do not check it. Before, if a portal reported another passkey's key and also signed with that other passkey, `connect` created a wallet under this passkey that this passkey could never sign for. Recovery also fails when nothing ties the key to the passkey: no connect signature, and sign replies that name no passkey. Nothing is created in either case.
  - Requires `@lazorkit/sdk-legacy` ^1.3.0.

  Passkey transactions back to back no longer fail with SignatureReused (3006), and every send resolves once its transaction is confirmed

  A passkey signature commits to the passkey's counter, read before the prompt opens. A send resolved as soon as the paymaster answered, and a relayer that answers once the RPC accepted a transaction (the devnet playground's, or Kora with `respond_after` "sent") answers before the transaction has run. The next signature then read the counter the first was about to use, and failed after the user approved it (`custom program error: 0xbbe`).

  - `signAndSendTransaction`, `authorizeAndExecute`, `authorizeDeferred`, `executeDeferred`, the session and authority sends, `LazorkitWalletAdapter.sendTransaction` and the Wallet Standard `signAndSendTransaction` now resolve once the transaction is confirmed. They reject with `TransactionFailedError` when it failed on chain (before, its signature was returned as if it had landed), `TransactionExpiredError` when it did not land before its blockhash expired, and `TransactionOutcomeUnknownError` when that cannot be told (`ConfirmationTimeoutError`, after two minutes, while it may still land). Kora confirms before it answers by default, so there this costs one status read.
  - Signatures for one passkey are prepared one at a time, even when a dApp sends several at once or uses the store and the adapter together. Each reads the counter at `confirmed` from an RPC node that has executed that passkey's previous transaction (`minContextSlot`, `@lazorkit/sdk-legacy` 1.3.0). A load-balanced node that is behind answers "not there yet" and is retried, instead of serving the spent counter.
  - `authorizeAndExecute` sends ExecuteDeferred only after Authorize is confirmed.
  - A 3006 is no longer retried (the paymaster call resent the same bytes three times). It throws `SignatureReusedError`, and no new prompt opens on its own. It is left for the same passkey signing somewhere else at the same moment.
  - A landed transaction is no longer reported as expired. "Did not land" is concluded only from an RPC node past the slot where its blockhash expired, in its transaction history: a node's status cache forgets a signature a few minutes after it landed, and a load-balanced node can be behind. When it cannot be told (no history, or no answer), the call rejects with `TransactionOutcomeUnknownError`, and the passkey's next signature is still read from a node past that slot.
  - When the paymaster's answer is lost after it may have sent the transaction (a network error, a timeout, a 5xx, or a resend that finds the same bytes already processed), the call rejects with `TransactionOutcomeUnknownError` instead of a plain error, and the passkey's next signature waits until that transaction can no longer land. A signature the paymaster reports along with its error (the devnet relayer's `data.signature`) is followed to its outcome, not resent. Paymaster failures are `PaymasterError`, with the JSON-RPC `code` and `data`.
  - A call made while the passkey's previous transaction still has no known outcome rejects with `PreviousTransactionPendingError`, having signed and sent nothing, instead of the previous call's error.
  - Status reads and paymaster requests are bounded in time, so a request that never answers no longer holds the passkey's queue.
  - The slot floor, and a send whose outcome is not known yet, are kept in localStorage (the slot for ten minutes), so a reload or another tab of the app reads its first challenge from a node that has the previous transaction.
  - A 3006 that came from an inner program (Anchor's `AccountNotMutable`) is reported as that failure, not `SignatureReusedError`: the wallet reads the logs of a failure on chain, and simulates a paymaster rejection that came without them.
  - A preview over 1232 bytes no longer throws "encoding overruns Uint8Array" before the prompt: such a preview is compiled with the lookup tables the transaction is sent with (`transactionOptions.addressLookupTableAccounts`, or a dApp v0 transaction's own). A preview that fits without them is still compiled without them, so the portal sees every account the transaction touches.
  - `LazorkitWalletAdapter` now resolves the accounts a dApp's v0 transaction loads from its lookup tables. Before, such a transaction (a Jupiter swap through the Wallet Standard) could not be signed.

## 3.0.2

### Patch Changes

- [#98](https://github.com/lazor-kit/lazor-kit/pull/98) [`85080e0`](https://github.com/lazor-kit/lazor-kit/commit/85080e0724930510ee7ff450cbf60f66c6944323) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Fix the wallet-adapter reading the chain up to 15 seconds behind, and connect and signing throwing in apps with no global `Buffer`

  - **`LazorkitWalletAdapter` (and `registerLazorkitWallet`, which wraps it) now reads at `confirmed`, like `LazorkitProvider` and `useWallet`.** Its `Connection` was created without a commitment, so it read at the RPC default, `finalized`, some 13 to 15 seconds behind. That covered the wallet lookup on connect, and the wallet, passkey key and counter read before `sendTransaction`. Within that window after a transaction:
    - A second `sendTransaction` signed over the counter the first had already used. It failed on chain with `SignatureReused` (`custom program error: 0xbbe`) after the user had approved the passkey prompt.
    - A new user's first `sendTransaction` failed with "The connected wallet no longer lists this passkey".
    - A disconnect and reconnect did not see the wallet the adapter had just created, and created a second wallet for the same passkey.
  - **No global `Buffer` is needed.** `getCredentialHash`, the decoding of the passkey key the portal reports on connect, and `useWallet().verifyMessage` used the global `Buffer` instead of the `buffer` package the rest of the SDK imports. An app without a `Buffer` polyfill got `ReferenceError: Buffer is not defined` when connecting a passkey and on every transaction it signs.

## 3.0.1

### Patch Changes

- [#96](https://github.com/lazor-kit/lazor-kit/pull/96) [`b98f9e4`](https://github.com/lazor-kit/lazor-kit/commit/b98f9e4ddf0a9d2205fac8f28568f28ed18a27dd) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Declare `@solana/web3.js` ^1.99.0 as the peer range, the floor the wallet's own peer set already needs: `@solana/wallet-adapter-base` ^0.9.27 now resolves to 0.9.28, which requires `@solana/web3.js` ^1.99.0. An app that pins `@solana/web3.js` 1.98.x gets `npm ERESOLVE` installing the wallet either way. Move it to 1.99 (a minor release of 1.x), or install `@solana/wallet-adapter-base` 0.9.27 explicitly. Apps on a `^1.98` range resolve to 1.99 and are unaffected.

## 3.0.0

### Major Changes

- [#87](https://github.com/lazor-kit/lazor-kit/pull/87) [`29a476d`](https://github.com/lazor-kit/lazor-kit/commit/29a476d4eb887fccf2589a8a230521e049a31322) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Speak protocol v2, by depending on `@lazorkit/sdk-legacy` 1.x instead of a vendored copy of it

  Both packages carried their own fork of the protocol layer, and the two forks were byte-identical to each other in 11 files. Under protocol v2 they were wrong in six independent ways, any one of which is fatal: un-namespaced PDA seeds, an accounts hash that does not bind signer/writable flags, raw account index bytes with no forward-signer bit, an `AddAuthority` payload with no `[policy_len][policy]` field, a read-only wallet account on Owner changes, and an optional protocol-fee suffix the program now requires. A seventh, `readAuthorityPubkey` pinned to the v1 account discriminator, would have broken every passkey signature.

  Rather than reproduce that diff twice by hand, both packages now delegate to `@lazorkit/sdk-legacy` 1.x, which is the implementation the protocol repo's validator suites cover. A thin compatibility layer keeps the call shape these packages have always had, where `programId` is optional and defaults to `PROGRAM_ID`.

  **v1 and v2 side by side.** LazorKit v2 runs at its own program id (`LazorFroiVuAjcwwQ2me83vTr5nc5NRxSaTg3pmEXC8` on mainnet); v1 keeps `LazorjRF…` until it is retired to a binary that only lets wallets migrate out. Apps have users on both, so this release routes by the wallet rather than by a global program id:

  - `connect` finds the passkey's own wallet on either protocol. A user who signed up before v2 keeps their v1 wallet and everything works as before; only a passkey that owns neither gets a new wallet, on v2. It never creates a v2 wallet for a v1 user, which would show them an empty account while their funds sit in the v1 one.
  - **"Own" is proven, not looked up.** The credential-id hash is public and `CreateWallet`/`AddAuthority` take any owner without consent, so anyone can make a wallet that lists a victim's passkey. `connect` uses a wallet on its own only when the passkey is proven to hold its key and nothing untrusted can spend from it; any other wallet the passkey holds is offered to the user to confirm. See the wallet-confirmation changeset for the rule and the chooser. A v1 wallet gets no precedence of its own: when exactly one wallet has been signed for by the passkey and nothing untrusted can spend from it, that one is used, v1 or v2, and no other is offered — not even a v1 wallet the passkey never signed from. When the user is asked, the wallets signed for are listed first, and only among wallets equally signed for (or not) does a v1 wallet come before a v2 one (it has not been migrated, so its funds are there).
  - Portal replies are accepted only from the portal's exact origin and the dialog the SDK opened (web), and only on the redirect URL asked for (mobile).
  - A stored v1 wallet that has since been migrated is dropped on the next `connect` (and actions on it fail with `V1WalletMigratedError`), so the app stops showing a closed address.
  - Every action — sign, sessions, authorities, deferred execution — uses the client for the wallet's protocol. The v1 client is `@lazorkit/sdk-legacy` 0.3.2, the SDK those wallets were made with, installed under the alias `lazorkit-sdk-v1`. Flows that start from an account (a stored session or authority key, a deferred payload) read the protocol from its owner.
  - `WalletInfo.protocolVersion` (1 | 2) is stored on connect; a wallet saved by an earlier release has none and is treated as v1. `useWallet()` exposes it as `protocolVersion`.
  - New `v1PaymasterConfig` (web) / `v1ConfigPaymaster` (mobile): the relayer for v1 wallets — the one the app used before v2. It defaults to the main paymaster, which is only right if that relayer still sponsors v1: **LazorKit's v2 relayer does not** (a relayer sponsoring the full v1 program can have its fee payer pulled into a v1 transaction's inner calls). An app with v1 users that points `paymasterConfig` at a v2 relayer must set it.
  - New `cluster` option, for an RPC URL that does not say which cluster it serves. Without it the cluster is read from the URL, and anything unrecognised is mainnet, as before.
  - Once v1 is retired, a v1 wallet's actions fail with `V1WalletRetiredError` (code 4018) instead of a bare program error. The wallet is safe; it has to be moved with `LazorKitClient.migrateV1Wallet` (sdk-legacy ≥ 1.2.0) or the migration page.
  - Every action acts on the stored wallet rather than the first one listing the passkey.
  - Adding a key to a **v1** wallet requires `unrestricted: true` and refuses a `policy`: v1 has no spending policies and never checked rank at Execute, so any added key could spend the whole vault.

  Breaking, beyond the protocol change itself:

  - `PROGRAM_ID` / `PROGRAM_ADDRESS` are now the v2 mainnet id, and the client no longer defaults to it: without an explicit id it picks the v2 program for the RPC's cluster.
  - The exported PDA helpers (`findVaultPda`, `findWalletPda`, …) derive **v2** addresses at the mainnet id unless given a program id. They are wrong for a v1 wallet: never derive a user's address with them. Use `WalletInfo.vaultPda` — or `useWallet().vaultPubkey` on web, `smartWalletPubkey` on mobile — which is always the right vault for the wallet's protocol (wallets stored without it are backfilled on connect).
  - The web wallet-adapter's `publicKey` is now the **vault**, where funds live and the account that signs. It used to be the wallet PDA, an internal account nothing can spend from.
  - The low-level `create*Ix` builders, `appendProtocolFeeAccounts` and `readAuthorityState` are no longer part of the public surface. The client methods replace them; `readAuthorityState` is now `readAuthorityCounter` plus `readAuthorityPubkey`.
  - `addAuthority` with `ROLE_SPENDER` (Delegate) on a v2 wallet requires a `policy`. Both packages' `AddAuthorityPayload` gained the field.
  - **`createSession` now refuses to mint an unbounded session by accident.** Passing no spending limits used to produce a session key that can spend the whole vault through any program until it expires, silently. It now throws unless the caller passes limits, or says `unrestricted: true`. This is the one behaviour change here that is not forced by the protocol, and a major release is the moment to make it.

- [#87](https://github.com/lazor-kit/lazor-kit/pull/87) [`26905d0`](https://github.com/lazor-kit/lazor-kit/commit/26905d06ace232c61a629342dcb700e3538f1e04) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Ask the user which wallet is theirs instead of guessing, and stop hanging when the portal is closed

  A passkey's credential-id hash is public, and `CreateWallet` / `AddAuthority` / `TransferOwnership` take any owner without that owner's consent. So a wallet found by the hash, even one the passkey is proven to hold, may be one someone else planted: listed beside their own key, or handed over after they kept a way into its vault that does not show on chain. `connect` now builds on `@lazorkit/sdk-legacy`'s ownership rule (`findPasskeyWalletCandidates`, `verifyOwnershipProof`, `describeWalletCandidates`, `pickOwnWallet`) and uses a wallet on its own only when it is **the one wallet this passkey has signed for, with nothing untrusted able to spend from it** (no other authority, live session, pending deferred transaction or token approval, and a vault still owned by the System Program). Everything else goes to the user.

  - **`onConfirmWallet`** (web `LazorkitProvider` and `LazorkitWalletAdapter` / `registerLazorkitWallet` config; mobile `LazorKitProvider`; per call on `connect`): `'builtin'` (default) shows the SDK's "Which wallet is yours?" chooser; a function shows your own UI and returns `{ wallet }` or `null`; `'throw'` makes `connect` throw `WalletNeedsConfirmationError` with `candidates: WalletChoice[]`, and `connect({ confirmWallet })` within 2 minutes adopts the chosen one without a second passkey prompt. `registerLazorkitWallet` rejects `'throw'`: `standard:connect` cannot carry a `confirmWallet`, so the user could never finish.
  - **`confirmWallet`** accepts the vault or the wallet PDA. One that names no wallet the passkey is proven to hold throws an error naming it; it is never ignored. After a `'throw'`, one that names none of the offered wallets throws at once, without the portal, and the offer stays open.
  - **`trustedAuthorities`**: your own Ed25519 keys (base58). An authority, session or token approval held by one of them does not stop a wallet from being used on its own. Passkeys, pending deferred transactions and a vault handed to another program are never trusted.
  - **`watchMints`**: your app's SPL Token mints, checked on top of wSOL, USDC, USDT and devnet USDC for a vault token account handed to someone else.
  - New exports: `WalletChoice`, `ConfirmWalletRequest`, `ConfirmWalletHandler`, `OnConfirmWallet`, `WalletConfirmationDeclinedError` (the user chose none; nothing is saved), `PortalCancelledError`; on mobile also `WalletChooser` and `WalletChooserNotShownError`; and sdk-legacy's `createOwnershipChallenge`, `verifyOwnershipProof`, `pickOwnWallet`, `selectWalletByAddress` with their types.
  - The chooser lists each wallet by its vault address and balance, marks a v1 wallet "Legacy (v1)" and a wallet never signed for "Not used with this passkey yet", and lists everything untrusted that can spend from it. A vault handed to another program is a warning of its own and cannot be chosen there. Nothing is pre-selected and no row is called safe; "None of these" declines and never creates a wallet. Web draws it in the portal dialog's frame (keyboard accessible, light and dark); mobile renders it as a `Modal` from `LazorKitProvider` (Android back declines).
  - A user's own wallet is confirmed once before its first transaction, as is a wallet made on the migration page, and whenever the passkey has signed for two wallets (a signature can be replayed onto a planted copy). A wallet `connect` just created is saved as it is.
  - The portal connect URL carries a `challenge`; a portal that answers with an assertion over it saves the separate proof prompt. Web trusts a reply saying the passkey was just created (`kind: 'created'`) for creation; mobile, where a deep link can be forged, always proves.
  - If the chain cannot be read, `connect` fails; it never takes that as "no wallet" and creates one. A malformed `trustedAuthorities` or `watchMints` entry fails every fresh connect, on both platforms, not only a returning user's.

  Portal fixes:

  - Closing the portal — web: the dialog's X, Escape, a click outside, or the popup; mobile: dismissing the browser (iOS) or returning to the app without an answer (Android) — rejects the pending action at once with `PortalCancelledError`, instead of after the 60-second timeout. On web a text selection dragged out of the dialog (the vault address, say) no longer counts as a click outside.
  - `disconnect` during a `connect` rejects that connect with `PortalCancelledError`; it no longer saves or connects a wallet after the user disconnected, remembers its candidates, or blocks a new `connect` with "Already connecting". Web also closes its portal or chooser; mobile closes its chooser. The web wallet-adapter runs one connect at a time: a second call waits for the first instead of opening another portal whose wallet would replace the first's.
  - Mobile, iOS: the built-in chooser cannot appear over another modal the app has open (a `<Modal>`, or a modal screen). `connect` then rejects with the new `WalletChooserNotShownError` after a few seconds instead of waiting forever; the new `<WalletChooser />` export can be rendered inside that modal, and draws there instead of the provider's.
  - The portal's own error text is surfaced: web shows it instead of "Portal error", and mobile reads the portal's `error` redirect parameter and rejects with it.
  - Mobile: a signing action always rejects on failure; it no longer resolves `undefined`.
  - Web: the wallet-adapter creates a new user's wallet again, and `sendTransaction` without lookup tables sends again. Both built a legacy transaction with no fee payer or recent blockhash, so it could not be serialized for the paymaster.

  Breaking:

  - `findOwnedCandidates`, `provenCandidates`, `chooseOwnWallet` and `OwnedCandidate` are removed; `OwnershipProof` now comes from `@lazorkit/sdk-legacy`.
  - `WalletNeedsConfirmationError` is thrown only with `onConfirmWallet: 'throw'`, and its shape changed: `credentialId` and `candidates: WalletChoice[]` (vault, balance, signature count and everything else that can spend), instead of counts.
  - With the default, `connect` shows the chooser where it used to adopt a wallet silently (a wallet never signed for) or throw.
  - Web: while a wallet is connected, `connect({ confirmWallet })` naming a different wallet throws instead of returning the connected one. The wallet-adapter clears its `confirmWallet` property once a wallet is connected, and on disconnect.
  - Mobile: while a wallet is connected, `connect` returns it instead of opening the portal again and replacing it with whatever that run found, as on web; `confirmWallet` naming a different wallet throws. Disconnect first to connect another passkey's wallet. A stored v1 wallet that has since been migrated is dropped and `connect` runs afresh.
