---
"@lazorkit/wallet": patch
---

**On a v2 wallet, `createSession` is refused before the passkey prompt**

The LazorKit v2 program reads a session's expiry, an action's expiry and a recurring limit's window in Unix seconds (devnet runs that release now, and mainnet v2 will). This 3.x line builds them in slots. Until now, `createSession` on a v2 wallet opened the portal, the user approved with the passkey, and the program then refused the session with `InvalidSessionDuration` (3008), sent three times.

- `createSession` on a v2 wallet (`protocolVersion: 2`) now throws `SdkUpgradeRequiredError` ("Creating sessions on v2 wallets requires @lazorkit/wallet 4.0 (npm install @lazorkit/wallet@next) …") before anything is read, the portal opens or the passkey is asked. It is reported to `onFail` and in `error` like any refusal.
- `addAuthority` on a v2 wallet with a `policy` that has an action with an expiry of its own or a recurring limit (a window) throws the same error, also before anything is read or prompted. The v2 program would store an expiry in slots as a time long past (a limit or whitelist would deny everything, a blacklist entry would stop blocking) and a window in slots as that many seconds. A policy with neither, and `ROLE_ADMIN` without a policy, are added as before.
- New exports: `SdkUpgradeRequiredError` (with `operation`: `'createSession'` or `'addAuthority'`), `isSdkUpgradeRequiredError`, and the `UpgradeRequiredOperation` type.
- A session or delegate send that the program refuses for going over its `SolMaxPerTx` (3023) is no longer sent again: the same bytes move the same amount.

v1 wallets are unchanged. Use `@lazorkit/wallet` 4.0 (`npm install @lazorkit/wallet@next`) for sessions on v2 wallets.
