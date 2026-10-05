# txv1-oracle

A private workspace package (never published) that holds the wallets' SIMD-0385 v1 writer to
`@solana/kit` 8.4.0 and `@solana/web3.js` 1.99.0. kit is a test oracle only: nothing in the wallets
depends on it. Needs Node 20.18 or later.

The writer is `packages/react/core/wallet/txv1.ts`, with a byte-identical copy in
`packages/react-native/src/core/wallet/txv1.ts` (`node scripts/check-txv1-identical.mjs`).

| Command | What it does |
|---|---|
| `pnpm --filter txv1-oracle test` | The vectors test and the 10,000-case differential (about 2 minutes) |
| `node scripts/txv1-vectors.mjs` | Regenerates `test-vectors/txv1.json`, checking each vector against kit and web3.js |
| `node scripts/txv1-vectors.mjs --check` | Fails if the committed vectors are not exactly what the generator makes |
| `TXV1_SEED=<n> TXV1_CASES=<n> node --test test/differential.test.mjs` | Reruns the differential with another seed or size |

What the tests check:

- **Vectors** (`test/vectors.test.mjs`). The committed vectors are exactly what the generator makes,
  so every vector is re-checked against kit and web3.js. Every landed devnet transaction in the
  file is authentic (its id and every signature verify). The writer re-encodes each one with the
  same size and the same meaning, as kit decodes it.
- **Differential, U11** (`test/differential.test.mjs`). It builds 10,000 seeded random messages:
  1–13 signers, up to 65 addresses and 65 instructions, account roles mixed and merged, up to 4.4 KB
  of data, and random configs including a full-range u64 priority fee. For each one:
  - `fits`, the first limit broken and the size agree with kit's compile limits and size;
  - kit decodes exactly the components web3.js compiled, and re-encodes them to the same bytes;
  - the decompiled meaning is the input's;
  - web3.js reads back version 1 with the same keys, instructions and config;
  - the signatures verify, sit in their signers' slots, and equal kit's `partiallySignTransaction`.

  The seed is printed, so a failure can be reproduced.

`src/` holds the shared pieces: `writer.mjs` (loads the TypeScript writer through
`transpileModule`), `keys.mjs` (deterministic test keys and the seeded generator), `oracle.mjs`
(the cross-checks) and `vectors.mjs` (the vector file).
