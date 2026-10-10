---
'@lazorkit/wallet-mobile-adapter': major
---

Typed approval requests, and session time in seconds (released with `@lazorkit/wallet` 4.0).

`createSession`, `revokeSession` and `removeAuthority` send the portal the operation itself, so it can show exactly what the passkey approves ("Let MyApp spend up to 0.002 SOL per payment and 5 USDC in total, until about 6:50 PM"), and sessions expire by the cluster clock instead of by slot. Requires `@lazorkit/sdk-legacy` 2.0.0 and a LazorKit v2 program that measures sessions in seconds: release this together with that program upgrade.

**Breaking**

- Requires `@lazorkit/sdk-legacy` 2.0.0. Its `Actions.solRecurringLimit` / `tokenRecurringLimit` take `windowSeconds` instead of `window`, parsed actions carry `windowSeconds`, and `WalletFacts.liveSessions[].expiresAtSlot` is `expiresAt`; this package re-exports them.
- Session expiries are Unix seconds of the cluster clock (the Clock sysvar). A v2 program that still reads them as slots refuses them (3008).
- v2 sessions default to `DEFAULTS.SESSION_EXPIRY_SECONDS` (18,000: 5 hours). `DEFAULTS.SESSION_EXPIRY_SLOTS` (50,000) is new, and is the v1 default only.
- `portalErrorOf` returns `Error | null` (a typed-request refusal is `RequestOutOfDateError` or `PortalRefusedError`; any other portal error is a `LazorKitError` as before).
- A session's actions fit in 224 bytes, as `@lazorkit/sdk-legacy` 2.0.0 sizes them (a clientDataJSON of 320 bytes): `createSession` refuses more than 16 actions, or more than 224 bytes of them, before the portal opens.

**Typed requests**

- On a v2 wallet, the three operations open the portal with the request (`@lazorkit/sdk-legacy/approval`, v1) in the URL fragment (`#/?lk1=…`). The query is unchanged, so a portal that does not read typed requests signs as before. Wallets made before LazorKit v2, and every other passkey action, open the portal as before.
- The portal's reply is checked before anything is sent: the passkey must have signed this operation, at the slot and counter the portal names (`typedV`, `typedKind`, `typedSlot`, `typedCounter`, `typedSysvarIx` in the redirect), or at the prepared ones when it names none. The transaction is then finalized at that slot and counter. A reply that does not match rejects with `PortalReplyMismatchError` and nothing is sent.
- New errors: `PortalReplyMismatchError`; `RequestOutOfDateError` (the portal refused with `stale-counter`; `retryable: true`); `PortalRefusedError` (another refusal, with the portal's `code`); `TypedRequestTooLargeError` (the request or its URL is over the cap, 8,192 / 16,384 characters; nothing is opened). The passkey signed nothing on a refusal.

**Session expiry**

- `createSession` takes `expiresInSeconds` (more than 0, at most 30 days; default 5 hours) or `expiresAt` (Unix seconds, within 30 days of the cluster clock), checked against the cluster clock before the passkey is asked. New export `MAX_SESSION_SECONDS`.
- Deprecated and still accepted: `expiresAtSlot`, which is no longer required. On a v2 wallet it is converted to seconds with the cluster's measured slot time (recent performance samples), with a warning, and throws when the slot time cannot be read.
- v1 wallets keep slot-based expiry: with no expiry, 50,000 slots ahead (no slot-time read); `expiresAtSlot` is used as given; `expiresInSeconds` / `expiresAt` are converted to slots with the measured slot time. A recurring limit's `windowSeconds` is converted to slots for a v1 wallet.
- The wallet chooser's `approxExpiresAt` reads a v2 session's expiry as a Unix time.
