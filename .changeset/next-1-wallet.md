---
'@lazorkit/wallet': minor
---

- `useSessions()`, `useAuthorities()` and `useDeferred()` in `@lazorkit/wallet/hooks`: the session, authority and deferred actions with `useWallet()`'s names and parameters, without its deprecation warning. The warnings on `useWallet().createSession` and the others now name hooks that exist.
- **Fixed:** each portal dialog left a window `message` listener behind (one per action, for the page's life); `destroy()` removes it.
- **Fixed:** portal mode's storage is guarded where storage is denied (Safari "Block All Cookies", some privacy browsers, sandboxed embeds): saving, reading and clearing the wallet record, the credential sync and the legacy cleanup no longer throw, so connect works for the page and `disconnect` always resets the state.
- Docs: `verifyWalletMessage` on a server is imported from `@lazorkit/wallet/core` (the root is a client module, and fails at runtime in a Next.js route).
