---
'@lazorkit/wallet': minor
---

**Session limits name every asset a session may spend**

LazorKit v2's next program release bounds what a session (or a delegate key) may move by what its policy names, and nothing else: with no SOL limit the wallet's SOL may not fall, rent for a new account included (`ActionUnlistedSolOutflow`, 3037), and a token may leave only when a limit names its mint (`ActionUnlistedTokenOutflow`, 3038). A session made with SOL limits only, as `SpendingLimits` could express until now, will move no token.

- `SpendingLimits` takes `tokens`: one entry per mint, `{ mint, lifetimeCap?, perTxMax?, recurring?: { limit, windowSlots } }`, amounts in the mint's base units. wSOL is a mint of its own.
- `createSession` checks the limits before anything is read or the passkey is asked, and throws on a `tokens` entry with no limit, a mint named twice, an amount outside a u64, a window of 0 slots (which the program refuses), or more than 16 actions. Nothing is added that was not asked for.
- New: `spendingLimitsToActions(limits)`, the actions a `SpendingLimits` stands for; `serializeActions(spendingLimitsToActions(limits))` is a delegate `policy` for `addAuthority`.
- New: `UnlistedSolOutflowError` ("This session is not allowed to spend SOL") and `UnlistedTokenOutflowError` ("This session is not allowed to spend this token"; "This key …" for a delegate), which `signAndSendWithSession` and `signAndSendWithAuthority` reject with for a 3037 / 3038, with `signer` and the original error as `cause`. `isUnlistedSolOutflowError` / `isUnlistedTokenOutflowError` recognise them from either copy of the package, wrapped, or raw; `UNLISTED_SOL_OUTFLOW_CODE`, `UNLISTED_TOKEN_OUTFLOW_CODE`.
- `ERROR_NAMES` / `errorFromCode` name 3036 (`SessionNotExpired`), 3037, 3038 and 4018 (`RetiredDeployment`).

See the README, "What a policy bounds".
