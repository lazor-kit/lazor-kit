---
'@lazorkit/wallet': patch
---

**Security:** domain-separated passkey challenges for messages and ownership proofs

Message signatures are now domain-separated from every other passkey challenge. `signMessage` on the hook and the store, `LazorkitWalletAdapter.signMessage` and the Wallet Standard `solana:signMessage` sign a fixed-format challenge, never the app's bytes:

```
challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"   (58 bytes)
```

Connect's ownership proofs get their own tag too: `createOwnershipChallenge()` now returns `UTF-8 "LazorKit ownership proof v1" || 32 random bytes` (59 bytes). `verifyOwnershipProof` accepts it unchanged. A transaction challenge is a 32-byte hash, so no challenge of one kind can be another.

- The portal gets the message challenge as `message` and the text to show as `displayMessage`. The SDK refuses a portal reply over any other challenge.
- `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs. The adapter's and the Wallet Standard `signature` stay JSON bytes, now with the same four fields.
- New: `verifyWalletMessage` checks that a wallet signed a message, with the passkey's key read from the chain (the wallet's Owner authority for the credential), never taken from the client. `verifySignedMessage` is its offline part, for a key you read from chain yourself. Also `signedMessageChallenge`, `SIGNED_MESSAGE_DOMAIN` and `OWNERSHIP_PROOF_DOMAIN`.
- Deprecated: `useWallet().verifyMessage` and `verifySignatureBrowser`. They check only that `signature` is over `signedPayload`, not which message was signed; do not use them for authentication.
- `DialogManager.openSign` and the `challenge` option of `openConnect` are documented as internal: pass them only challenges the SDK computed.
- Fixes the hook's `signMessage`, which signed the base64 decoding of the text instead of the text.

A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).
