/**
 * Hand-written instruction builders that produce the exact raw binary format
 * the LazorKit program expects. Solita-generated builders use beet which adds
 * length prefixes to `bytes` fields, causing a mismatch.
 */
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { concatBytes } from './bytes';

// ─── Discriminators ──────────────────────────────────────────────────
export const DISC_CREATE_WALLET = 0;
export const DISC_ADD_AUTHORITY = 1;
export const DISC_REMOVE_AUTHORITY = 2;
export const DISC_TRANSFER_OWNERSHIP = 3;
export const DISC_EXECUTE = 4;
export const DISC_CREATE_SESSION = 5;
export const DISC_AUTHORIZE = 6;
export const DISC_EXECUTE_DEFERRED = 7;
export const DISC_RECLAIM_DEFERRED = 8;
export const DISC_REVOKE_SESSION = 9;
export const DISC_INITIALIZE_PROTOCOL = 10;
export const DISC_UPDATE_PROTOCOL = 11;
export const DISC_REGISTER_PAYER = 12;
export const DISC_WITHDRAW_TREASURY = 13;
export const DISC_INITIALIZE_TREASURY_SHARD = 14;

// ─── Authority types ─────────────────────────────────────────────────
export const AUTH_TYPE_ED25519 = 0;
export const AUTH_TYPE_SECP256R1 = 1;

// ─── Roles ───────────────────────────────────────────────────────────
export const ROLE_OWNER = 0;
export const ROLE_ADMIN = 1;
export const ROLE_SPENDER = 2;

// ─── CreateWallet ────────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [user_seed(32)][auth_type(1)][auth_bump(1)][padding(6)]
 *   Ed25519:   [pubkey(32)]
 *   Secp256r1: [credential_id_hash(32)][pubkey(33)][rpIdLen(1)][rpId(N)]
 */
export function createCreateWalletIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  vaultPda: PublicKey;
  authorityPda: PublicKey;
  userSeed: Uint8Array;
  authType: number;
  authBump: number;
  /** Ed25519: 32-byte pubkey. Secp256r1: 32-byte credential_id_hash */
  credentialOrPubkey: Uint8Array;
  /** Secp256r1 only: 33-byte compressed pubkey */
  secp256r1Pubkey?: Uint8Array;
  /** Secp256r1 only: RP ID string (stored on-chain for per-tx savings) */
  rpId?: string;
  /** Optional protocol fee accounts (integrator opt-in) */
  protocolFee?: { protocolConfigPda: PublicKey; feeRecordPda: PublicKey; treasuryShardPda: PublicKey };
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [
    new Uint8Array([DISC_CREATE_WALLET]),
    params.userSeed,
    new Uint8Array([params.authType, params.authBump]),
    new Uint8Array(6), // padding
    params.credentialOrPubkey,
  ];
  if (params.authType === AUTH_TYPE_SECP256R1 && params.secp256r1Pubkey) {
    parts.push(params.secp256r1Pubkey);
    if (params.rpId) {
      const rpIdBytes = Buffer.from(params.rpId, 'utf-8');
      parts.push(new Uint8Array([rpIdBytes.length]));
      parts.push(new Uint8Array(rpIdBytes));
    }
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: params.walletPda, isSigner: false, isWritable: true },
    { pubkey: params.vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.authorityPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  if (params.protocolFee) {
    appendProtocolFeeAccounts(keys, params.protocolFee.protocolConfigPda, params.protocolFee.feeRecordPda, params.protocolFee.treasuryShardPda);
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── AddAuthority ────────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [auth_type(1)][new_role(1)][padding(6)]
 *   Ed25519:   [pubkey(32)]
 *   Secp256r1: [credential_id_hash(32)][pubkey(33)][rpIdLen(1)][rpId(N)] + [auth_payload(...)]
 */
export function createAddAuthorityIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  adminAuthorityPda: PublicKey;
  newAuthorityPda: PublicKey;
  newType: number;
  newRole: number;
  /** Ed25519: 32-byte pubkey. Secp256r1: 32-byte credential_id_hash */
  credentialOrPubkey: Uint8Array;
  /** Secp256r1 only: 33-byte compressed pubkey */
  secp256r1Pubkey?: Uint8Array;
  /** Secp256r1 only: RP ID string for the new authority */
  rpId?: string;
  /** Auth payload for Secp256r1 admin authentication */
  authPayload?: Uint8Array;
  /** For Ed25519 admin: the signer pubkey */
  authorizerSigner?: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [
    new Uint8Array([DISC_ADD_AUTHORITY]),
    new Uint8Array([params.newType, params.newRole]),
    new Uint8Array(6), // padding
    params.credentialOrPubkey,
  ];
  if (params.newType === AUTH_TYPE_SECP256R1 && params.secp256r1Pubkey) {
    parts.push(params.secp256r1Pubkey);
    if (params.rpId) {
      const rpIdBytes = Buffer.from(params.rpId, 'utf-8');
      parts.push(new Uint8Array([rpIdBytes.length]));
      parts.push(new Uint8Array(rpIdBytes));
    }
  }
  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.adminAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.newAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Secp256r1 auth needs sysvar instructions; Ed25519 needs the signer
  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── RemoveAuthority ─────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   Secp256r1: [auth_payload(...)]
 *   Ed25519:   empty (auth is via signer)
 */
export function createRemoveAuthorityIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  adminAuthorityPda: PublicKey;
  targetAuthorityPda: PublicKey;
  refundDestination: PublicKey;
  authPayload?: Uint8Array;
  authorizerSigner?: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [new Uint8Array([DISC_REMOVE_AUTHORITY])];
  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.adminAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.targetAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.refundDestination, isSigner: false, isWritable: true },
  ];

  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── TransferOwnership ──────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [auth_type(1)]
 *   Ed25519:   [pubkey(32)]
 *   Secp256r1: [credential_id_hash(32)][pubkey(33)][rpIdLen(1)][rpId(N)] + [auth_payload(...)]
 *
 * Account layout:
 *   0: payer (signer, writable)
 *   1: wallet_pda
 *   2: current_owner (writable)
 *   3: new_owner (writable)
 *   4: refund_dest (writable) — receives current_owner rent
 *   5: system_program
 *   6: rent_sysvar
 *   7: (optional) authorizerSigner or SYSVAR_INSTRUCTIONS
 */
