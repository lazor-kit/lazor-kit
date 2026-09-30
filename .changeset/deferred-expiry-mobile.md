---
'@lazorkit/wallet-mobile-adapter': minor
---

A deferred execution's window now outlasts the adapter's own wait for TX1, and an expired one is reported as `DeferredExpiredError`

- `authorizeAndExecute` and `authorizeDeferred` authorized the SDK's default of 300 slots (documented as "~2 min"), while the adapter waits up to two minutes for TX1 before sending TX2. At devnet's 230 ms a slot, 300 slots is about 69 s: after a slow confirmation, TX1 used the passkey's counter, its DeferredExec account kept the paymaster's rent, and TX2 failed with a `PaymasterError` (3014). The default is now `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500), and `expiryOffset` must be 10 to 9000 (otherwise a `RangeError` before the portal opens).
- Before TX2 is sent (`authorizeAndExecute`, `executeDeferred`), the authorization's `expires_at` is read. One that has expired is not sent. A 3014 from the paymaster or the chain is checked against the account and rejects with `DeferredExpiredError`: `authorizeSignature`, `deferredExecPda` (pass it to `reclaimDeferred`), `expiresAtSlot`.
- New exports: `DeferredExpiredError`, `isDeferredExpiredError`, `DEFERRED_EXPIRED_CODE`, `MIN_DEFERRED_EXPIRY_SLOTS`, `MAX_DEFERRED_EXPIRY_SLOTS`.
