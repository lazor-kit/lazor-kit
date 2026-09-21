---
'@lazorkit/wallet': major
'@lazorkit/wallet-mobile-adapter': major
---

Speak protocol v2, by depending on `@lazorkit/sdk-legacy` 1.x instead of a vendored copy of it

Both packages carried their own fork of the protocol layer, and the two forks were byte-identical to each other in 11 files. Under protocol v2 they were wrong in six independent ways, any one of which is fatal: un-namespaced PDA seeds, an accounts hash that does not bind signer/writable flags, raw account index bytes with no forward-signer bit, an `AddAuthority` payload with no `[policy_len][policy]` field, a read-only wallet account on Owner changes, and an optional protocol-fee suffix the program now requires. A seventh, `readAuthorityPubkey` pinned to the v1 account discriminator, would have broken every passkey signature.

Rather than reproduce that diff twice by hand, both packages now delegate to `@lazorkit/sdk-legacy` 1.x, which is the implementation the protocol repo's validator suites cover. A thin compatibility layer keeps the call shape these packages have always had, where `programId` is optional and defaults to `PROGRAM_ID`.

Breaking, beyond the protocol change itself:

- Every PDA derives a different address. A wallet created under v1 is unreachable from v2 code and must be moved with `LazorKitClient.migrateV1Wallet`.
- The low-level `create*Ix` builders, `appendProtocolFeeAccounts` and `readAuthorityState` are no longer part of the public surface. The client methods replace them; `readAuthorityState` is now `readAuthorityCounter` plus `readAuthorityPubkey`.
- `addAuthority` with `ROLE_SPENDER` (Delegate) requires a `policy`. The mobile adapter's `AddAuthorityPayload` gained the field.
- **`createSession` now refuses to mint an unbounded session by accident.** Passing no spending limits used to produce a session key that can spend the whole vault through any program until it expires, silently. It now throws unless the caller passes limits, or says `unrestricted: true`. This is the one behaviour change here that is not forced by the protocol, and a major release is the moment to make it.
