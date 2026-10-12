---
'@lazorkit/wallet': patch
'@lazorkit/wallet-mobile-adapter': patch
---

`@lazorkit/sdk-legacy` ^2.1.0 (layout revision 2: authorities and sessions record the account that paid their rent).

- `revokeSession` and `removeAuthority` refund the closed account's rent to the payer it records, which the program now requires (3039 for any other destination). Neither package passes a refund destination of its own, so nothing changes for an app that leaves it out. In the mobile adapter, a `refundDestination` other than the recorded payer is refused before the passkey prompt with `RefundDestinationMismatchError`.
- `describeError`: 3039 `RefundDestinationMismatch` and `RefundDestinationMismatchError` are `program-3039`, "Refund can't go there", not retryable.
