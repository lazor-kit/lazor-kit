---
'@lazorkit/wallet': major
'@lazorkit/wallet-mobile-adapter': major
---

Speak protocol v2, by depending on `@lazorkit/sdk-legacy` 1.x instead of a vendored copy of it

Both packages carried their own fork of the protocol layer, and the two forks were byte-identical to each other in 11 files. Under protocol v2 they were wrong in six independent ways, any one of which is fatal: un-namespaced PDA seeds, an accounts hash that does not bind signer/writable flags, raw account index bytes with no forward-signer bit, an `AddAuthority` payload with no `[policy_len][policy]` field, a read-only wallet account on Owner changes, and an optional protocol-fee suffix the program now requires. A seventh, `readAuthorityPubkey` pinned to the v1 account discriminator, would have broken every passkey signature.

Rather than reproduce that diff twice by hand, both packages now delegate to `@lazorkit/sdk-legacy` 1.x, which is the implementation the protocol repo's validator suites cover. A thin compatibility layer keeps the call shape these packages have always had, where `programId` is optional and defaults to `PROGRAM_ID`.

**v1 and v2 side by side.** LazorKit v2 runs at its own program id (`LazorFroiVuAjcwwQ2me83vTr5nc5NRxSaTg3pmEXC8` on mainnet); v1 keeps `LazorjRF…` until it is retired to a binary that only lets wallets migrate out. Apps have users on both, so this release routes by the wallet rather than by a global program id:

- `connect` finds the passkey's own wallet on either protocol. A user who signed up before v2 keeps their v1 wallet and everything works as before; only a passkey that owns neither gets a new wallet, on v2. It never creates a v2 wallet for a v1 user, which would show them an empty account while their funds sit in the v1 one.
- **"Own" is proven, not looked up.** The credential-id hash is public and `CreateWallet`/`AddAuthority` take any owner without consent, so anyone can make a wallet that lists a victim's passkey next to their own key. `connect` only adopts an Owner-rank wallet created for this portal's relying party whose stored key matches the key the portal reports — and when the portal reports none (signing in with an existing passkey on a new device), it asks the passkey to sign one challenge and keeps only wallets whose key verifies. That is one extra prompt, on that path only.
- A stored v1 wallet that has since been migrated is dropped on the next `connect` (and actions on it fail with `V1WalletMigratedError`), so the app stops showing a closed address.
- Every action — sign, sessions, authorities, deferred execution — uses the client for the wallet's protocol. The v1 client is `@lazorkit/sdk-legacy` 0.3.2, the SDK those wallets were made with, installed under the alias `lazorkit-sdk-v1`. Flows that start from an account (a stored session or authority key, a deferred payload) read the protocol from its owner.
- `WalletInfo.protocolVersion` (1 | 2) is stored on connect; a wallet saved by an earlier release has none and is treated as v1. `useWallet()` exposes it as `protocolVersion`.
- New `v1PaymasterConfig` (web) / `v1ConfigPaymaster` (mobile): the relayer for v1 wallets — the one the app used before v2. It defaults to the main paymaster, which is only right if that relayer still sponsors v1: **LazorKit's v2 relayer does not** (a relayer sponsoring the full v1 program can have its fee payer pulled into a v1 transaction's inner calls). An app with v1 users that points `paymasterConfig` at a v2 relayer must set it.
- New `cluster` option, for an RPC URL that does not say which cluster it serves. Without it the cluster is read from the URL, and anything unrecognised is mainnet, as before.
- Once v1 is retired, a v1 wallet's actions fail with `V1WalletRetiredError` (code 4018) instead of a bare program error. The wallet is safe; it has to be moved with `LazorKitClient.migrateV1Wallet` (sdk-legacy ≥ 1.2.0) or the migration page.
- Every action acts on the stored wallet rather than the first one listing the passkey.
- Adding a key to a **v1** wallet requires `unrestricted: true` and refuses a `policy`: v1 has no spending policies and never checked rank at Execute, so any added key could spend the whole vault.

Breaking, beyond the protocol change itself:

- `PROGRAM_ID` / `PROGRAM_ADDRESS` are now the v2 mainnet id, and the client no longer defaults to it: without an explicit id it picks the v2 program for the RPC's cluster.
- The exported PDA helpers (`findVaultPda`, `findWalletPda`, …) derive **v2** addresses at the mainnet id unless given a program id. They are wrong for a v1 wallet: never derive a user's address with them. Use `WalletInfo.vaultPda` — or `useWallet().vaultPubkey` on web, `smartWalletPubkey` on mobile — which is always the right vault for the wallet's protocol (wallets stored without it are backfilled on connect).
- The web wallet-adapter's `publicKey` is now the **vault**, where funds live and the account that signs. It used to be the wallet PDA, an internal account nothing can spend from.
- The low-level `create*Ix` builders, `appendProtocolFeeAccounts` and `readAuthorityState` are no longer part of the public surface. The client methods replace them; `readAuthorityState` is now `readAuthorityCounter` plus `readAuthorityPubkey`.
- `addAuthority` with `ROLE_SPENDER` (Delegate) on a v2 wallet requires a `policy`. Both packages' `AddAuthorityPayload` gained the field.
- **`createSession` now refuses to mint an unbounded session by accident.** Passing no spending limits used to produce a session key that can spend the whole vault through any program until it expires, silently. It now throws unless the caller passes limits, or says `unrestricted: true`. This is the one behaviour change here that is not forced by the protocol, and a major release is the moment to make it.
