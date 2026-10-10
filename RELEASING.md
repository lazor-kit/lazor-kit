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
   (`Settings → Environments`) with the release maintainers as required reviewers, and under
   **Deployment branches and tags** allow only the `main` branch, so a workflow run from another
   branch cannot get an npm token.
3. **Allow GitHub Actions to create PRs**: `Settings → Actions → General → Workflow permissions`
   → enable "Allow GitHub Actions to create and approve pull requests".
4. **Branch protection**: require the `build` checks (CI workflow) to pass on `main`.
5. **Check the setup before the first release**: `Actions → Release → Run workflow` on `main`.
   A manual run only runs the `trusted-publishing-check` job: after you approve `npm-publish`,
   it runs `npm publish --dry-run` on the latest published version of each package, which makes
   npm exchange the job's OIDC token for a publish token and then stop, because that version
   already exists. The job fails if the exchange fails for either package. Nothing is published,
   and the `beta` dist-tag permission is only exercised by a real release.

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
4. On that merge there are no pending changesets, so the workflow checks each package version
   (`node scripts/npm-release.mjs check`): is it on npm, and is its
   `@lazorkit/<package>@<version>` tag on GitHub? If every version is both, it stops there and
   asks for no approval.
5. Otherwise the `build` job typechecks, builds, runs each package's `prepublishOnly` and packs the
   tarballs (no npm credentials in that job).
6. The `publish` job waits for a reviewer to approve the `npm-publish` environment, then runs
   `npm publish --provenance` on each tarball that is not on npm yet, with trusted publishing.
   For each version that is on npm but not tagged it creates and pushes the
   `@lazorkit/<package>@<version>` tag and creates the GitHub release. Finally it moves the
   `@lazorkit/wallet` `beta` dist-tag to the new version.

If the `publish` job fails partway, re-run the failed jobs: versions already on npm are not
published again, versions on npm without a tag get their tag and GitHub release, and the `beta`
dist-tag step is idempotent. If nobody re-runs it, the next push to `main` finds the untagged
version and does the same, but the tag then points at that later commit. The one case neither
repairs is a tag that was pushed but whose GitHub release failed; create that release by hand
from the package's `CHANGELOG.md` entry.

An approval request is only made when something is left to publish or tag. If two pushes land
on `main` while a publish waits for approval, the second one may ask again once the first is
done; approving it is harmless (it finds everything published and tagged), or reject it.

## Pre-releases

Changesets [pre mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)
publishes a line ahead of `latest`. `pnpm changeset pre enter <tag>` commits
`.changeset/pre.json`; while it is there, the version PR makes `X.Y.Z-<tag>.N` versions and
`scripts/npm-release.mjs publish` passes `--tag <tag>`, so `latest` does not move, and
`sync-dist-tags` leaves the wallet's `beta` on the latest stable version. Each later merge with
changesets makes the next `-<tag>.N`. `pnpm changeset pre exit` (committed and merged like any
change) makes the next version PR produce the stable versions, published on `latest`.

While `main` is in pre mode, every release from `main` is a pre-release. A fix for the current
stable line then needs the manual fallback below (from a branch off its release tag), or waits
for `pre exit`.

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