export function createTransferOwnershipIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  currentOwnerAuthorityPda: PublicKey;
  newOwnerAuthorityPda: PublicKey;
  /** Where the current owner account's rent goes. Defaults to payer if omitted. */
  refundDestination: PublicKey;
  newType: number;
  /** Ed25519: 32-byte pubkey. Secp256r1: 32-byte credential_id_hash */
  credentialOrPubkey: Uint8Array;
  /** Secp256r1 only: 33-byte compressed pubkey */
  secp256r1Pubkey?: Uint8Array;
  /** Secp256r1 only: RP ID string for the new owner */
  rpId?: string;
  authPayload?: Uint8Array;
  authorizerSigner?: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [
    new Uint8Array([DISC_TRANSFER_OWNERSHIP]),
    new Uint8Array([params.newType]),
    params.credentialOrPubkey,
  ];
  if (params.newType === AUTH_TYPE_SECP256R1 && params.secp256r1Pubkey) {
    parts.push(params.secp256r1Pubkey);
    if (params.rpId) {
      const rpIdBytes = Buffer.from(params.rpId, 'utf-8');
      parts.push(new Uint8Array([rpIdBytes.length]));
      parts.push(new Uint8Array(rpIdBytes));
    }
  }
  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.currentOwnerAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.newOwnerAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.refundDestination, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── Execute ─────────────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [compact_instructions(variable)]
 *   Secp256r1: [auth_payload(variable)]
 */
