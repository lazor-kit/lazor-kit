---
'@lazorkit/wallet': minor
---

An existing passkey with no wallet can now connect: the wallet is created for the passkey's real key, recovered from two of its signatures

Every passkey starts without a LazorKit v2 wallet. Signing in never reveals a passkey's public key, so the portal reports one from its own storage: none for a passkey made on another device or browser, and sometimes another passkey's. `connect` would not create a wallet for a key it could not verify, because such a wallet can never sign. Instead it failed with "The portal reported a public key this passkey does not hold, so no wallet was created", or "signing in with an existing passkey does not reveal its public key". Those passkeys could never get a wallet.

- When the reported key is missing or is not the signer's, `connect` now recovers the passkey's key from two of its signatures over challenges the SDK chose (`resolvePasskeyPublicKey`, `@lazorkit/sdk-legacy` 1.3.0). The signatures are the connect proof and the connect reply's own signature, or one more portal sign when the reply has none. That is one extra passkey prompt (a sign over a random challenge, with no transaction). The wallet is created for the recovered key. The same applies to `useWallet().connect` and `LazorkitWalletAdapter`.
- Unchanged: a passkey the portal registered just now uses the key it reports. A reported key that the connect proof verifies against is used with no extra prompt. Wallet lookup, adoption and the chooser work as before.
- A wallet is still never created for a key that no signature from this connect verifies against. If the user closes the extra prompt, `connect` rejects with `PortalCancelledError`. If the signatures do not settle on one key, it throws an error that says so. In both cases nothing is created.
- Requires `@lazorkit/sdk-legacy` ^1.3.0.
