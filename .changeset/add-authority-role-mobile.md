---
'@lazorkit/wallet-mobile-adapter': minor
---

**Breaking:** `addAuthorityEd25519` has no default role any more: `role` is required

2.2.1 gave a key added without a `role` the delegate rank (`ROLE_SPENDER`), which v2 accepts only with a `policy`.

- `role` is required in the types (`AddAuthorityPayload.role: number`, on `useWallet()` and on the store): a call without it does not compile.
- At runtime, a missing role, or one that is not `ROLE_OWNER` (0), `ROLE_ADMIN` (1) or `ROLE_SPENDER` (2), is refused before anything is read or the portal opens: the call rejects (and calls `onFail`, and sets `error`) with an error that says what each rank may do and suggests `ROLE_SPENDER` with a policy for a key the app holds. The same rule as `@lazorkit/wallet` 3.3.0's `addAuthority`.

A breaking change in a minor release, deliberately, as for the web SDK: protocol v2 is not live on mainnet yet, and making the rank explicit is the point. Every `addAuthorityEd25519` call that compiles against this release adds the same authority 2.2.1 did.

**Migration:** pass the role you relied on: `addAuthorityEd25519({ newEd25519Pubkey, role: ROLE_SPENDER, policy }, options)` keeps 2.2.1's behaviour.
