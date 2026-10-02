---
'@lazorkit/wallet-mobile-adapter': patch
---

Docs: the adapter stores no session key, and how to keep one

No runtime change. The adapter never generated or stored a session key: `createSession` registers the public key your app passes, `signAndSendWithSession` signs with the `Keypair` you hand it, and AsyncStorage holds only the wallet's public record, the configuration and each passkey's transaction state. A new test checks that nothing the adapter persists holds a session key's secret.

- README, new section "Session keys": keep the key in the OS keystore with `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in AsyncStorage; delete it once its session is revoked or expired; an iOS Keychain item survives an uninstall; exclude it from Android Auto Backup.
- The JSDoc of `SessionSignPayload.sessionKeypair` and `CreateSessionPayload.sessionKey` says the same.

Patch: README and type documentation only, published so that integrators see them in the package.
