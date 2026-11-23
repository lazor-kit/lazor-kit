# Protocol v1 Kora staging

`kora.protocol-v1.toml` and `signers.protocol-v1.toml` form a separate
profile for the Protocol v1 paid Execute rehearsal. `pnpm staging:kora` checks
out `upstream-revision` and applies `protocol-v1-execute-fee.patch` before it
builds. Pin builds by commit because the upstream binary can report the same
version string as earlier tags.

The profile requires the Protocol v1 Devnet program and accepts only
transaction v1. It quotes 0.25 Devnet USDC at a deterministic test price and
expects the sponsor's USDC ATA to exist. The test supplies a generated signer
through `LK_PROTOCOL_STAGING_KORA_SIGNER` and a generated `KORA_API_KEY`.
Keep the hosted staging signer and endpoint separate from existing relayers.

The local rehearsal loads this profile and maps the program and USDC mint to
its validator. See the [workspace instructions](../../README.md#kora-integration-on-localnet).
Kora upstream binds on all interfaces. Any hosted staging service needs private
ingress and its own authenticated clients. Configure the exact browser origin
if testing from a hosted React app.

## Scope and cutover gates

- The fixture checks that Kora sponsors network SOL and the Protocol `Execute`
  fee, and receives USDC from the vault in the same transaction. Both binary
  versions reject missing payment. The fixture pre-registers the fee payer
  and creates the token accounts before the execution tests.
- The opt-in policy checks the first direct CPI of the configured Protocol v1
  passkey `Execute`. It allows one sponsor-funded System transfer to the
  canonical treasury shard for exactly the enabled fee read from the on-chain
  config. The general sponsor transfer and account creation policies stay off.
- The comparison happens before Kora signs. Coordinate hosted fee or program
  changes with pausing the relayer and draining pending transactions. The
  on-chain program reads its fee when the transaction executes.
- This allowlist covers the SPL Token fixture. Add a real swap route only once
  its programs and inner instructions are identified and confirmed on the
  intended staging RPC. The test price is for Devnet rehearsal.
- Keep legacy/v0 traffic on its compatibility route. Route an app to this
  endpoint only for transaction v1 with an explicit USDC reimbursement in the
  approved Execute payload. Test the rollback route with partner SDK builds.
