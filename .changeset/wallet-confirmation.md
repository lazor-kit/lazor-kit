---
'@lazorkit/wallet': major
'@lazorkit/wallet-mobile-adapter': major
---

Ask the user which wallet is theirs instead of guessing, and stop hanging when the portal is closed

A passkey's credential-id hash is public, and `CreateWallet` / `AddAuthority` / `TransferOwnership` take any owner without that owner's consent. So a wallet found by the hash, even one the passkey is proven to hold, may be one someone else planted: listed beside their own key, or handed over after they kept a way into its vault that does not show on chain. `connect` now builds on `@lazorkit/sdk-legacy`'s ownership rule (`findPasskeyWalletCandidates`, `verifyOwnershipProof`, `describeWalletCandidates`, `pickOwnWallet`) and uses a wallet on its own only when it is **the one wallet this passkey has signed for, with nothing untrusted able to spend from it** (no other authority, live session, pending deferred transaction or token approval, and a vault still owned by the System Program). Everything else goes to the user.

- **`onConfirmWallet`** (web `LazorkitProvider` and `LazorkitWalletAdapter` / `registerLazorkitWallet` config; mobile `LazorKitProvider`; per call on `connect`): `'builtin'` (default) shows the SDK's "Which wallet is yours?" chooser; a function shows your own UI and returns `{ wallet }` or `null`; `'throw'` makes `connect` throw `WalletNeedsConfirmationError` with `candidates: WalletChoice[]`, and `connect({ confirmWallet })` within 2 minutes adopts the chosen one without a second passkey prompt. `registerLazorkitWallet` rejects `'throw'`: `standard:connect` cannot carry a `confirmWallet`, so the user could never finish.
- **`confirmWallet`** accepts the vault or the wallet PDA. One that names no wallet the passkey is proven to hold throws an error naming it; it is never ignored.
- **`trustedAuthorities`**: your own Ed25519 keys (base58). An authority, session or token approval held by one of them does not stop a wallet from being used on its own. Passkeys, pending deferred transactions and a vault handed to another program are never trusted.
- **`watchMints`**: your app's SPL Token mints, checked on top of wSOL, USDC, USDT and devnet USDC for a vault token account handed to someone else.
- New exports: `WalletChoice`, `ConfirmWalletRequest`, `ConfirmWalletHandler`, `OnConfirmWallet`, `WalletConfirmationDeclinedError` (the user chose none; nothing is saved), `PortalCancelledError`; and sdk-legacy's `createOwnershipChallenge`, `verifyOwnershipProof`, `pickOwnWallet`, `selectWalletByAddress` with their types.
- The chooser lists each wallet by its vault address and balance, marks a v1 wallet "Legacy (v1)" and a wallet never signed for "Not used with this passkey yet", and lists everything untrusted that can spend from it. A vault handed to another program is a warning of its own and cannot be chosen there. Nothing is pre-selected and no row is called safe; "None of these" declines and never creates a wallet. Web draws it in the portal dialog's frame (keyboard accessible, light and dark); mobile renders it as a `Modal` from `LazorKitProvider` (Android back declines).
- A user's own wallet is confirmed once before its first transaction, as is a wallet made on the migration page, and whenever the passkey has signed for two wallets (a signature can be replayed onto a planted copy). A wallet `connect` just created is saved as it is.
- The portal connect URL carries a `challenge`; a portal that answers with an assertion over it saves the separate proof prompt. Web trusts a reply saying the passkey was just created (`kind: 'created'`) for creation; mobile, where a deep link can be forged, always proves.
- If the chain cannot be read, `connect` fails; it never takes that as "no wallet" and creates one.

Portal fixes:

- Closing the portal — web: the dialog's X, Escape, a click outside, or the popup; mobile: dismissing the browser (iOS) or returning to the app without an answer (Android) — rejects the pending action at once with `PortalCancelledError`, instead of after the 60-second timeout. On web a text selection dragged out of the dialog (the vault address, say) no longer counts as a click outside.
- Web: `disconnect` during a `connect` closes its portal or chooser and rejects that connect with `PortalCancelledError`; it no longer saves or connects a wallet after the user disconnected, and a new `connect` no longer runs beside it. The wallet-adapter runs one connect at a time: a second call waits for the first instead of opening another portal whose wallet would replace the first's.
- The portal's own error text is surfaced: web shows it instead of "Portal error", and mobile reads the portal's `error` redirect parameter and rejects with it.
- Mobile: a signing action always rejects on failure; it no longer resolves `undefined`.
- Web: the wallet-adapter creates a new user's wallet again, and `sendTransaction` without lookup tables sends again. Both built a legacy transaction with no fee payer or recent blockhash, so it could not be serialized for the paymaster.

Breaking:

- `findOwnedCandidates`, `provenCandidates`, `chooseOwnWallet` and `OwnedCandidate` are removed; `OwnershipProof` now comes from `@lazorkit/sdk-legacy`.
- `WalletNeedsConfirmationError` is thrown only with `onConfirmWallet: 'throw'`, and its shape changed: `credentialId` and `candidates: WalletChoice[]` (vault, balance, signature count and everything else that can spend), instead of counts.
- With the default, `connect` shows the chooser where it used to adopt a wallet silently (a wallet never signed for) or throw.
- Web: while a wallet is connected, `connect({ confirmWallet })` naming a different wallet throws instead of returning the connected one. The wallet-adapter clears its `confirmWallet` property once a wallet is connected, and on disconnect.
