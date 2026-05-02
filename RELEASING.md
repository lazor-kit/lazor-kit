# Releasing LazorKit packages

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and
[GitHub Actions](.github/workflows/release.yml) for publishing to npm with
[provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

Publishable packages:

| Package                            | Path                              |
| ---------------------------------- | --------------------------------- |
| `@lazorkit/react`                  | `packages/react`                  |
| `@lazorkit/react-native`           | `packages/react-native`           |
| `@lazorkit/program-sdk-legacy`     | `packages/program-sdk/legacy`     |

`@lazorkit/portal` (`app/portal`) is private and not published.

## One-time setup (maintainers)

1. **npm**: create an automation token with publish access for the `@lazorkit` scope and add it to
   the GitHub repo as the `NPM_TOKEN` secret (`Settings → Secrets and variables → Actions`).
2. **Branch protection**: require the `build` checks (CI workflow) to pass on `main`.
3. **Allow GitHub Actions to create PRs**: `Settings → Actions → General → Workflow permissions`
   → enable "Allow GitHub Actions to create and approve pull requests".

## Day-to-day

When you make a user-facing change to any publishable package, run:

```sh
pnpm changeset
```

Pick the package(s), choose `patch` / `minor` / `major`, and write a short summary. Commit the
generated `.changeset/*.md` along with your code. Skip changesets for non-shipping changes
(internal refactors, CI, examples, docs).

## How a release happens

1. PRs land on `main` carrying `.changeset/*.md` files.
2. The Release workflow opens (or updates) a **"chore(release): version packages"** PR that:
   - bumps the relevant `packages/*/package.json` versions,
   - regenerates each package's `CHANGELOG.md`,
   - deletes consumed changesets.
3. A maintainer reviews the version bump and merges that PR.
4. On merge, the same workflow runs `pnpm release`, which builds all publishable packages and
   runs `changeset publish` → npm publish with `--provenance`.

## Manual fallback

If automation is unavailable:

```sh
pnpm install --frozen-lockfile
pnpm --filter @lazorkit/program-sdk-legacy build
pnpm --filter @lazorkit/react build
pnpm --filter @lazorkit/react-native build

cd packages/react           # or another publishable package
npm publish --access public --provenance
```

You'll need to be logged in (`npm login`) with publish rights on the `@lazorkit` scope.
