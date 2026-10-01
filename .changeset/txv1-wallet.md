---
'@lazorkit/wallet': minor
---

Experimental, devnet only: `transactionOptions.txVersion: 'v1'` sends a SIMD-0385 v1 transaction, up to 4096 bytes and 64 addresses

Nothing changes unless a call passes `txVersion: 'v1'`. Without it, every transaction, paymaster request, RPC call and error is the same as in 3.2.1. A test runs 53 send cases and compares them, byte for byte, with what the published 3.2.1 build does.

- **When v1 is used.** A `'v1'` request goes out as v1 only when the paymaster declares it signs v1 (`paymasterConfig: { paymasterUrl, acceptsTxV1: true }`), has not refused v1 in this page, and the wallet is on the devnet LazorKit v2 program. Otherwise it goes out as v0, exactly as with `'v0'`, and the reason is logged once. Mainnet and LazorKit v1 wallets never send v1. Do not set `acceptsTxV1` for `kora.devnet.lazorkit.com`, which cannot decode v1.
- **Flows.** `signAndSendTransaction`, `signAndSendWithSession`, `signAndSendWithAuthority`, `authorizeAndExecute` (both transactions), `authorizeDeferred` and `executeDeferred`. Connecting and the session and authority management calls ignore it.
- **Limits.** Every v1 transaction carries a compute-unit limit and a loaded-accounts data size limit. By default one simulation, bounded to 3 s, sizes them. If it fails, they are set to the maximums, which do not change a v1 fee. `computeUnitLimit` (1 to 1,400,000) and the new `loadedAccountsDataSizeLimit` (196,608 to 67,108,864) set them for v1. A value out of range is a `RangeError` before the prompt. Legacy and v0 sends still ignore `computeUnitLimit`.
- **Errors, thrown only for `'v1'` and never after anything was sent.** `TransactionTooLargeError`: the transaction is over the limit of the format it goes out in. v0 does not rescue a transaction too large for v1. `PayloadExceedsProgramLimitsError`: over the LazorKit program's limits, which are 16 inner instructions and its heap. Both are checked before the passkey prompt. For `authorizeAndExecute`, TX2 is checked before the prompt too, so TX1 never authorizes a TX2 that cannot be sent.
- **Paymaster.** A paymaster that does not sign v1 answers -32051 before signing. That call fails with `PaymasterError`, and is neither retried nor sent again as v0. Later `'v1'` calls to it in the page go out as v0. New: `PaymasterConfig.acceptsTxV1`, and `Paymaster.signAndSendRaw` (send already-encoded bytes, with the same retries and error mapping).
- **Dependency.** `@noble/curves` ^1.9.7 signs v1 transactions. `@solana/web3.js` already depends on it, so it adds no new package to an app. Peer dependencies are unchanged.
