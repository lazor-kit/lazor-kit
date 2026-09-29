---
'@lazorkit/wallet': patch
---

Declare `@solana/web3.js` ^1.99.0 as the peer range, the floor the wallet's own peer set already needs: `@solana/wallet-adapter-base` ^0.9.27 now resolves to 0.9.28, which requires `@solana/web3.js` ^1.99.0. An app that pins `@solana/web3.js` 1.98.x gets `npm ERESOLVE` installing the wallet either way. Move it to 1.99 (a minor release of 1.x), or install `@solana/wallet-adapter-base` 0.9.27 explicitly. Apps on a `^1.98` range resolve to 1.99 and are unaffected.
