---
'@lazorkit/wallet-mobile-adapter': patch
---

An inner program's 3014 is no longer reported as `DeferredExpiredError`, and `isDeferredExpiredError` is true for every `DeferredExpiredError`

2.2.0 reported a 3014 from TX2 as an expired authorization unless a re-read of the DeferredExec account showed it still open. When that read failed, or the RPC node did not have the account yet, an inner program's 3014 (Anchor's `AccountNotAssociatedTokenAccount`) became `DeferredExpiredError`, and the user was told to approve again for a failure that would repeat. The re-read was also made at `confirmed`, which trails the bank a paymaster simulates on, so a real expiry at the window's edge came back as a plain `PaymasterError`.

- A 3014 is `DeferredExpiredError` only when it is established: its logs name LazorKit as the first program to fail, it landed on chain after `expires_at`, or the chain is past `expires_at` when the account is read again, now at `processed`. Otherwise the error is thrown as it came.
- Any error from sending TX2 carries `deferredExecPda`, `authorizeSignature` (when the call sent TX1) and `expiresAtSlot` (when it was read). New type export: `DeferredFailureContext`.
- `isDeferredExpiredError` is true for any `DeferredExpiredError`, including the one thrown before sending (it was false) and one from another copy of the package. For a raw 3014 it is true only when the logs name LazorKit as the first program to fail.
- The README says the window is also how long an unused approval stays executable (nothing cancels it before it expires).
