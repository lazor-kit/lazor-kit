/**
 * The protocol layer is @lazorkit/sdk-legacy 1.x (protocol v2). What used to
 * be vendored here is now a dependency, so there is one implementation of the
 * wire format instead of three.
 *
 * Two things changed for consumers of this package, both deliberate:
 *   - The low-level `create*Ix` builders and `appendProtocolFeeAccounts` are
 *     no longer re-exported. The SDK keeps them off its package root; use the
 *     client methods.
 *   - Everything speaks protocol v2, so PDAs derive different addresses than
 *     this package's previous release. A wallet created under v1 must be
 *     moved with `LazorKitClient.migrateV1Wallet`.
 */
export * from '@lazorkit/sdk-legacy';

// Explicit re-exports win over the star above, which is what keeps the
// historical call shape (optional `programId`) working.
export {
  LazorKitClient,
  findWalletPda,
  findVaultPda,
  findAuthorityPda,
  findSessionPda,
  findProtocolConfigPda,
  findFeeRecordPda,
  findTreasuryShardPda,
  findDeferredExecPda,
  buildSecp256r1Challenge,
  readAuthorityState,
} from './compat';

// An ownership-proof challenge is domain-separated (`tag || 32 random
// bytes`, 59 bytes), never the bare 32 random bytes sdk-legacy's own
// generator gives: a passkey challenge of one kind must never be readable
// as another, and a transaction challenge is 32 bytes. `verifyOwnershipProof`
// takes it unchanged. See core/message/ownershipProof.ts.
export { createOwnershipChallenge, OWNERSHIP_PROOF_DOMAIN } from '../../message/ownershipProof';
