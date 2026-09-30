---
'@lazorkit/wallet': minor
---

A deferred execution's window now outlasts the wallet's own wait for TX1, and an expired one is reported as `DeferredExpiredError`

`authorizeAndExecute` authorized TX2 for the SDK's default of 300 slots, but it waits up to two minutes for TX1 to be confirmed before sending TX2. At devnet's 230 ms a slot, 300 slots is about 69 s. After a slow confirmation, TX1 landed and used the passkey's counter, its DeferredExec account kept the paymaster's rent, and TX2 failed with a generic `PaymasterError` (3014) that carried neither TX1's signature nor the account. The paymaster request was also retried three times.

- `authorizeAndExecute` and `authorizeDeferred` now authorize `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500) slots by default, and take `expiryOffset` (10 to 9000; other values throw a `RangeError` before the prompt).
- Before TX2 is sent (`authorizeAndExecute`, `executeDeferred`), the authorization's `expires_at` is read. One that has expired is not sent. A 3014 from the paymaster or the chain is checked against the account and rejects with `DeferredExpiredError`: `authorizeSignature`, `deferredExecPda`, `expiresAtSlot`. The `Paymaster` no longer retries a 3014.
- New exports: `DeferredExpiredError`, `isDeferredExpiredError`, `DEFERRED_EXPIRED_CODE`, `MIN_DEFERRED_EXPIRY_SLOTS`, `MAX_DEFERRED_EXPIRY_SLOTS`, and the `DeferredTxPayload` type.
