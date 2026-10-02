---
'@lazorkit/wallet-mobile-adapter': minor
---

**Typed errors for a session send that moves an asset its actions do not name**

LazorKit v2's next program release bounds what a session (or a delegate key) may move by what its actions name, and nothing else: with no `Actions.sol*` action the wallet's SOL may not fall, rent for a new account included (`ActionUnlistedSolOutflow`, 3037), and a token may leave only when an `Actions.token*` action names its mint (`ActionUnlistedTokenOutflow`, 3038). A session whose actions name SOL only will move no token: name each mint it spends.

- New: `UnlistedSolOutflowError` ("This session is not allowed to spend SOL") and `UnlistedTokenOutflowError` ("This session is not allowed to spend this token"), which `signAndSendWithSession` rejects with for a 3037 / 3038, with the original error as `cause`. `isUnlistedSolOutflowError` / `isUnlistedTokenOutflowError` recognise them from either copy of the package, wrapped, or raw; `UNLISTED_SOL_OUTFLOW_CODE`, `UNLISTED_TOKEN_OUTFLOW_CODE`.
- `ERROR_NAMES` / `errorFromCode` name 3036 (`SessionNotExpired`), 3037, 3038 and 4018 (`RetiredDeployment`).

See the README, "What a session's actions bound".
