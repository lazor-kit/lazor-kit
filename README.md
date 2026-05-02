# LazorKit

> [!CAUTION]
> **Pre-audit. Do not use in production.**

LazorKit is the **execution layer** for Solana — passkey-native smart wallets, scoped session keys, and sponsored gas, sitting between your users (or agents) and the chain. Users sign with **FaceID / TouchID / Windows Hello**; apps sponsor gas through the paymaster; on-chain RBAC + action constraints govern who can do what.

- **Seedless onboarding** — WebAuthn passkeys, no seed phrase
- **Sponsored gas** — Kora paymaster sponsors every mutation
- **Programmable accounts** — vault + authority PDAs, owner / admin / spender roles
- **Scoped delegation** — session keys with on-chain spending limits
- **Deferred execution** — 2-tx flow for payloads that don't fit a single Secp256r1 tx

Live on Solana. Reference products: **[seedless.lazorkit.xyz](https://seedless.lazorkit.xyz)** and **[session.money](https://session.money)**.

Documentation: **[lazorkit docs site](./app/docs)** (Fumadocs source) — covers the protocol, every SDK, and troubleshooting.

---

## Repository layout

This is a pnpm monorepo. The Solana program lives in a git submodule.

```
lazor-kit/
├── packages/
│   ├── react/              → @lazorkit/wallet                (web SDK — React + WebAuthn)
│   ├── react-native/       → @lazorkit/wallet-mobile-adapter (React Native / Expo)
│   └── program-sdk/
│       └── legacy/         → @lazorkit/sdk-legacy            (web3.js v1 contract SDK)
├── app/
│   ├── docs/               → Fumadocs documentation site (Next.js)
│   └── portal/             → @lazorkit/portal — WebAuthn portal (private)
├── examples/
│   ├── expo-react-native/  → Expo example using @lazorkit/wallet-mobile-adapter
│   └── squads-passkey-wallet/ → Squads multisig + passkey example
├── demo/                   → Vite/React demo of @lazorkit/wallet
└── program/                → git submodule: lazor-kit/program-v2 (Anchor smart contract)
```

### Published packages

| npm package                       | Path                          | Purpose                                                          |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `@lazorkit/wallet`                | `packages/react`              | React provider + `useWallet` hook (browser WebAuthn).            |
| `@lazorkit/wallet-mobile-adapter` | `packages/react-native`       | React Native / Expo adapter (portal-driven WebAuthn).            |
| `@lazorkit/sdk-legacy`            | `packages/program-sdk/legacy` | Hand-written `LazorKitClient` for `@solana/web3.js` v1.          |

> Folder names track the underlying tech (`react` / `react-native`); npm package names are kept stable so downstream consumers don't break. pnpm matches by `name` in `package.json`, not by path.

---

## Getting started

### Prerequisites

- **Node** ≥ 18, **pnpm** ≥ 9 (this repo pins `pnpm@10.33.2` via `packageManager`)
- **Git** with submodule support (the Anchor program is a submodule)

### Clone (with the program submodule)

```bash
git clone --recurse-submodules https://github.com/lazor-kit/lazor-kit.git
cd lazor-kit
```

Already cloned without submodules?

```bash
git submodule update --init --recursive
```

### Install

```bash
pnpm install
```

### Build all publishable packages

```bash
pnpm build
```

Other workspace-wide scripts:

```bash
pnpm dev           # rollup --watch in every package that has a dev script
pnpm typecheck     # tsc --noEmit across the workspace
pnpm clean         # remove every dist/
```

### Build or watch a single package

```bash
pnpm --filter @lazorkit/wallet build
pnpm --filter @lazorkit/wallet-mobile-adapter dev
pnpm --filter @lazorkit/sdk-legacy build
```

### Run an app

```bash
# Documentation site (Fumadocs / Next.js)
pnpm --filter docs dev

# WebAuthn portal (Vite/React) — private, used by the SDKs
pnpm --filter @lazorkit/portal dev

# Local demo of @lazorkit/wallet (Vite/React)
cd demo && pnpm install && pnpm dev
```

### Run an example

The example apps under `examples/` use yarn locally (Expo's default) and `link:` to the built workspace packages. Build the package first, then run the example.

```bash
pnpm --filter @lazorkit/wallet-mobile-adapter build

cd examples/expo-react-native
yarn install
yarn ios     # or yarn android / yarn web
```

---

## Development workflow

The publishable packages (`packages/react`, `packages/react-native`, `packages/program-sdk/legacy`) and `app/portal` are wired into the pnpm workspace (see [`pnpm-workspace.yaml`](./pnpm-workspace.yaml)). The docs site, demo, and examples each have their own lockfile — they consume the workspace packages via `link:` references.

To work on the smart contract, enter the submodule and follow its own `DEVELOPMENT.md`:

```bash
cd program
cat DEVELOPMENT.md
```

The program is deployed at two cluster-specific IDs — see [`packages/program-sdk/legacy/README.md`](./packages/program-sdk/legacy/README.md#cluster--program-ids) for the table.

---

## Releasing

Versioning and npm publishing are driven by [Changesets](https://github.com/changesets/changesets) and the [release workflow](./.github/workflows). End-to-end instructions: [RELEASING.md](./RELEASING.md).

Day-to-day:

```bash
pnpm changeset       # describe the change
git commit -am "feat: ..."  # commit your code + the generated .changeset/*.md
```

The release workflow opens a "version packages" PR; merging it publishes to npm with provenance.

---

## Contributing

1. Fork the repository
2. Create a feature branch — `git checkout -b feature/your-feature`
3. Make your changes and add a changeset for any user-facing SDK change (`pnpm changeset`)
4. Open a PR against `main`

For protocol-level work, contribute against the `program` submodule's upstream repo: [`lazor-kit/program-v2`](https://github.com/lazor-kit/program-v2).

---

## Resources

- **Documentation** — [`app/docs`](./app/docs) (or browse rendered at the deployed site)
- **GitHub** — [github.com/lazor-kit](https://github.com/lazor-kit)
- **Telegram** — [t.me/lazorkit](https://t.me/lazorkit)
- **Twitter** — [@lazorkit](https://twitter.com/lazorkit)

## License

MIT — see [LICENSE](./LICENSE).
