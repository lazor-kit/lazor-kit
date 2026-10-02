---
'@lazorkit/wallet': patch
---

`isSignatureReusedError` and `isRetiredDeploymentError` are true for the SDK's own errors, and every `is*Error` predicate reads through wrapped errors

3.2.1 checked only an error's text, so `isSignatureReusedError(new SignatureReusedError())` and `isRetiredDeploymentError(new V1WalletRetiredError())` were `false` (the bug 3.2.1 fixed in `isDeferredExpiredError`).

- `isSignatureReusedError`, `isRetiredDeploymentError` and `isDeferredExpiredError` are true for `SignatureReusedError`, `V1WalletRetiredError` and `DeferredExpiredError`, including one from another copy of the package (an app that loads both the ESM and the CJS build has two; matched by `name` and `code`).
- They read through what wraps an error: `cause`, and the `error` of a wallet-adapter `WalletError`. A dApp on the Wallet Standard gets every error as `WalletSendTransactionError(message, error)`, so these were always `false` there.
- For a raw error they read the message, the logs, a paymaster's `data` and a TransactionError, in the error and in its causes (a cause that is a plain object, or holds the code only in its `data`, was missed). The documented rules for raw errors are unchanged: a 3006 with no logs counts as LazorKit's, and a 3014 with no logs does not.
- `isRetiredDeploymentError` also accepts Kora's `Custom(4018)` text, a 4018 whose logs are only in the paymaster's `data`, and a TransactionError object. The store and the adapter map a retired v1 wallet's failure to `V1WalletRetiredError` with this predicate, so these now reach the app as `V1WalletRetiredError` instead of a raw `PaymasterError`, and an error that already is one is no longer wrapped again.
- The `Paymaster` no longer retries a 4018. 3.2.1 sent it three times, 1 s and 2 s apart, though a retired v1 program answers every attempt the same way. It now fails on the first answer, as mobile does, with `V1WalletRetiredError` when the 4018 is the retired v1 program's: the logs name v1, or the paymaster is a v1 wallet's (`new Paymaster(config, { protocolVersion: 1 })`, which the store and the adapter pass). A 4018 whose program it cannot tell is thrown as the `PaymasterError`, and the store and the adapter map it by the wallet's protocol. After an earlier attempt whose answer was lost it stays a `PaymasterError` with `maybeSent`.
- The README says which error classes have no predicate: compare `error.name` for those.
