---
'@lazorkit/wallet-mobile-adapter': minor
---

Experimental, devnet only: `transactionOptions.txVersion: 'v1'` sends a SIMD-0385 v1 transaction, up to 4096 bytes and 64 addresses

Nothing changes unless a call passes `txVersion: 'v1'`. Without it, every transaction, paymaster request, RPC call and error is the same as in 2.2.1. A test runs 44 send cases and compares them, byte for byte, with what the published 2.2.1 build does.

- **When v1 is used.** A `'v1'` request goes out as v1 only when all of these hold:
  - the paymaster declares it signs v1 (`configPaymaster={{ paymasterUrl, acceptsTxV1: true }}`);
  - that paymaster has not refused v1 since the app started;
  - no `feeToken` is set;
  - the wallet is on the devnet LazorKit v2 program.

  Otherwise it goes out as v0, exactly as with `'v0'`, and the reason is logged once. Mainnet and LazorKit v1 wallets never send v1. Do not set `acceptsTxV1` for `kora.devnet.lazorkit.com`, which cannot read v1.
- **Flows.** `signAndSendTransaction`, `transferSol`, `signAndSendWithSession`, `authorizeAndExecute` (both transactions), `authorizeDeferred` and `executeDeferred`. Connecting, sessions and authorities always send v0.
- **Limits.** Every v1 transaction carries a compute-unit limit and a loaded-accounts data size limit in its config. It never carries a ComputeBudget instruction. `computeUnitLimit` (1 to 1,400,000) and the new `loadedAccountsDataSizeLimit` (196,608 to 67,108,864) set them. One simulation, bounded to 3 s, sizes any limit not set. If it fails, the limits are set to the maximums, which do not change a v1 fee. A value out of range is a `RangeError` before the portal opens. In `authorizeAndExecute` the limits apply to TX2, as `computeUnitLimit` does for v0.
- **Errors, thrown only for `'v1'` and never after anything was sent.** `TransactionTooLargeError`: the transaction is over the limit of the format it goes out in. v0 does not rescue a transaction too large for v1. `PayloadExceedsProgramLimitsError`: over the LazorKit program's limits, which are 16 inner instructions and its heap. Both are checked before the portal opens. For `authorizeAndExecute`, TX2 is checked before the portal opens too, so TX1 never authorizes a TX2 that cannot be sent.
- **Paymaster.** A paymaster that does not sign v1 answers -32051 before signing. That call fails with `PaymasterError`, and is not sent again as v0. Later `'v1'` calls to it go out as v0 until the app restarts. New type `PaymasterConfig` (`paymasterUrl`, `apiKey`, `acceptsTxV1`) for `configPaymaster` and `v1ConfigPaymaster`.
- **Dependency.** `@noble/curves` ^1.9.7 signs v1 transactions. `@solana/web3.js` already depends on it. Peer dependencies are unchanged.
