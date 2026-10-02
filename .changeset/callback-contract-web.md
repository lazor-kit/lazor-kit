---
'@lazorkit/wallet': minor
---

Callbacks run once the action is over, a send from `onSuccess` runs, and a throwing callback no longer turns a landed transaction into a failure

The callback contract is now the one `@lazorkit/wallet-mobile-adapter` 2.2 ships. In 3.2.1, `onSuccess` and `onFail` ran while `isSigning` was still `true`, and inside the action's own error handling:

- `onSuccess` and `onFail` run once the action is over, with `isSigning` (or `isConnecting` for `connect`) already `false`, right before the promise settles. A send started from `onSuccess` runs; in 3.2.1 it was refused with "Already signing".
- What a callback throws is logged and changes nothing. In 3.2.1 a throwing `onSuccess` made a transaction that had landed reject, call `onFail` and set `error`, so an app that retries on failure sent it twice. A throwing `onFail` no longer replaces the action's error.
- Exactly one callback per call, agreeing with the promise. A refusal now calls `onFail` too ("Already signing", "No wallet connected", "Already connecting"). A refusal because another call is running is reported at once, while that call still holds `isSigning` / `isConnecting`, and leaves `error`, which is that call's, alone. A refusal for want of a wallet or connection also sets `error`.
- New: `disconnect(options?)`, `removeAuthority(targetAuthorityPda, options?)` and `signMessage(message, options?)` take `onSuccess` / `onFail`, on the store and on `useWallet()`. The store dropped them before (`signMessage` took none). `useWallet()`'s types declare the callbacks every action already took at runtime, and the package exports `ActionCallbacks`, `DisconnectOptions`, `RemoveAuthorityOptions` and `SignMessageOptions`.
- `disconnect` no longer clears `isSigning` while an action runs, as on mobile. The action goes on to its end (its passkey prompt may still be open) and keeps the flag until then, so a second one is refused with "Already signing" instead of starting beside it, and the first no longer clears the second's flag when it ends.
- `LazorkitWalletAdapter` calls each `connect` or `disconnect` listener on its own and logs what one throws, instead of failing a `connect()` that has connected (it also emitted `error`). A listener that throws no longer stops the ones after it, such as wallet-adapter-react's `WalletProvider`. The Wallet Standard wallet does the same for `change` listeners, and neither fails `standard:connect`.

Minor rather than patch: the timing of every callback and the outcome of a nested send change, and `disconnect` / `removeAuthority` / `signMessage` gain options. Nothing is removed, and every behaviour that changes was a defect.
