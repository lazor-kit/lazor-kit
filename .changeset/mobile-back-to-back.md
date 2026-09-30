---
'@lazorkit/wallet-mobile-adapter': patch
---

Two sends in a row (`await send(a); await send(b)`) both run, and so does a send made from `onSuccess`

`signAndSendTransaction`, `signMessage` and `transferSol` resolved from inside `onSuccess`, before `isSigning` was cleared, so the call on the next line was refused with `SigningError` ("Another passkey request is still in progress") and nothing was sent. Every action ran its `onSuccess` or `onFail` before clearing the flag, so a call made from a callback was refused the same way.

- Every action's promise now settles, and its `onSuccess` or `onFail` runs, once `isSigning` is `false` again. A callback that throws is logged and does not change the outcome.
- The store's `signAndExecuteTransaction`, `signMessage` and `transferSol` now resolve with their result instead of `undefined`, and the hook returns those promises.
- A call made while another is still running is refused with `SigningError`, as before.
