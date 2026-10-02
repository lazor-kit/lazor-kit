---
"@lazorkit/wallet": patch
---

Security: the sign dialog sends the stored credentials to the portal's origin only.

When the sign dialog opened, `DialogManager` posted the stored credential id, passkey public key and wallet address (`SYNC_CREDENTIALS`) to its iframe with `postMessage(message, '*')`, six times over three seconds. `'*'` delivers to whatever page the iframe shows at that moment: a portal page that navigated or redirected the frame elsewhere handed them to that page. They are now addressed to the origin of `portalUrl`, so the browser delivers them only while the iframe shows a page of the portal's origin, and drops them otherwise. A `portalUrl` with no origin to address (not an absolute URL, or an opaque origin) sends nothing. No change for a portal that stays on its own origin: its replies were already accepted from that origin only.

Fixes code-scanning alert `js/cross-window-information-leak` (`CredentialManager.ts`).
