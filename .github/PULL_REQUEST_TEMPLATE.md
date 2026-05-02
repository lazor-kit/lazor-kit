## Summary

<!-- Briefly describe what this PR changes and why. -->

## Changes

<!-- Bullet list of notable changes. Note any breaking changes. -->

## Changeset

If this PR changes user-facing behavior of `@lazorkit/wallet`, run:

```sh
pnpm changeset
```

…and commit the generated `.changeset/*.md` file. Skip for internal-only changes (CI, examples,
docs, refactors with no API impact).

## Test plan

- [ ] `pnpm --filter @lazorkit/wallet typecheck`
- [ ] `pnpm --filter @lazorkit/wallet build`
- [ ] Manually verified in `demo/` or `examples/expo-react-native/`
