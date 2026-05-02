# LazorKit

Passkey-native smart wallets on Solana. Users sign with FaceID / TouchID / Windows Hello, the paymaster covers gas, and on-chain RBAC + spending limits decide what actually goes through.

> [!CAUTION]
> Pre-audit. Do not use in production.

## What's in here

```
packages/
  react/                  → @lazorkit/wallet                (web SDK)
  react-native/           → @lazorkit/wallet-mobile-adapter (RN / Expo)
  program-sdk/legacy/     → @lazorkit/sdk-legacy            (web3.js v1 client)
app/
  docs/                   → docs site (Next.js / Fumadocs)
  portal/                 → @lazorkit/portal — WebAuthn portal, private
examples/
  expo-react-native/      → Expo example for the RN adapter
  squads-passkey-wallet/  → Squads multisig signed by a passkey wallet
program/                  → submodule → lazor-kit/program-v2 (Pinochio)
```

The folder names are `react` / `react-native` because that's the underlying tech; the npm names (`@lazorkit/wallet`, `@lazorkit/wallet-mobile-adapter`) stay stable so we don't break consumers. pnpm matches by `name`, not path, so this doesn't matter day to day.

## Setup

You'll need Node ≥ 18 and pnpm. The repo pins `pnpm@10.33.2`, install via Corepack or `npm i -g pnpm` if you don't have it.

```bash
git clone --recurse-submodules https://github.com/lazor-kit/lazor-kit.git
cd lazor-kit
pnpm install
```

If you forgot `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## Common commands

Workspace-wide (uses `pnpm -r` under the hood):

```bash
pnpm build        # build every publishable package
pnpm dev          # rollup --watch wherever there's a dev script
pnpm typecheck    # tsc --noEmit
pnpm clean        # nuke all dist/
```

Single package:

```bash
pnpm --filter @lazorkit/wallet build
pnpm --filter @lazorkit/wallet-mobile-adapter dev
pnpm --filter @lazorkit/sdk-legacy build
```

Apps:

```bash
pnpm --filter docs dev          # docs site, http://localhost:3000
pnpm --filter @lazorkit/portal dev   # WebAuthn portal
cd demo && pnpm install && pnpm dev  # web demo (its own lockfile)
```

The docs site, demo, and `examples/*` each have their own lockfile and consume the workspace packages via `link:` — that's why they aren't in `pnpm-workspace.yaml`.

## Examples

The Expo examples still use yarn (Expo's default). Build the package first, then run the example:

```bash
pnpm --filter @lazorkit/wallet-mobile-adapter build

cd examples/expo-react-native
yarn install
yarn ios       # or android / web
```

Same flow for `examples/squads-passkey-wallet`.

## Working on the program

The Anchor program is a submodule pointing at [`lazor-kit/program-v2`](https://github.com/lazor-kit/program-v2). Cd into it and follow its own `DEVELOPMENT.md`:

```bash
cd program
cat DEVELOPMENT.md
```

The program is deployed under two cluster-specific IDs — the table is in [`packages/program-sdk/legacy/README.md`](./packages/program-sdk/legacy/README.md#cluster--program-ids).

## Releasing

Changesets + GitHub Actions. Short version:

```bash
pnpm changeset      # when you make a user-facing SDK change
git commit -am "feat: ..."   # commit your code + the .changeset/*.md
```

The release workflow opens a "version packages" PR; merging it publishes to npm with provenance. Full instructions in [RELEASING.md](./RELEASING.md).

## Contributing

Fork → branch → PR against `main`. Add a changeset for any user-visible SDK change, skip it for refactors / CI / docs / examples. Protocol-level work goes against the upstream [`lazor-kit/program-v2`](https://github.com/lazor-kit/program-v2) repo, not the submodule here.

## Links

- Docs: [`app/docs`](./app/docs)
- GitHub: [github.com/lazor-kit](https://github.com/lazor-kit)
- Telegram: [t.me/lazorkit](https://t.me/lazorkit)
- Twitter: [@lazorkit](https://twitter.com/lazorkit)

MIT — see [LICENSE](./LICENSE).
