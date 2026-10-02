---
'@lazorkit/wallet': minor
---

Callbacks run once the action is over, a send from `onSuccess` runs, and a throwing callback no longer turns a landed transaction into a failure

The callback contract is now the one `@lazorkit/wallet-mobile-adapter` 2.2 ships. In 3.2.1, `onSuccess` and `onFail` ran while `isSigning` was still `true`, and inside the action's own error handling:

- `onSuccess` and `onFail` run once the action is over, with `isSigning` (or `isConnecting` for `connect`) already `false`, right before the promise settles. A send started from `onSuccess` runs; in 3.2.1 it was refused with "Already signing".
- What a callback throws is logged and changes nothing. In 3.2.1 a throwing `onSuccess` made a transaction that had landed reject, call `onFail` and set `error`, so an app that retries on failure sent it twice. A throwing `onFail` no longer replaces the action's error.
- Exactly one callback per call, agreeing with the promise. A refusal now calls `onFail` too ("Already signing", "No wallet connected", "Already connecting"). A refusal for want of a wallet or connection also sets `error`; one because another call is running leaves `error`, which is that call's, alone.
- New: `disconnect(options?)` and `removeAuthority(targetAuthorityPda, options?)` take `onSuccess` / `onFail`, on the store and on `useWallet()`. The store dropped them before. `useWallet()`'s types declare the callbacks every action already took at runtime, and the package exports `ActionCallbacks`, `DisconnectOptions` and `RemoveAuthorityOptions`.
- `LazorkitWalletAdapter` logs what an app's `connect` or `disconnect` listener throws instead of failing a `connect()` that has connected (it also emitted `error`). The Wallet Standard wallet calls each `change` listener on its own, so one that throws neither stops the others nor fails `standard:connect`.

Minor rather than patch: the timing of every callback and the outcome of a nested send change, and `disconnect` / `removeAuthority` gain options. Nothing is removed, and every behaviour that changes was a defect.
