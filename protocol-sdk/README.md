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

## Kora integration on localnet

Use Node 22, Rust with `rustup` and Agave 4.3.0. Build the mobile adapter
after the frozen install above, then supply the approved local SBF binaries
for the baseline and hardened Protocol v1 programs.

```sh
pnpm --filter @lazorkit/wallet-mobile-adapter build
pnpm staging:kora /path/to/v1-baseline.so /path/to/v1-hardened.so
```

The runner fetches the pinned Kora upstream commit
`938b9b26be9a991b0ca591d9b20a8a945843915f` and builds it with its lockfile
and Rust toolchain. It starts a disposable validator and authenticated Kora
process. The test harness calls both over loopback with generated keys.

The built React Native adapter uses a scripted passkey and a six-decimal USDC
test mint. Both Protocol binaries run the test with the same wallet and 0 SOL.
Kora must reject a missing fee, then confirm a transaction v1 with direct
`Execute` and a `TransferChecked` CPI from the vault to the sponsor's ATA.
The validator confirms that Kora paid the SOL network fee and received the
expected token amount. Each process stops after the test and the runner prints
the temporary log directory.
