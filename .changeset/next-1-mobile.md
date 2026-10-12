---
'@lazorkit/wallet-mobile-adapter': minor
---

- **The browser trip is bounded:** `browserOptions.timeoutMs` (default 2 minutes; at least 10 for a typed approval). A trip that never comes back closes the browser and rejects with `PortalTimeoutError` (`describeError`: "Couldn't open the approval page"). Connect hung for over 4 minutes when iOS never opened the ownership-proof session: `expo-web-browser` ignores an `ASWebAuthenticationSession` that fails to start. The adapter also waits for the last session to be gone before it opens the next.
- **iOS: one trip to create a wallet.** A passkey the portal registered just now (`kind=created`), whose reply came back through the authentication session (which no other app can answer), gets its wallet with no second trip for an ownership proof. A deep-link reply (Android) is still proven first.
- **iOS: `browserOptions.preferEphemeralSession`, default `true`:** no "wants to use … to sign in" alert before each approval. The session shares no cookies with Safari, which the portal does not need. `false` restores a shared session.
- Docs: `rpId` must be set for a portal other than `portal.lazor.sh` (a local one); Xcode 27 with Expo 54 needs every pod at iOS 15.1 or later (a config plugin in the README) and `LANG=en_US.UTF-8` for `pod install`; `verifyWalletMessage` on a server comes from `@lazorkit/wallet/core`.
