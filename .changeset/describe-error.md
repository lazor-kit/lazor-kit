---
'@lazorkit/wallet': minor
'@lazorkit/wallet-mobile-adapter': minor
---

Plain-language errors, and a send status that never calls a transaction that may still land "failed".

- `describeError(error)` returns `{ title, message, action?, retryable, maybeSent, code, programError? }` in plain English for every error the SDK surfaces: user rejections, a transaction whose outcome is not known ("Still checking…", "Don't pay again"), expired and failed transactions, the LazorKit program's errors read from simulation logs, Kora's text or a landed TransactionError (`custom program error: 0xbc0` is 3008, `InvalidSessionDuration`, named from `ERROR_NAMES`; an inner program's code is not read as LazorKit's), the portal's refusals, typed-request errors, passkeys unavailable, pop-ups blocked, rate limits (429), timeouts, network and paymaster errors, wrong network and insufficient funds. `maybeSent` is true whenever the transaction may have been sent, whatever else the error carries, and `retryable` is then false.
- `sendStatusOf(error)`: `'cancelled'`, `'checking'` (the outcome is not known: it may still land) or `'failed'`. The `SendStatus` type names a send's whole course: `'idle'`, `'reviewing'`, `'signing'`, `'submitted'`, `'confirmed'`, `'checking'`, `'failed'`, `'cancelled'`.
- The same in both packages (the mobile adapter's tests check the source and the answers match); see "Showing errors to users" in each README.

**Fixed** (`@lazorkit/wallet`): `errorKind` is `'tx-unknown'` for a `PaymasterError` whose transaction may have been sent (`maybeSent`, or a signature the paymaster reported), whatever else it carries, so `userMessage` no longer says "Couldn't reach the network. Nothing was sent." about a transaction that may land.
