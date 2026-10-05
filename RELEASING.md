# Releasing LazorKit packages

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and
[GitHub Actions](.github/workflows/release.yml) for publishing to npm with
[provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

Publishable packages:

| Package                            | Path                              |
| ---------------------------------- | --------------------------------- |
| `@lazorkit/wallet`                  | `packages/react`                  |
| `@lazorkit/wallet-mobile-adapter`   | `packages/react-native`           |

> Note: folder names reflect the underlying tech (`react` / `react-native`)
> while the published npm names are kept stable to avoid breaking downstream
> consumers. pnpm matches packages by `name` in package.json, not by path.

`@lazorkit/portal` (`app/portal`), `@lazorkit/migrate` (`app/migrate`) and the workspace copy of
`@lazorkit/sdk-legacy` (`packages/program-sdk/legacy`) are private and not published from here.

## One-time setup (maintainers)

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so
there is no `NPM_TOKEN` secret.

1. **npm**: in the settings of each published package, add a GitHub Actions trusted publisher:
   organization `lazor-kit`, repository `lazor-kit`, workflow `release.yml`, environment
   `npm-publish`, with **Allow npm publish** and **Allow npm dist-tag** enabled.
2. **GitHub environment**: create the `npm-publish` environment
   (`Settings → Environments`) with the release maintainers as required reviewers.
3. **Allow GitHub Actions to create PRs**: `Settings → Actions → General → Workflow permissions`
   → enable "Allow GitHub Actions to create and approve pull requests".
4. **Branch protection**: require the `build` checks (CI workflow) to pass on `main`.

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
4. On that merge there are no pending changesets, so the workflow checks npm for package versions
   that are not published yet (`node scripts/npm-release.mjs check`). If every version is already
   on npm, it stops there and asks for no approval.
5. Otherwise the `build` job typechecks, builds, runs each package's `prepublishOnly` and packs the
   tarballs (no npm credentials in that job).
6. The `publish` job waits for a reviewer to approve the `npm-publish` environment, then runs
   `npm publish --provenance` on each tarball with trusted publishing, creates and pushes the
   `@lazorkit/<package>@<version>` tags, creates the GitHub releases, and moves the
   `@lazorkit/wallet` `beta` dist-tag to the new version.

If the `publish` job fails partway, re-run it: versions already on npm are skipped, and the
`beta` dist-tag step is idempotent.

## Manual fallback

If automation is unavailable:

```sh
pnpm install --frozen-lockfile
pnpm --filter @lazorkit/sdk-legacy build
pnpm --filter @lazorkit/wallet build
pnpm --filter @lazorkit/wallet-mobile-adapter build

cd packages/react           # or packages/react-native
npm publish --access public --provenance=false
```

Provenance can only be generated in CI, so a local publish needs `--provenance=false`
(`@lazorkit/wallet` sets `publishConfig.provenance`). You'll need to be logged in (`npm login`)
with publish rights on the `@lazorkit` scope. Afterwards push the
`@lazorkit/<package>@<version>` tag and, for the wallet, run
`npm dist-tag add @lazorkit/wallet@<version> beta`.
