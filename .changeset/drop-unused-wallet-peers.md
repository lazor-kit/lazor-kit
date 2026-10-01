---
'@lazorkit/wallet': patch
---

Drop the unused peer dependencies `@solana/kit` ^5, `@solana/kora` ^0.1 and `@solana-program/token` ^0.9, so the wallet installs next to `@solana/kit` 8

Nothing in the wallet imports them; the published bundle and its types are unchanged. They were carried over from an older adapter. Because npm installs peers, an app on `@solana/kit` 8 (or 6 or 7) could not install the wallet: `npm install` failed with `ERESOLVE` (`peer @solana/kit@"^5.0" from @solana-program/token@0.9.0`) unless run with `--legacy-peer-deps`. An app without `@solana/kit` got kit 5, Kora and the token program installed for nothing (111 packages instead of 72).
