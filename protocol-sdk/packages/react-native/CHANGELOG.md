# @lazorkit/wallet-mobile-adapter

## 2.4.0

### Minor Changes

- [#117](https://github.com/lazor-kit/lazor-kit/pull/117) [`5c94fa6`](https://github.com/lazor-kit/lazor-kit/commit/5c94fa69b80a018ccd52155b113d076298663bbe) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Typed errors for a session send that moves an asset its actions do not name**

  LazorKit v2's next program release bounds what a session (or a delegate key) may move by what its actions name, and nothing else: with no `Actions.sol*` action the wallet's SOL may not fall, rent for a new account included (`ActionUnlistedSolOutflow`, 3037), and a token may leave only when an `Actions.token*` action names its mint (`ActionUnlistedTokenOutflow`, 3038). A session whose actions name SOL only will move no token: name each mint it spends. Until that release an asset the actions do not name is not bounded at all: a session with token actions only can spend all the wallet's SOL. A session's actions (and a delegate's policy) must also fit in the transaction beside the passkey's response: keep them within 244 bytes (see the README).

  - New: `UnlistedSolOutflowError` ("This session is not allowed to spend SOL") and `UnlistedTokenOutflowError` ("This session is not allowed to spend this token"), which `signAndSendWithSession` rejects with for a 3037 / 3038, with the original error as `cause`. A send whose outcome is unknown (a 5xx answer carrying the refusal, say) stays `TransactionOutcomeUnknownError`. `isUnlistedSolOutflowError` / `isUnlistedTokenOutflowError` recognise them from either copy of the package, wrapped, or raw; `UNLISTED_SOL_OUTFLOW_CODE`, `UNLISTED_TOKEN_OUTFLOW_CODE`.
  - `ERROR_NAMES` / `errorFromCode` name 3036 (`SessionNotExpired`), 3037, 3038 and 4018 (`RetiredDeployment`).

  See the README, "What a session's actions bound".

## 2.3.1

### Patch Changes

- [#113](https://github.com/lazor-kit/lazor-kit/pull/113) [`704ba51`](https://github.com/lazor-kit/lazor-kit/commit/704ba511e36fb45df20deaa08379747553f7cc34) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Security:** domain-separated passkey challenges for messages and ownership proofs

  Message signatures are now domain-separated from every other passkey challenge. `signMessage` signs a fixed-format challenge, never the app's bytes, the same as `@lazorkit/wallet`'s:

  ```
  challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"   (58 bytes)
  ```

  Connect's ownership proofs get their own tag too: `UTF-8 "LazorKit ownership proof v1" || 32 random bytes` (59 bytes), from `createOwnershipChallenge()`. `verifyOwnershipProof` accepts it unchanged. A transaction challenge is a 32-byte hash, so no challenge of one kind can be another.

  - The portal gets the message challenge as `message` and the text as `displayMessage`. The adapter refuses a redirect over any other challenge.
  - `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs.
  - New: `verifyWalletMessage` checks that a wallet signed a message, with the passkey's key read from the chain, never taken from the client. `verifySignedMessage` is its offline part, for a key you read from chain yourself. Also `signedMessageChallenge`, `SIGNED_MESSAGE_DOMAIN` and `OWNERSHIP_PROOF_DOMAIN`.
  - Fixes `signMessage` signing the base64 decoding of the text instead of the text.

  A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).

## 2.3.0

### Minor Changes

- [#110](https://github.com/lazor-kit/lazor-kit/pull/110) [`75128cb`](https://github.com/lazor-kit/lazor-kit/commit/75128cb3e752d35b0511cf5e6e6645b7ca441754) Thanks [@onspeedhp](https://github.com/onspeedhp)! - **Breaking:** `addAuthorityEd25519` has no default role any more: `role` is required

  2.2.1 gave a key added without a `role` the delegate rank (`ROLE_SPENDER`), which v2 accepts only with a `policy`.

  - `role` is required in the types (`AddAuthorityPayload.role: number`, on `useWallet()` and on the store): a call without it does not compile.
  - At runtime, a missing role, or one that is not `ROLE_OWNER` (0), `ROLE_ADMIN` (1) or `ROLE_SPENDER` (2), is refused before anything is read or the portal opens: the call rejects (and calls `onFail`, and sets `error`) with an error that says what each rank may do and suggests `ROLE_SPENDER` with a policy for a key the app holds. The same rule as `@lazorkit/wallet` 3.3.0's `addAuthority`.
  - `ROLE_OWNER` on a v2 wallet is refused the same way, before anything is read or the portal opens: the protocol SDK adds an Owner only on an explicit opt-in this method does not pass, so 2.2.1 failed there too, after reading the chain. The error names `ROLE_ADMIN` and `ROLE_SPENDER`. On a v1 wallet `ROLE_OWNER` is accepted, as before.

  A breaking change in a minor release, deliberately, as for the web SDK: protocol v2 is not live on mainnet yet, and making the rank explicit is the point. Every `addAuthorityEd25519` call that compiles against this release adds the same authority 2.2.1 did.

  **Migration:** pass the role you relied on: `addAuthorityEd25519({ newEd25519Pubkey, role: ROLE_SPENDER, policy }, options)` keeps 2.2.1's behaviour.

### Patch Changes

- [#109](https://github.com/lazor-kit/lazor-kit/pull/109) [`91ae852`](https://github.com/lazor-kit/lazor-kit/commit/91ae85245c4bb72bba89e4f732d935961c1ca9ed) Thanks [@onspeedhp](https://github.com/onspeedhp)! - `connect` and `disconnect` honour their callbacks on the store too, and `transferSol` reports a refusal to `onFail`

  The adapter's callback contract (callbacks run once `isSigning` is `false`, right before the promise settles, or at once for a call refused because another is running; what they throw changes nothing) now covers every entry point:

  - `store.connect({ onSuccess, onFail })` calls them, once `isConnecting` is `false`; 2.2.1 ignored them. `useWallet().connect` passes them through, so they run once, and a throwing `onSuccess` no longer rejects a connect that succeeded or calls `onFail`. A refusal ("Already connecting") calls `onFail` at once, while the running connect still holds `isConnecting`.
  - `disconnect(options?)` on the store takes `onSuccess` / `onFail`, and `useWallet().disconnect` passes them through: a throwing `onSuccess` no longer rejects it.
  - `transferSol` with no wallet connected calls `onFail` and sets `error`, as every other action does; 2.2.1 rejected without either.

- [#109](https://github.com/lazor-kit/lazor-kit/pull/109) [`878bb2a`](https://github.com/lazor-kit/lazor-kit/commit/878bb2ac6adb35cd34b1c075a2fd60a1970fcc6c) Thanks [@onspeedhp](https://github.com/onspeedhp)! - `isSignatureReusedError` and `isRetiredDeploymentError` are true for the adapter's own errors, and every `is*Error` predicate reads through wrapped errors

  2.2.1 checked only an error's text, so `isSignatureReusedError(new SignatureReusedError())` and `isRetiredDeploymentError(new V1WalletRetiredError())` were `false` (the bug 2.2.1 fixed in `isDeferredExpiredError`).

  - `isSignatureReusedError`, `isRetiredDeploymentError` and `isDeferredExpiredError` are true for `SignatureReusedError`, `V1WalletRetiredError` and `DeferredExpiredError`, including one from another copy of the package (matched by `name` and `code`).
  - They read through what wraps an error: `cause`, and the `error` of a wallet-adapter `WalletError`.
  - For a raw error they read the message, the logs, a paymaster's `data` and a TransactionError, in the error and in its causes. The documented rules for raw errors are unchanged: a 3006 with no logs counts as LazorKit's, and a 3014 with no logs does not.
  - `isRetiredDeploymentError` also accepts Kora's `Custom(4018)` text, a 4018 whose logs are only in the paymaster's `data`, and a TransactionError object. Actions map a retired v1 wallet's failure to `V1WalletRetiredError` with this predicate, so these now reach the app as `V1WalletRetiredError` instead of a raw `PaymasterError`.
  - The README says which error classes have no predicate: compare `error.name` for those.

- [#110](https://github.com/lazor-kit/lazor-kit/pull/110) [`ed6ef1e`](https://github.com/lazor-kit/lazor-kit/commit/ed6ef1e732d925c1452fcdbac0fc2810ca965d9a) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Docs: the adapter stores no session key, and how to keep one

  No runtime change. The adapter never generated or stored a session key: `createSession` registers the public key your app passes, `signAndSendWithSession` signs with the `Keypair` you hand it, and AsyncStorage holds only the wallet's public record, the configuration and each passkey's transaction state. A new test checks that nothing the adapter persists holds a session key's secret.

  - README, new section "Session keys": keep the key in the OS keystore with `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in AsyncStorage; keep the wallet it belongs to with it and use it only while that wallet is connected; delete it once its session is revoked or expired, and at disconnect; an iOS Keychain item survives an uninstall; exclude it from Android Auto Backup.
  - The JSDoc of `SessionSignPayload.sessionKeypair` and `CreateSessionPayload.sessionKey` says the same.

  Patch: README and type documentation only, published so that integrators see them in the package.

## 2.2.1

### Patch Changes

- [#104](https://github.com/lazor-kit/lazor-kit/pull/104) [`6a00a27`](https://github.com/lazor-kit/lazor-kit/commit/6a00a27b5f35a215aa87699175a97f92aec1b612) Thanks [@onspeedhp](https://github.com/onspeedhp)! - An inner program's 3014 is no longer reported as `DeferredExpiredError`, and `isDeferredExpiredError` is true for every `DeferredExpiredError`

  2.2.0 reported a 3014 from TX2 as an expired authorization unless a re-read of the DeferredExec account showed it still open. When that read failed, or the RPC node did not have the account yet, an inner program's 3014 (Anchor's `AccountNotAssociatedTokenAccount`) became `DeferredExpiredError`, and the user was told to approve again for a failure that would repeat. The re-read was also made at `confirmed`, which trails the bank a paymaster simulates on, so a real expiry at the window's edge came back as a plain `PaymasterError`.

  - A 3014 is `DeferredExpiredError` only when it is established: its logs name LazorKit as the first program to fail, it landed on chain after `expires_at`, or the chain is past `expires_at` when the account is read again, now at `processed`. Otherwise the error is thrown as it came.
  - Any error from sending TX2 carries `deferredExecPda`, `authorizeSignature` (when the call sent TX1) and `expiresAtSlot` (when it was read). New type export: `DeferredFailureContext`.
  - `isDeferredExpiredError` is true for any `DeferredExpiredError`, including the one thrown before sending (it was false) and one from another copy of the package. For a raw 3014 it is true only when the logs name LazorKit as the first program to fail.
  - The README says the window is also how long an unused approval stays executable (nothing cancels it before it expires).

## 2.2.0

### Minor Changes

- [#102](https://github.com/lazor-kit/lazor-kit/pull/102) [`8e33d7d`](https://github.com/lazor-kit/lazor-kit/commit/8e33d7df91b6f1e8774bc740742ec0ab473f21e1) Thanks [@onspeedhp](https://github.com/onspeedhp)! - A deferred execution's window now outlasts the adapter's own wait for TX1, and an expired one is reported as `DeferredExpiredError`

  - `authorizeAndExecute` and `authorizeDeferred` authorized the SDK's default of 300 slots (documented as "~2 min"), while the adapter waits up to two minutes for TX1 before sending TX2. At devnet's 230 ms a slot, 300 slots is about 69 s: after a slow confirmation, TX1 used the passkey's counter, its DeferredExec account kept the paymaster's rent, and TX2 failed with a `PaymasterError` (3014). The default is now `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500), and `expiryOffset` must be 10 to 9000 (otherwise a `RangeError` before the portal opens).
  - Before TX2 is sent (`authorizeAndExecute`, `executeDeferred`), the authorization's `expires_at` is read. One that has expired is not sent. A 3014 from the paymaster or the chain is checked against the account and rejects with `DeferredExpiredError`: `authorizeSignature`, `deferredExecPda` (pass it to `reclaimDeferred`), `expiresAtSlot`.
  - New exports: `DeferredExpiredError`, `isDeferredExpiredError`, `DEFERRED_EXPIRED_CODE`, `MIN_DEFERRED_EXPIRY_SLOTS`, `MAX_DEFERRED_EXPIRY_SLOTS`.

### Patch Changes

- [#102](https://github.com/lazor-kit/lazor-kit/pull/102) [`c5c2fb5`](https://github.com/lazor-kit/lazor-kit/commit/c5c2fb5d35154f522e4fa4caab564e70047bd0ac) Thanks [@onspeedhp](https://github.com/onspeedhp)! - Two sends in a row (`await send(a); await send(b)`) both run, and so does a send made from `onSuccess`

  `signAndSendTransaction`, `signMessage` and `transferSol` resolved from inside `onSuccess`, before `isSigning` was cleared, so the call on the next line was refused with `SigningError` ("Another passkey request is still in progress") and nothing was sent. Every action ran its `onSuccess` or `onFail` before clearing the flag, so a call made from a callback was refused the same way.

  - Every action's promise now settles, and its `onSuccess` or `onFail` runs, once `isSigning` is `false` again. A callback that throws is logged and does not change the outcome.
  - The store's `signAndExecuteTransaction`, `signMessage` and `transferSol` now resolve with their result instead of `undefined`, and the hook returns those promises.
  - A call made while another is still running is refused with `SigningError`, as before.

## 2.1.0

### Minor Changes

- [#100](https://github.com/lazor-kit/lazor-kit/pull/100) [`d40a197`](https://github.com/lazor-kit/lazor-kit/commit/d40a1979d2b4191cf03e87f357131e8009d4f5d9) Thanks [@onspeedhp](https://github.com/onspeedhp)! - An existing passkey with no wallet can now connect: the wallet is created for the passkey's real key, recovered from two of its signatures. Also accepts `expo-web-browser` 15 (Expo SDK 54)

  Every passkey starts without a LazorKit v2 wallet. Signing in never reveals a passkey's public key, so the portal's reply carries the key it has stored: none for a passkey made on another device, and sometimes another passkey's. `connect` refused to create a wallet for a key it could not verify. It failed with "The portal's reply could not be verified against this passkey; nothing was created", or "Unexpected passkey pubkey length: 0" when no key came back. Those passkeys could never get a wallet.

  - When the reported key is missing or is not the signer's, `connect` now recovers the passkey's key from two of its signatures over challenges the SDK chose (`resolvePasskeyPublicKey`, `@lazorkit/sdk-legacy` 1.3.0). The signatures are the connect proof and the connect reply's own signature, or one more portal sign when the reply has none. That is one extra passkey prompt (a sign over a random challenge, with no transaction). The wallet is created for the recovered key, and the saved `passkeyPubkey` is that key rather than the reported one.
  - Unchanged: a reported key that the connect proof verifies against is used with no extra prompt. Wallet lookup, adoption and the chooser work as before.
  - A wallet is still never created for a key that no signature from this connect verifies against. If the user closes the extra prompt, or `disconnect` is called during it, `connect` rejects with `PortalCancelledError`. If the signatures do not settle on one key, it throws an error that says so. In both cases nothing is created.
  - The recovered key must also belong to the passkey the wallet is created under, the one the connect redirect names. Either the connect redirect's own signature is one of the two, or the portal's sign redirects name that passkey. The portal signs with the passkey the SDK asks for (its only `allowCredentials` entry) and names it back in `credentialId`, now also on `BrowserResult`. When a wallet is to be created, a sign redirect that names another passkey fails `connect`, whatever key the connect redirect reported; wallet lookup and adoption do not check it. Before, if a portal reported another passkey's key and also signed with that other passkey, `connect` created a wallet under this passkey that this passkey could never sign for. Recovery also fails when nothing ties the key to the passkey: no connect signature, and sign redirects that name no passkey. Nothing is created in either case.
  - Requires `@lazorkit/sdk-legacy` ^1.3.0.
  - The `expo-web-browser` dependency is now `^14.2.0 || ^15.0.0`, so an Expo SDK 54 app does not install a second copy. The adapter calls only `openAuthSessionAsync`, `openBrowserAsync` and `dismissBrowser`. Their typings and JavaScript are identical in 14.2.0 and 15.0.11.

  Passkey transactions back to back no longer fail with SignatureReused (3006), a transaction that fails on chain rejects, and the deferred flow no longer fails before the portal for payloads over the packet limit

  A passkey signature commits to the passkey's counter, read before the portal opens. The adapter already waited for each transaction (over a websocket), but read the next counter from whichever RPC node answered: a load-balanced node that had not executed the previous transaction yet served the spent counter, and the signature failed after the user approved it (`custom program error: 0xbbe`).

  - Every send now resolves once its transaction is confirmed, polling its status (no websocket). It rejects with `TransactionFailedError` when the transaction failed on chain (before, the wait returned the error and the call resolved as if it had landed), `TransactionExpiredError` when it did not land before its blockhash expired, and `TransactionOutcomeUnknownError` when that cannot be told (`ConfirmationTimeoutError`, after two minutes, while it may still land).
  - Signatures for one passkey are prepared one at a time, and each reads the counter at `confirmed` from an RPC node that has executed that passkey's previous transaction (`minContextSlot`, `@lazorkit/sdk-legacy` 1.3.0). A node that is behind answers "not there yet" and is retried, instead of serving the spent counter. A second request while one is signing still rejects with `SigningError`.
  - A 3006 throws `SignatureReusedError`; the signature is not sent again and no new portal trip opens on its own. It is left for the same passkey signing somewhere else at the same moment.
  - A landed transaction is no longer reported as expired. "Did not land" is concluded only from an RPC node past the slot where its blockhash expired, in its transaction history: a node's status cache forgets a signature a few minutes after it landed, and a load-balanced node can be behind. When it cannot be told (no history, or no answer), the call rejects with `TransactionOutcomeUnknownError`, and the passkey's next signature is still read from a node past that slot.
  - When the paymaster's answer is lost after it may have sent the transaction (a network error, a timeout, a 5xx, or a resend that finds the same bytes already processed), the call rejects with `TransactionOutcomeUnknownError` instead of a plain error, and the passkey's next signature waits until that transaction can no longer land. A signature the paymaster reports along with its error (the devnet relayer's `data.signature`) is followed to its outcome, not resent. Paymaster failures are `PaymasterError`, with the JSON-RPC `code` and `data`.
  - A call made while the passkey's previous transaction still has no known outcome rejects with `PreviousTransactionPendingError`, having signed and sent nothing, instead of the previous call's error.
  - Status reads and paymaster requests are bounded in time, so a request that never answers no longer holds the passkey's queue.
  - The slot floor, and a send whose outcome is not known yet, are kept in AsyncStorage (the slot for ten minutes), so the app, restarted, reads its first challenge from a node that has the previous transaction.
  - A 3006 that came from an inner program (Anchor's `AccountNotMutable`) is reported as that failure, not `SignatureReusedError`: the wallet reads the logs of a failure on chain, and simulates a paymaster rejection that came without them.
  - A portal preview (`signAndSendTransaction`, `authorizeAndExecute`, `authorizeDeferred`) that is over 1232 bytes without lookup tables is compiled with `transactionOptions.addressLookupTableAccounts`. Before, web3.js threw "encoding overruns Uint8Array" before the portal opened, so the deferred flow failed for exactly the payloads it exists for. A preview still over the limit is sent to the portal instead of throwing. A preview that fits without the tables is still compiled without them, so the portal sees every account the transaction touches.

## 2.0.0

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
