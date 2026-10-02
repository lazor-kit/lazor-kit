---
'@lazorkit/wallet': minor
---

Security: session and authority keys are no longer kept in localStorage as plaintext

3.2.1 wrote the 64-byte secret key of every session key `createSession` generated, and of every authority key `addAuthority` generated, to localStorage as a JSON number array (`lazorkit-session`, `lazorkit-authority`). Any script on the page, a browser extension, a session-replay tool or a look at dev tools could copy it, and `addAuthority`'s key is an Admin by default, with no spending policy and no expiry.

- The SDK now keeps such a key as a non-extractable WebCrypto Ed25519 key in IndexedDB (`lazorkit-keys`), which signs with `crypto.subtle` and whose secret never reaches JavaScript. Where the browser has no WebCrypto Ed25519 (iOS 16, Chrome 136 and older), the seed is sealed with AES-GCM under a non-extractable key in the same database, and moved to a non-extractable Ed25519 key once the browser has one. Without IndexedDB, or outside a secure context, the key is kept in the page's memory and is gone on reload. Nothing is written in the clear.
- Migration: a plaintext key an earlier release left is moved when `LazorkitProvider` mounts, or on its first use, and the plaintext is deleted once the move has committed. A move that fails leaves the plaintext, which is tried again on the next use. An entry the SDK did not write is left untouched.
- New `LazorkitProvider` prop and `WalletConfig` field `keyStorage: 'auto' | 'memory'`. The default is `'auto'`. `'memory'` keeps nothing at rest.
- A key that cannot be stored after its session or authority landed is kept in the page's memory and signs until the page reloads. The call succeeds, and a warning is logged. (In 3.2.1 a localStorage quota or `SecurityError` at that point called `onFail` for a transaction that had landed.)
- `revokeSession()` deletes the kept session key once the revoke lands, whether or not the session was passed by PDA. `removeAuthority` deletes the kept authority key when it removes that authority; 3.2.1 never deleted it.
- A key passed as `createSession({ sessionKey })` is still never stored.
- Signatures: where WebCrypto signs deterministically, as RFC 8032 specifies (Chromium, Node), a kept key signs exactly as web3.js's `Keypair` does with the same seed. Safari's signatures use a random nonce and are equally valid.
- Fix: the portal dialog no longer leaves a timer polling every 500 ms for the rest of the page's life when a sign request is answered or closed within its first half second.

Minor rather than patch: there is a new optional prop, and the migration is one-way. After it, 3.2.1 or earlier finds no key ("No session key found. Create a session first."), and the user creates a new session. No exported API changes shape. No exported API ever returned the secret key; the JSDoc did say it was kept in localStorage.
