---
'@lazorkit/wallet-mobile-adapter': minor
---

An existing passkey with no wallet can now connect: the wallet is created for the passkey's real key, recovered from two of its signatures. Also accepts `expo-web-browser` 15 (Expo SDK 54)

Every passkey starts without a LazorKit v2 wallet. Signing in never reveals a passkey's public key, so the portal's reply carries the key it has stored: none for a passkey made on another device, and sometimes another passkey's. `connect` refused to create a wallet for a key it could not verify. It failed with "The portal's reply could not be verified against this passkey; nothing was created", or "Unexpected passkey pubkey length: 0" when no key came back. Those passkeys could never get a wallet.

- When the reported key is missing or is not the signer's, `connect` now recovers the passkey's key from two of its signatures over challenges the SDK chose (`resolvePasskeyPublicKey`, `@lazorkit/sdk-legacy` 1.3.0). The signatures are the connect proof and the connect reply's own signature, or one more portal sign when the reply has none. That is one extra passkey prompt (a sign over a random challenge, with no transaction). The wallet is created for the recovered key, and the saved `passkeyPubkey` is that key rather than the reported one.
- Unchanged: a reported key that the connect proof verifies against is used with no extra prompt. Wallet lookup, adoption and the chooser work as before.
- A wallet is still never created for a key that no signature from this connect verifies against. If the user closes the extra prompt, or `disconnect` is called during it, `connect` rejects with `PortalCancelledError`. If the signatures do not settle on one key, it throws an error that says so. In both cases nothing is created.
- Requires `@lazorkit/sdk-legacy` ^1.3.0.
- The `expo-web-browser` dependency is now `^14.2.0 || ^15.0.0`, so an Expo SDK 54 app does not install a second copy. The adapter calls only `openAuthSessionAsync`, `openBrowserAsync` and `dismissBrowser`. Their typings and JavaScript are identical in 14.2.0 and 15.0.11.