export function createExecuteIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  authorityPda: PublicKey;
  vaultPda: PublicKey;
  packedInstructions: Uint8Array;
  authPayload?: Uint8Array;
  /** For Ed25519 auth: the signer pubkey (placed at account index 4) */
  authorizerSigner?: PublicKey;
  /** Additional account metas for the inner CPI instructions */
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  /** Optional protocol fee accounts (integrator opt-in) */
  protocolFee?: { protocolConfigPda: PublicKey; feeRecordPda: PublicKey; treasuryShardPda: PublicKey };
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [
    new Uint8Array([DISC_EXECUTE]),
    params.packedInstructions,
  ];
  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.authorityPda, isSigner: false, isWritable: true },
    { pubkey: params.vaultPda, isSigner: false, isWritable: true },
  ];

  // Ed25519 needs the signer at index 4; Secp256r1 needs sysvar instructions
  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  // Remaining accounts for CPI targets
  if (params.remainingAccounts) {
    keys.push(...params.remainingAccounts);
  }

  // Protocol fee accounts appended at the end
  if (params.protocolFee) {
    appendProtocolFeeAccounts(keys, params.protocolFee.protocolConfigPda, params.protocolFee.feeRecordPda, params.protocolFee.treasuryShardPda);
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── CreateSession ───────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [session_key(32)][expires_at(8)]
 *   Secp256r1: [auth_payload(variable)]
 */
export function createCreateSessionIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  adminAuthorityPda: PublicKey;
  sessionPda: PublicKey;
  sessionKey: Uint8Array;
  expiresAt: bigint;
  /** Serialized actions buffer (from serializeActions). Empty/omitted = no actions. */
  actionsBuffer?: Uint8Array;
  authPayload?: Uint8Array;
  authorizerSigner?: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const expiresAtBuf = Buffer.alloc(8);
  expiresAtBuf.writeBigInt64LE(params.expiresAt);

  const parts: Uint8Array[] = [
    new Uint8Array([DISC_CREATE_SESSION]),
    params.sessionKey,
    new Uint8Array(expiresAtBuf),
  ];

  // Append actions length prefix + buffer
  const actionsBuffer = params.actionsBuffer ?? new Uint8Array(0);
  const actionsLenBuf = new Uint8Array(2);
  actionsLenBuf[0] = actionsBuffer.length & 0xff;
  actionsLenBuf[1] = (actionsBuffer.length >> 8) & 0xff;
  parts.push(actionsLenBuf);
  if (actionsBuffer.length > 0) {
    parts.push(actionsBuffer);
  }

  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.adminAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.sessionPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── Authorize (Deferred Execution tx1) ─────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [instructions_hash(32)][accounts_hash(32)][expiry_offset(2)][auth_payload(variable)]
 */
export function createAuthorizeIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  authorityPda: PublicKey;
  deferredExecPda: PublicKey;
  instructionsHash: Uint8Array;
  accountsHash: Uint8Array;
  expiryOffset: number;
  authPayload: Uint8Array;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const expiryBuf = Buffer.alloc(2);
  expiryBuf.writeUInt16LE(params.expiryOffset);

  const parts: Uint8Array[] = [
    new Uint8Array([DISC_AUTHORIZE]),
    params.instructionsHash,
    params.accountsHash,
    new Uint8Array(expiryBuf),
    params.authPayload,
  ];

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.walletPda, isSigner: false, isWritable: false },
      { pubkey: params.authorityPda, isSigner: false, isWritable: true },
      { pubkey: params.deferredExecPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── ExecuteDeferred (Deferred Execution tx2) ───────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [compact_instructions(variable)]
 */
export function createExecuteDeferredIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  vaultPda: PublicKey;
  deferredExecPda: PublicKey;
  refundDestination: PublicKey;
  packedInstructions: Uint8Array;
  /** Additional account metas for the inner CPI instructions */
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  /** Optional protocol fee accounts (integrator opt-in) */
  protocolFee?: { protocolConfigPda: PublicKey; feeRecordPda: PublicKey; treasuryShardPda: PublicKey };
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [
    new Uint8Array([DISC_EXECUTE_DEFERRED]),
    params.packedInstructions,
  ];

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.deferredExecPda, isSigner: false, isWritable: true },
    { pubkey: params.refundDestination, isSigner: false, isWritable: true },
  ];

  if (params.remainingAccounts) {
    keys.push(...params.remainingAccounts);
  }

  // Protocol fee accounts appended at the end
  if (params.protocolFee) {
    appendProtocolFeeAccounts(keys, params.protocolFee.protocolConfigPda, params.protocolFee.feeRecordPda, params.protocolFee.treasuryShardPda);
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── ReclaimDeferred ────────────────────────────────────────────────
/**
 * Closes an expired DeferredExec account and refunds rent.
 * Instruction data: discriminator only (no payload).
 */
export function createReclaimDeferredIx(params: {
  payer: PublicKey;
  deferredExecPda: PublicKey;
  refundDestination: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: false },
      { pubkey: params.deferredExecPda, isSigner: false, isWritable: true },
      { pubkey: params.refundDestination, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([DISC_RECLAIM_DEFERRED]),
  });
}

// ─── RevokeSession ──────────────────────────────────────────────────
/**
 * Revoke a session key early (before expiry).
 * Only Owner or Admin can revoke.
 * Instruction data: [discriminator(1)][auth_payload(...) for Secp256r1 | empty for Ed25519]
 */
