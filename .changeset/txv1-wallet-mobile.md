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

  Otherwise it goes out as v0, with the bytes a `'v0'` request sends, and the reason is logged once. Before the portal opens such a request still rejects what a `'v0'` request would only fail on later (a v0 transaction no passkey response could fit; on the devnet v2 program, a payload over the program's limits), and for a deferred pair it reads two accounts more to measure TX2. It does not check the v1 limits. Mainnet and LazorKit v1 wallets never send v1. Do not set `acceptsTxV1` for `kora.devnet.lazorkit.com`, which cannot read v1.
- **Flows.** `signAndSendTransaction`, `transferSol`, `signAndSendWithSession`, `authorizeAndExecute` (both transactions), `authorizeDeferred` and `executeDeferred`. Connecting, sessions and authorities always send v0.
- **Limits.** Every v1 transaction carries a compute-unit limit and a loaded-accounts data size limit in its config. It never carries a ComputeBudget instruction. `computeUnitLimit` (1 to 1,400,000) and the new `loadedAccountsDataSizeLimit` (196,608 to 67,108,864) set them. One simulation, bounded to 3 s, sizes any limit not set. If it fails, the limits are set to the maximums, which do not change a v1 fee. A value out of range is a `RangeError` before the portal opens, when the request goes out as v1. In `authorizeAndExecute` the limits apply to TX2, as `computeUnitLimit` does for v0.
- **Errors, thrown only for `'v1'` and never after anything was sent.** `TransactionTooLargeError`: the transaction is over the limit of the format it goes out in. v0 does not rescue a transaction too large for v1. `PayloadExceedsProgramLimitsError`: over the devnet LazorKit v2 program's limits, which are 16 inner instructions and the heap the payload needs (`heapBytes`), as the instruction that runs it allocates it. Both are checked before the portal opens. For `authorizeAndExecute`, TX2 is checked before the portal opens too, so TX1 never authorizes a TX2 that cannot be sent.
- **Paymaster.** A paymaster that does not sign v1 answers -32051 before signing. That call fails with `PaymasterError`, and is not sent again as v0. Later `'v1'` calls to it go out as v0 until the app restarts. New type `PaymasterConfig` (`paymasterUrl`, `apiKey`, `acceptsTxV1`) for `configPaymaster` and `v1ConfigPaymaster`.
- **Preview.** When the request goes out as v1, the portal's preview is built without the caller's lookup tables, which the v1 transaction does not use, so it lists every account the passkey approves.
- **Stored config.** `acceptsTxV1` is never taken from the stored config: when storage answers after the app has set its config, the app's own `acceptsTxV1` (for the same paymaster) is kept, so leaving it out turns v1 off.
- **Dependency.** `@noble/curves` ^1.9.7 signs v1 transactions. `@solana/web3.js` already depends on it. Peer dependencies are unchanged.
