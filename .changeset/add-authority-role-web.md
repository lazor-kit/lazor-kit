---
'@lazorkit/wallet': minor
---

**Breaking:** `addAuthority` has no default role any more: `role` is required

3.2.1 gave a key added without a `role` the Admin rank: it can add and remove delegates and spend the whole vault, with no policy and no expiry, until `removeAuthority`. An app that forgot the argument handed out the most a key can get short of Owner, and the SDK kept that key in the browser.

- `role` is required in the types (`AddAuthorityPayload.role: number`, on `useWallet().addAuthority` and on the store): a call without it does not compile.
- At runtime, a missing role, or one that is not `ROLE_OWNER` (0), `ROLE_ADMIN` (1) or `ROLE_SPENDER` (2), is refused before anything is read or the passkey is prompted: the call rejects (and calls `onFail`, and sets `error`) with an error that says what each rank may do (Owner: manage every authority, other owners included, never the last one; Admin: manage delegates only; both spend without limit; `ROLE_SPENDER`, the delegate rank: manage nothing, spend only within its `policy`, which v2 requires) and suggests `ROLE_SPENDER` with a policy for a key the app holds.
- `ROLE_OWNER` on a v2 wallet is refused the same way, before anything is read or the passkey is prompted: the protocol SDK adds an Owner only on an explicit opt-in this method does not pass, so 3.2.1 failed there too, after reading the chain. The error names `ROLE_ADMIN` and `ROLE_SPENDER`. On a v1 wallet `ROLE_OWNER` is accepted, as before.

A breaking change in a minor release, deliberately: 3.x is days old, protocol v2 is not live on mainnet yet, and the old default silently produced an unbounded Admin key. Every `addAuthority` call that compiles against 3.3.0 adds the same authority 3.2.1 did.

**Migration:** pass the role you relied on: `addAuthority({ role: ROLE_ADMIN, ... })` keeps 3.2.1's behaviour. For a key your app uses to spend, prefer `addAuthority({ role: ROLE_SPENDER, policy: serializeActions([...]) })`.
