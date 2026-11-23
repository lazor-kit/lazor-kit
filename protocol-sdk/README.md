# Protocol v1 SDK staging

This private-package workspace builds and tests the Protocol v1 React and React
Native adapters with the pinned Protocol SDK RC. The wallet packages at the
monorepo root use the public dependencies and release workflow on main.

GitHub Actions restores the RC on `staging/protocol-v1-sdk-rc`. For local
development, place an approved copy of that same tarball in
`.ci/protocol-rc/lazorkit-sdk-legacy-0.4.0-rc.3.tgz` in this workspace.
The lockfile pins the tarball integrity.

Run the checks from this directory with Node 22.

```sh
pnpm install --frozen-lockfile
node scripts/check-txv1-identical.mjs
pnpm --filter @lazorkit/wallet typecheck
pnpm --filter @lazorkit/wallet build
pnpm --filter @lazorkit/wallet-mobile-adapter build
pnpm --filter @lazorkit/wallet test
pnpm --filter @lazorkit/wallet-mobile-adapter test
pnpm --filter txv1-oracle test
```
