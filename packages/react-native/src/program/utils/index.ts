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
