# Proposed Repository Structure (Multi-Repo Friendly)

This document captures a suggested split of the current monorepo into a set of
focused repositories. The intent is to make it easier to publish and iterate on
each surface area independently while still allowing them to collaborate as a
cohesive Lazor Kit project.

## Goals

- Reduce coupling between deliverables so that SDK, portal, on-chain program and
documentation can evolve on their own cadence.
- Clarify ownership, release cycle and dependency boundaries.
- Keep local development productive by documenting how to pull the related
repositories together when required.

## Recommended Repositories

| Repository | Purpose | Primary Tech | Notes |
| --- | --- | --- | --- |
| `lazor-wallet-sdk` | Browser & mobile SDK published to npm. | TypeScript, Zustand, Solana web3.js | Ships React hooks and smart-wallet client. Mirrors the current `packages/wallet` content. |
| `lazor-portal` | Hosted passkey portal application that pairs with the SDK. | React 19, Vite, Tailwind | Provides the iframe/popup UI and WebAuthn messaging bridge. |
| `lazor-program` | Anchor smart contract and generated IDL. | Rust, Anchor | Produces on-chain artifacts and TypeScript IDL clients. |
| `lazor-docs` | Public documentation site. | Vocs | Hosts the docs currently under `packages/docs`. |
| `lazor-examples` | Sample applications (React Native, web). | Expo, React Native | Aggregates example integrations currently under `example/`. |

Each repository would become independent with its own `package.json` (where
applicable), build scripts and release pipeline.

## Cross-Repository Contracts

1. **IDL & Type Definitions**: `lazor-program` exports the generated IDL package
   (`idl/` + TypeScript types). `lazor-wallet-sdk` depends on published versions
   instead of sibling imports.
2. **Portal Messaging**: Shared message schemas are published from the SDK repo
   (or a dedicated `lazor-shared` package) and imported by the portal to avoid
drift.
3. **Documentation**: `lazor-docs` consumes published packages (SDK, portal) as
   dependencies when generating API references; it should not reach into source
   of other repositories directly.
4. **Examples**: Example apps depend on released npm packages (`lazor-wallet-sdk`,
   `@lazorkit/portal`) and tagged program IDs.

## Development Workflow

- Use a meta-repo or `pnpm workspaces` only for local convenience when needing
  to work on multiple pieces simultaneously. Document how to clone the related
  repositories side-by-side and use `pnpm link` or `npm link` as needed.
- Provide Docker Compose or task runner scripts in `lazor-examples` to spin up
the portal locally while pointing to a local SDK build.

## Migration Steps

1. Extract each package into its own Git repository, preserving history with
   `git filter-repo` or `git subtree split`.
2. Trim the root `package.json` so it only contains shared tooling (linting,
   formatting) or remove it once each repo is standalone.
3. Update CI pipelines per repository (build, lint, test, release).
4. Publish new npm packages scoped appropriately (`@lazorkit/*`).
5. Update documentation and README links to point to the new repositories.

## Open Questions

- Should we keep a lightweight meta repo that aggregates all repos via Git
  submodules for onboarding convenience?
- How do we version shared message schemas across SDK and portal—dedicated
  package or rely on semver compatibility guarantees?

Documenting these decisions early will make the transition smoother for future
contributors and maintainers.
