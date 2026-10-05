---
"@lazorkit/wallet": patch
---

`signMessage` with bytes that start with a UTF-8 byte order mark (EF BB BF) now sends a `displayMessage` that keeps the BOM (`ignoreBOM: true`), so the text the portal shows encodes back to exactly the signed bytes. Before, the BOM was dropped from the text, and a portal that recomputes the challenge from what it shows refused the request. Strings were not affected.
