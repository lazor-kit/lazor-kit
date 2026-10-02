---
'@lazorkit/wallet': minor
---

**Session limits name every asset a session may spend**

LazorKit v2's next program release bounds what a session (or a delegate key) may move by what its policy names, and nothing else: with no SOL limit the wallet's SOL may not fall, rent for a new account included (`ActionUnlistedSolOutflow`, 3037), and a token may leave only when a limit names its mint (`ActionUnlistedTokenOutflow`, 3038). A session made with SOL limits only, as `SpendingLimits` could express until now, will move no token. Until that release an asset the limits do not name is not bounded at all: a session with `tokens` limits only can spend all the wallet's SOL.

- `SpendingLimits` takes `tokens`: one entry per mint, `{ mint, lifetimeCap?, perTxMax?, recurring?: { limit, windowSlots } }`, amounts in the mint's base units. wSOL is a mint of its own.
- `createSession` checks the limits before anything is read or the passkey is asked, and throws on a `tokens` entry with no limit, a mint named twice, an amount outside a u64, a window of 0 slots (which the program refuses), more than 16 actions, or more than 244 bytes of actions: what fits in the CreateSession transaction beside the passkey's response (a clientDataJSON of up to 300 bytes). A SOL limit takes 19 bytes (`solRecurring` 43), a token's `lifetimeCap` or `perTxMax` 51, its `recurring` 75: `solPerTxMax` with `perTxMax` and `lifetimeCap` for 2 mints, or with `perTxMax` for 4. Nothing is added that was not asked for.
- Changed: for a `sessionKey` of your own that already has a session, `createSession` now checks the limits before it looks for that session, so a call with no `spendingLimits` (and not `unrestricted`), or invalid ones, throws where it resolved with the existing session. With valid limits it still resolves with the session as it was made, whatever limits are passed: to change an external key's limits, revoke its session (`revokeSession({ sessionPda })`) or register a new key.
- New: `spendingLimitsToActions(limits)`, the actions a `SpendingLimits` stands for; `serializeActions(spendingLimitsToActions(limits))` is a delegate `policy` for `addAuthority`.
- New: `UnlistedSolOutflowError` ("This session is not allowed to spend SOL") and `UnlistedTokenOutflowError` ("This session is not allowed to spend this token"; "This key …" for a delegate), which `signAndSendWithSession` and `signAndSendWithAuthority` reject with for a 3037 / 3038, with `signer` and the original error as `cause`. A send whose outcome is unknown stays `TransactionOutcomeUnknownError`, and an Admin key's 3037 / 3038 is mapped only when the logs name LazorKit (an Admin has no policy). `isUnlistedSolOutflowError` / `isUnlistedTokenOutflowError` recognise them from either copy of the package, wrapped, or raw; `UNLISTED_SOL_OUTFLOW_CODE`, `UNLISTED_TOKEN_OUTFLOW_CODE`.
- The paymaster does not resend a transaction refused with 3037 or 3038 (the same bytes move the same assets), unless an earlier attempt's answer was lost.
- `ERROR_NAMES` / `errorFromCode` name 3036 (`SessionNotExpired`), 3037, 3038 and 4018 (`RetiredDeployment`).

See the README, "What a policy bounds".
