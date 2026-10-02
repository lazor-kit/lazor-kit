---
'@lazorkit/wallet-mobile-adapter': patch
---

**Security:** domain-separated passkey challenges for messages and ownership proofs

Message signatures are now domain-separated from every other passkey challenge. `signMessage` signs a fixed-format challenge, never the app's bytes, the same as `@lazorkit/wallet`'s:

```
challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"   (58 bytes)
```

Connect's ownership proofs get their own tag too: `UTF-8 "LazorKit ownership proof v1" || 32 random bytes` (59 bytes), from `createOwnershipChallenge()`. `verifyOwnershipProof` accepts it unchanged. A transaction challenge is a 32-byte hash, so no challenge of one kind can be another.

- The portal gets the message challenge as `message` and the text as `displayMessage`. The adapter refuses a redirect over any other challenge.
- `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs.
- New: `verifyWalletMessage` checks that a wallet signed a message, with the passkey's key read from the chain, never taken from the client. `verifySignedMessage` is its offline part, for a key you read from chain yourself. Also `signedMessageChallenge`, `SIGNED_MESSAGE_DOMAIN` and `OWNERSHIP_PROOF_DOMAIN`.
- Fixes `signMessage` signing the base64 decoding of the text instead of the text.

A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).
