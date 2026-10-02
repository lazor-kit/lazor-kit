---
'@lazorkit/wallet': patch
---

**Security:** `signMessage` signs a domain-separated challenge, never the app's bytes

`signMessage` on the hook and the store, `LazorkitWalletAdapter.signMessage` and the Wallet Standard `solana:signMessage` passed the message, or bytes derived from it, to the passkey as its WebAuthn challenge. The LazorKit programs approve a transaction by the challenge a passkey signed, so a message signature must never be usable as anything else the passkey approves. Every path now signs a fixed-format challenge instead:

```
challenge = tag || SHA-256(tag || message),  tag = UTF-8 "LazorKit signed message v1"
```

It is 58 bytes and starts with the tag; every transaction challenge the programs accept, and every other challenge the SDK asks for, is 32 bytes.

- The portal gets the challenge as `message` and the text to show as `displayMessage`. The SDK refuses a portal reply over any other challenge.
- `signMessage` resolves with `SignMessageResult`: `signature` and `signedPayload` as before, plus `clientDataJsonBase64` and `authenticatorDataBase64`, which a verifier needs. The adapter's and the Wallet Standard `signature` stay JSON bytes, now with the same four fields.
- New exports: `verifySignedMessage` (checks a message signature offline, in a browser or on a server), `signedMessageChallenge` and `SIGNED_MESSAGE_DOMAIN`. `useWallet().verifyMessage` is deprecated: it checks only the signature over `signedPayload`, not which message was signed.
- Fixes the hook's `signMessage`, which signed the base64 decoding of the text instead of the text.

A message signature made by an earlier release does not verify with `verifySignedMessage`; sign it again. New dependency: `@noble/curves` (already a dependency of `@solana/web3.js`).
