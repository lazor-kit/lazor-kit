---
'@lazorkit/wallet': patch
---

Fix the wallet-adapter reading the chain up to 15 seconds behind, and connect and signing throwing in apps with no global `Buffer`

- **`LazorkitWalletAdapter` (and `registerLazorkitWallet`, which wraps it) now reads at `confirmed`, like `LazorkitProvider` and `useWallet`.** Its `Connection` was created without a commitment, so it read at the RPC default, `finalized`, some 13 to 15 seconds behind. That covered the wallet lookup on connect, and the wallet, passkey key and counter read before `sendTransaction`. Within that window after a transaction:
  - A second `sendTransaction` signed over the counter the first had already used. It failed on chain with `SignatureReused` (`custom program error: 0xbbe`) after the user had approved the passkey prompt.
  - A new user's first `sendTransaction` failed with "The connected wallet no longer lists this passkey".
  - A disconnect and reconnect did not see the wallet the adapter had just created, and created a second wallet for the same passkey.
- **No global `Buffer` is needed.** `getCredentialHash`, the decoding of the passkey key the portal reports on connect, and `useWallet().verifyMessage` used the global `Buffer` instead of the `buffer` package the rest of the SDK imports. An app without a `Buffer` polyfill got `ReferenceError: Buffer is not defined` when connecting a passkey and on every transaction it signs.
