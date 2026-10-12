---
"@lazorkit/wallet-mobile-adapter": patch
---

**On a v2 wallet, `createSession` is refused before the portal opens**

The LazorKit v2 program reads a session's expiry, an action's expiry and a recurring limit's window in Unix seconds (devnet runs that release now, and mainnet v2 will). This 2.x line passes them in slots (`expiresAtSlot`, and the slot expiries and windows of `@lazorkit/sdk-legacy` 1.x actions). Until now, `createSession` on a v2 wallet opened the portal, the user approved with the passkey, and the program then refused the session with `InvalidSessionDuration` (3008).

- `createSession` on a v2 wallet (`protocolVersion: 2`) now throws `SdkUpgradeRequiredError` ("Creating sessions on v2 wallets requires @lazorkit/wallet-mobile-adapter 3.0 (npm install @lazorkit/wallet-mobile-adapter@next) …") before anything is read or the portal opens. It is reported to `onFail` and in `error` like any refusal.
- `addAuthorityEd25519` on a v2 wallet with a `policy` that has an action with an expiry of its own or a recurring limit (a window) throws the same error, also before anything is read or the portal opens. A policy with neither, and `ROLE_ADMIN` without a policy, are added as before.
- New exports: `SdkUpgradeRequiredError` (with `operation`: `'createSession'` or `'addAuthorityEd25519'`), `isSdkUpgradeRequiredError`, and the `UpgradeRequiredOperation` type.
- `signMessage` with bytes that start with a UTF-8 byte order mark (EF BB BF) now sends a display text that keeps the BOM, so the text the portal shows encodes back to exactly the signed bytes (the fix `@lazorkit/wallet` 3.4.1 shipped; it was in this package's source since then but not released).

v1 wallets are unchanged. Use `@lazorkit/wallet-mobile-adapter` 3.0 (`npm install @lazorkit/wallet-mobile-adapter@next`) for sessions on v2 wallets.
