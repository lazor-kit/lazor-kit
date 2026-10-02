---
'@lazorkit/wallet-mobile-adapter': patch
---

**Security:** `signMessage` signs a domain-separated challenge, never the app's bytes

`signMessage` passed the message to the passkey as its WebAuthn challenge. The LazorKit programs approve a transaction by the challenge a passkey signed, so a message signature must never be usable as anything else the passkey approves. It now signs a fixed-format challenge instead, the same as `@lazorkit/wallet`'s:

```
challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"
```

It is 58 bytes and starts with the tag; every transaction challenge the programs accept, and every other challenge the adapter asks for, is 32 bytes.

- The portal gets the challenge as `message` and the text as `displayMessage`. The adapter refuses a redirect over any other challenge.
- `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs.
- New exports: `verifySignedMessage` (checks a message signature offline, in the app or on a server), `signedMessageChallenge` and `SIGNED_MESSAGE_DOMAIN`.
- Fixes `signMessage` signing the base64 decoding of the text instead of the text.

A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).
