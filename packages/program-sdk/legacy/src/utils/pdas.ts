import { PublicKey } from '@solana/web3.js';

// PDA derivation helpers. Every function takes the program ID explicitly —
// there is no ambient default. Use the cluster-specific constants from
// `../constants` (`PROGRAM_ID_MAINNET` / `PROGRAM_ID_DEVNET`), or pass
// `LazorKitClient.programId` from a client instance.

export function findWalletPda(
  userSeed: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('wallet'), userSeed],
    programId,
  );
}

export function findVaultPda(
  walletPda: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), walletPda.toBuffer()],
    programId,
  );
}

export function findAuthorityPda(
  walletPda: PublicKey,
  credentialIdHash: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), walletPda.toBuffer(), credentialIdHash],
    programId,
  );
}

export function findSessionPda(
  walletPda: PublicKey,
  sessionKey: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('session'), walletPda.toBuffer(), sessionKey],
    programId,
  );
}

export function findProtocolConfigPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_config')],
    programId,
  );
}

export function findFeeRecordPda(
  payerPubkey: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_record'), payerPubkey.toBuffer()],
    programId,
  );
}

export function findTreasuryShardPda(
  shardId: number,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_shard'), Buffer.from([shardId])],
    programId,
  );
}

export function findDeferredExecPda(
  walletPda: PublicKey,
  authorityPda: PublicKey,
  counter: number,
  programId: PublicKey,
): [PublicKey, number] {
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32LE(counter);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('deferred'),
      walletPda.toBuffer(),
      authorityPda.toBuffer(),
      counterBuf,
    ],
    programId,
  );
}