export function createRevokeSessionIx(params: {
  payer: PublicKey;
  walletPda: PublicKey;
  adminAuthorityPda: PublicKey;
  sessionPda: PublicKey;
  refundDestination: PublicKey;
  authPayload?: Uint8Array;
  authorizerSigner?: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const parts: Uint8Array[] = [new Uint8Array([DISC_REVOKE_SESSION])];
  if (params.authPayload) {
    parts.push(params.authPayload);
  }

  const keys = [
    { pubkey: params.payer, isSigner: true, isWritable: false },
    { pubkey: params.walletPda, isSigner: false, isWritable: false },
    { pubkey: params.adminAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: params.sessionPda, isSigner: false, isWritable: true },
    { pubkey: params.refundDestination, isSigner: false, isWritable: true },
  ];

  if (params.authorizerSigner) {
    keys.push({ pubkey: params.authorizerSigner, isSigner: true, isWritable: false });
  } else if (params.authPayload) {
    keys.push({ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: pid,
    keys,
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── InitializeProtocol ─────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [admin(32)][treasury(32)][creation_fee(8)][execution_fee(8)][num_shards(1)]
 */
export function createInitializeProtocolIx(params: {
  payer: PublicKey;
  protocolConfigPda: PublicKey;
  admin: PublicKey;
  treasury: PublicKey;
  creationFee: bigint;
  executionFee: bigint;
  numShards: number;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const creationFeeBuf = Buffer.alloc(8);
  creationFeeBuf.writeBigUInt64LE(params.creationFee);
  const executionFeeBuf = Buffer.alloc(8);
  executionFeeBuf.writeBigUInt64LE(params.executionFee);

  const parts: Uint8Array[] = [
    new Uint8Array([DISC_INITIALIZE_PROTOCOL]),
    params.admin.toBytes(),
    params.treasury.toBytes(),
    new Uint8Array(creationFeeBuf),
    new Uint8Array(executionFeeBuf),
    new Uint8Array([params.numShards]),
  ];

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.protocolConfigPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── UpdateProtocol ─────────────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [creation_fee(8)][execution_fee(8)][enabled(1)][padding(7)][new_treasury(32)]
 */
export function createUpdateProtocolIx(params: {
  admin: PublicKey;
  protocolConfigPda: PublicKey;
  creationFee: bigint;
  executionFee: bigint;
  enabled: boolean;
  newTreasury: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;
  const creationFeeBuf = Buffer.alloc(8);
  creationFeeBuf.writeBigUInt64LE(params.creationFee);
  const executionFeeBuf = Buffer.alloc(8);
  executionFeeBuf.writeBigUInt64LE(params.executionFee);

  const parts: Uint8Array[] = [
    new Uint8Array([DISC_UPDATE_PROTOCOL]),
    new Uint8Array(creationFeeBuf),
    new Uint8Array(executionFeeBuf),
    new Uint8Array([params.enabled ? 1 : 0]),
    new Uint8Array(7), // padding
    params.newTreasury.toBytes(),
  ];

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: params.protocolConfigPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(concatBytes(parts)),
  });
}

// ─── RegisterPayer ──────────────────────────────────────────────────
/**
 * Permissionless self-registration. The payer signer registers itself —
 * the FeeRecord PDA is derived from the payer's pubkey. No admin gate;
 * fee collection works regardless, this only enables stats tracking.
 *
 * Instruction data: discriminator only.
 */
export function createRegisterPayerIx(params: {
  payer: PublicKey;
  feeRecordPda: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.feeRecordPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([DISC_REGISTER_PAYER]),
  });
}

// ─── WithdrawTreasury ───────────────────────────────────────────────
/**
 * Sweep accumulated SOL from a treasury shard to the treasury wallet.
 * Instruction data: discriminator only.
 */
export function createWithdrawTreasuryIx(params: {
  admin: PublicKey;
  protocolConfigPda: PublicKey;
  treasuryShardPda: PublicKey;
  treasury: PublicKey;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: params.protocolConfigPda, isSigner: false, isWritable: false },
      { pubkey: params.treasuryShardPda, isSigner: false, isWritable: true },
      { pubkey: params.treasury, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([DISC_WITHDRAW_TREASURY]),
  });
}

// ─── InitializeTreasuryShard ────────────────────────────────────────
/**
 * Instruction data layout (after discriminator):
 *   [shard_id(1)]
 */
export function createInitializeTreasuryShardIx(params: {
  payer: PublicKey;
  protocolConfigPda: PublicKey;
  admin: PublicKey;
  treasuryShardPda: PublicKey;
  shardId: number;
  programId: PublicKey;
}): TransactionInstruction {
  const pid = params.programId;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.protocolConfigPda, isSigner: false, isWritable: false },
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: params.treasuryShardPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([DISC_INITIALIZE_TREASURY_SHARD, params.shardId]),
  });
}

// ─── Protocol Fee Account Helpers ───────────────────────────────────
/** Append protocol fee accounts to an existing keys array (for fee-eligible instructions) */
export function appendProtocolFeeAccounts(
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
  protocolConfigPda: PublicKey,
  feeRecordPda: PublicKey,
  treasuryShardPda: PublicKey,
): void {
  keys.push(
    { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
    { pubkey: feeRecordPda, isSigner: false, isWritable: true },
    { pubkey: treasuryShardPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  );
}

