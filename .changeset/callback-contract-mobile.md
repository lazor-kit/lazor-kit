---
'@lazorkit/wallet-mobile-adapter': patch
---

`connect` and `disconnect` honour their callbacks on the store too, and `transferSol` reports a refusal to `onFail`

The adapter's callback contract (callbacks run once `isSigning` is `false`, right before the promise settles, or at once for a call refused because another is running; what they throw changes nothing) now covers every entry point:

- `store.connect({ onSuccess, onFail })` calls them, once `isConnecting` is `false`; 2.2.1 ignored them. `useWallet().connect` passes them through, so they run once, and a throwing `onSuccess` no longer rejects a connect that succeeded or calls `onFail`. A refusal ("Already connecting") calls `onFail` at once, while the running connect still holds `isConnecting`.
- `disconnect(options?)` on the store takes `onSuccess` / `onFail`, and `useWallet().disconnect` passes them through: a throwing `onSuccess` no longer rejects it.
- `transferSol` with no wallet connected calls `onFail` and sets `error`, as every other action does; 2.2.1 rejected without either.
