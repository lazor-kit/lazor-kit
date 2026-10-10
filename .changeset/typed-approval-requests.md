---
'@lazorkit/wallet': major
'@lazorkit/wallet-mobile-adapter': major
---

**Typed approval requests, and session time in seconds**

`createSession`, `revokeSession` and `removeAuthority` send the portal the operation itself, so it can show exactly what the passkey approves ("Let MyApp spend up to 0.002 SOL per payment and 5 USDC in total, until about 6:50 PM"), and sessions expire by the cluster clock instead of by slot. Requires `@lazorkit/sdk-legacy` 2 and a LazorKit v2 program that measures sessions in seconds.

**Breaking**

- Requires `@lazorkit/sdk-legacy` 2.0.0. Its `Actions.solRecurringLimit` / `tokenRecurringLimit` take `windowSeconds` instead of `window`, parsed actions carry `windowSeconds`, and `WalletFacts.liveSessions[].expiresAtSlot` is `expiresAt`; this package re-exports them.
- Session expiries are Unix seconds of the cluster clock (the Clock sysvar). A v2 program that still reads them as slots refuses them (3008): release this together with the program upgrade.
- Web: `SpendingLimits` recurring limits take `windowSeconds` (`86_400n` is a day) instead of `windowSlots`. A `windowSlots` throws before anything is read or prompted, rather than being read as seconds.
- v2 sessions default to `DEFAULTS.SESSION_EXPIRY_SECONDS` (18,000: 5 hours). `DEFAULTS.SESSION_EXPIRY_SLOTS` (50,000) is now the v1 default only (and new on mobile).
- Mobile: `portalErrorOf` returns `Error | null` (a typed-request refusal is `RequestOutOfDateError` or `PortalRefusedError`; any other portal error is a `LazorKitError` as before).

**Typed requests**

- On a v2 wallet, the three operations open the portal with the request (`@lazorkit/sdk-legacy/approval`, v1) in the URL fragment (`#/?lk1=…`). The query is unchanged, so a portal that does not read typed requests signs as before. Wallets made before LazorKit v2, and every other passkey action, open the portal as before.
- The portal's reply is checked before anything is sent: the passkey must have signed this operation, at the slot and counter the portal names (web: `typed` in the reply; mobile: `typedV`, `typedKind`, `typedSlot`, `typedCounter`, `typedSysvarIx` in the redirect), or at the prepared ones when it names none. The transaction is then finalized at that slot and counter. A reply that does not match rejects with `PortalReplyMismatchError` and nothing is sent.
- New errors: `PortalReplyMismatchError`; `RequestOutOfDateError` (the portal refused with `stale-counter`; `retryable: true`); `PortalRefusedError` (another refusal, with the portal's `code`); `TypedRequestTooLargeError` (the request or its URL is over the cap, 8,192 / 16,384 characters; nothing is opened). The passkey signed nothing on a refusal.
- Web: the portal waits up to 10 minutes for a typed approval (60 seconds for other signing as before), since the portal picks the signing slot when the user taps Approve. Closing the portal still ends the wait at once.
- Mobile: `createSession` refuses actions that cannot fit in its transaction (more than 16, or more than 244 bytes) before the portal opens, as web does.

**Session expiry**

- `createSession` takes `expiresInSeconds` (more than 0, at most 30 days; default 5 hours) or `expiresAt` (Unix seconds, within 30 days of the cluster clock), checked against the cluster clock before the passkey is asked. New export `MAX_SESSION_SECONDS`.
- Deprecated and still accepted: web `expiresInSlots`, mobile `expiresAtSlot`. On a v2 wallet they are converted to seconds with the cluster's measured slot time (recent performance samples), with a warning, and throw when the slot time cannot be read. Mobile `expiresAtSlot` is no longer required.
- v1 wallets keep slot-based expiry: with no expiry, 50,000 slots ahead as before (no slot-time read); web `expiresInSlots` and mobile `expiresAtSlot` are used as given; `expiresInSeconds` / `expiresAt` are converted to slots with the measured slot time. A recurring limit's `windowSeconds` is converted to slots for a v1 wallet.
- Web: a kept session key is deleted once the cluster clock is past its session's expiry. A key kept by an earlier release, or a v1 wallet's, is still compared with the slot.
- The wallet chooser's `approxExpiresAt` reads a v2 session's expiry as a Unix time.
