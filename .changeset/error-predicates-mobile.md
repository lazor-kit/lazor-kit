---
'@lazorkit/wallet-mobile-adapter': patch
---

`isSignatureReusedError` and `isRetiredDeploymentError` are true for the adapter's own errors, and every `is*Error` predicate reads through wrapped errors

2.2.1 checked only an error's text, so `isSignatureReusedError(new SignatureReusedError())` and `isRetiredDeploymentError(new V1WalletRetiredError())` were `false` (the bug 2.2.1 fixed in `isDeferredExpiredError`).

- `isSignatureReusedError`, `isRetiredDeploymentError` and `isDeferredExpiredError` are true for `SignatureReusedError`, `V1WalletRetiredError` and `DeferredExpiredError`, including one from another copy of the package (matched by `name` and `code`).
- They read through what wraps an error: `cause`, and the `error` of a wallet-adapter `WalletError`.
- For a raw error they read the message, the logs, a paymaster's `data` and a TransactionError, in the error and in its causes. The documented rules for raw errors are unchanged: a 3006 with no logs counts as LazorKit's, and a 3014 with no logs does not.
- `isRetiredDeploymentError` also accepts Kora's `Custom(4018)` text, a 4018 whose logs are only in the paymaster's `data`, and a TransactionError object. Actions map a retired v1 wallet's failure to `V1WalletRetiredError` with this predicate, so these now reach the app as `V1WalletRetiredError` instead of a raw `PaymasterError`.
- The README says which error classes have no predicate: compare `error.name` for those.
