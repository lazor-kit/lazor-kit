import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID } from '../constants';
import { findWalletPda, findVaultPda, findAuthorityPda, findSessionPda, findDeferredExecPda, findProtocolConfigPda, findFeeRecordPda, findTreasuryShardPda } from './pdas';
import { readAuthorityCounter, readAuthorityPubkey } from './secp256r1';
import { packCompactInstructions, computeAccountsHash, computeInstructionsHash, type CompactInstruction } from './packing';
import {
  createCreateWalletIx,
  createAddAuthorityIx,
  createRemoveAuthorityIx,
  createTransferOwnershipIx,
  createExecuteIx,
  createCreateSessionIx,
  createAuthorizeIx,
  createExecuteDeferredIx,
  createReclaimDeferredIx,
  createRevokeSessionIx,
  createInitializeProtocolIx,
  createUpdateProtocolIx,
  createRegisterPayerIx,
  createWithdrawTreasuryIx,
  createInitializeTreasuryShardIx,
  AUTH_TYPE_ED25519,
  AUTH_TYPE_SECP256R1,
  DISC_ADD_AUTHORITY,
  DISC_REMOVE_AUTHORITY,
  DISC_TRANSFER_OWNERSHIP,
  DISC_EXECUTE,
  DISC_CREATE_SESSION,
  DISC_AUTHORIZE,
  DISC_REVOKE_SESSION,
} from './instructions';
import { signWithSecp256r1, prepareSecp256r1, finalizeSecp256r1, type PreparedSecp256r1, type WebAuthnResponse, buildDataPayloadForAdd, buildDataPayloadForTransfer, buildDataPayloadForSession, concatParts } from './signing';
import { buildCompactLayout } from './compact';
import { serializeActions, type SessionAction } from './actions';
import type { AccountMeta } from '@solana/web3.js';
import type { CreateWalletOwner, AdminSigner, ExecuteSigner, Secp256r1SignerConfig, DeferredPayload, Secp256r1Params } from './types';

// ─── Prepared operation types (for secp256r1 prepare/finalize flow) ──

interface PreparedBase {
  /** SHA-256 challenge to pass to navigator.credentials.get() */
  challenge: Uint8Array;
}

export interface PreparedExecute extends PreparedBase {
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    vaultPda: PublicKey;
    packed: Uint8Array;
    remainingAccounts: AccountMeta[];
    protocolFee?: { protocolConfigPda: PublicKey; feeRecordPda: PublicKey; treasuryShardPda: PublicKey };
    programId: PublicKey;
  };
}

export interface PreparedAddAuthority extends PreparedBase {
  newAuthorityPda: PublicKey;
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    newAuthorityPda: PublicKey;
    newType: number;
    newRole: number;
    credentialOrPubkey: Uint8Array;
    secp256r1Pubkey?: Uint8Array;
    rpId?: string;
    programId: PublicKey;
  };
}

export interface PreparedRemoveAuthority extends PreparedBase {
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    targetAuthorityPda: PublicKey;
    refundDestination: PublicKey;
    programId: PublicKey;
  };
}

export interface PreparedTransferOwnership extends PreparedBase {
  newOwnerAuthorityPda: PublicKey;
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    currentOwnerAuthorityPda: PublicKey;
    newOwnerAuthorityPda: PublicKey;
    refundDestination: PublicKey;
    newType: number;
    credentialOrPubkey: Uint8Array;
    secp256r1Pubkey?: Uint8Array;
    rpId?: string;
    programId: PublicKey;
  };
}

export interface PreparedCreateSession extends PreparedBase {
  sessionPda: PublicKey;
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    sessionPda: PublicKey;
    sessionKey: Uint8Array;
    expiresAt: bigint;
    actionsBuffer?: Uint8Array;
    programId: PublicKey;
  };
}

export interface PreparedRevokeSession extends PreparedBase {
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    sessionPda: PublicKey;
    refundDestination: PublicKey;
    programId: PublicKey;
  };
}

export interface PreparedAuthorize extends PreparedBase {
  deferredExecPda: PublicKey;
  counter: number;
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    deferredExecPda: PublicKey;
    instructionsHash: Uint8Array;
    accountsHash: Uint8Array;
    expiryOffset: number;
    compactInstructions: CompactInstruction[];
    remainingAccounts: AccountMeta[];
    programId: PublicKey;
  };
}

// ─── Sysvar instruction indexes (auto-computed from account layouts) ──

const SYSVAR_IX_INDEX_ADD_AUTHORITY = 6;
const SYSVAR_IX_INDEX_REMOVE_AUTHORITY = 5;
const SYSVAR_IX_INDEX_TRANSFER_OWNERSHIP = 7; // account layout: payer,wallet,currentOwner,newOwner,refundDest,system,rent,sysvarIx
const SYSVAR_IX_INDEX_EXECUTE = 4;
const SYSVAR_IX_INDEX_CREATE_SESSION = 6;
const SYSVAR_IX_INDEX_AUTHORIZE = 6;
const SYSVAR_IX_INDEX_REVOKE_SESSION = 5;

// ─── Internal helpers ─────────────────────────────────────────────────

/** Resolves a CreateWalletOwner to the low-level fields needed by IX builders */
function resolveOwnerFields(owner: CreateWalletOwner): {
  authType: number;
  credentialOrPubkey: Uint8Array;
  secp256r1Pubkey?: Uint8Array;
  rpId?: string;
} {
  if (owner.type === 'ed25519') {
    return { authType: AUTH_TYPE_ED25519, credentialOrPubkey: owner.publicKey.toBytes() };
  }
  return {
    authType: AUTH_TYPE_SECP256R1,
    credentialOrPubkey: owner.credentialIdHash,
    secp256r1Pubkey: owner.compressedPubkey,
    rpId: owner.rpId,
  };
}

export class LazorKitClient {
  /** Cached protocol config (fetched on first fee-eligible call) */
  private _protocolConfig: { numShards: number; enabled: boolean } | null | undefined;

  constructor(
    public readonly connection: Connection,
    public readonly programId: PublicKey = PROGRAM_ID,
  ) { }

  // ─── PDA helpers ─────────────────────────────────────────────────

  findWallet(userSeed: Uint8Array) { return findWalletPda(userSeed, this.programId); }
  findVault(walletPda: PublicKey) { return findVaultPda(walletPda, this.programId); }
  findAuthority(walletPda: PublicKey, credIdHash: Uint8Array) {
    return findAuthorityPda(walletPda, credIdHash, this.programId);
  }
  findSession(walletPda: PublicKey, sessionKey: Uint8Array) {
    return findSessionPda(walletPda, sessionKey, this.programId);
  }
  findDeferredExec(walletPda: PublicKey, authorityPda: PublicKey, counter: number) {
    return findDeferredExecPda(walletPda, authorityPda, counter, this.programId);
  }
  findProtocolConfig() { return findProtocolConfigPda(this.programId); }
  findFeeRecord(payerPubkey: PublicKey) { return findFeeRecordPda(payerPubkey, this.programId); }
  findTreasuryShard(shardId: number) { return findTreasuryShardPda(shardId, this.programId); }

  /**
   * Fetch and cache the on-chain ProtocolConfig. Returns null if not initialized.
   * Cached after first fetch — call `invalidateProtocolCache()` to refresh.
   */
  async getProtocolConfig(): Promise<{ numShards: number; enabled: boolean } | null> {
    if (this._protocolConfig !== undefined) return this._protocolConfig;
    const [configPda] = this.findProtocolConfig();
    const info = await this.connection.getAccountInfo(configPda);
    if (!info || info.data.length < 88 || info.data[0] !== 5) {
      this._protocolConfig = null;
      return null;
    }
    this._protocolConfig = {
      enabled: info.data[3] !== 0,
      numShards: info.data[4],
    };
    return this._protocolConfig;
  }

  /** Clear cached protocol config (e.g. after UpdateProtocol) */
  invalidateProtocolCache(): void {
    this._protocolConfig = undefined;
  }

  /**
   * Auto-resolve protocol fee accounts for a payer.
   *
   * Returns the 3 accounts to append whenever the protocol is initialized and enabled.
   * The `feeRecordPda` is derived from the payer — on-chain, the entrypoint detects
   * whether it's a registered FeeRecord and only updates reward-tracking counters if so.
   * Unregistered payers still pay the fee.
   *
   * Returns undefined only if the protocol isn't initialized or is disabled.
   */
  async resolveProtocolFee(payer: PublicKey): Promise<{ protocolConfigPda: PublicKey; feeRecordPda: PublicKey; treasuryShardPda: PublicKey } | undefined> {
    const config = await this.getProtocolConfig();
    if (!config || !config.enabled) return undefined;

    const [protocolConfigPda] = this.findProtocolConfig();
    const [feeRecordPda] = this.findFeeRecord(payer);
    const shardId = Math.floor(Math.random() * config.numShards);
    const [treasuryShardPda] = this.findTreasuryShard(shardId);
    return { protocolConfigPda, feeRecordPda, treasuryShardPda };
  }

  // ─── Account readers ─────────────────────────────────────────────

  async readCounter(authorityPda: PublicKey): Promise<number> {
    return readAuthorityCounter(this.connection, authorityPda);
  }

  // ─── Secp256r1 prepare/finalize helpers ──────────────────────────

  private async resolveSecp256r1(walletPda: PublicKey, p: Secp256r1Params) {
    const authorityPda = p.authorityPda ?? this.findAuthority(walletPda, p.credentialIdHash)[0];
    const publicKeyBytes = p.publicKeyBytes ?? (await readAuthorityPubkey(this.connection, authorityPda));
    const slot = p.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(authorityPda)) + 1;
    return { authorityPda, publicKeyBytes, slot, counter };
  }

  private buildSecp256r1Auth(signing: PreparedSecp256r1, response: WebAuthnResponse) {
    return finalizeSecp256r1(signing, response);
  }

  // ── prepareExecute / finalizeExecute ──

  async prepareExecute(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    instructions: TransactionInstruction[];
  }): Promise<PreparedExecute> {
    const [vaultPda] = this.findVault(params.walletPda);
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);
    const protocolFee = await this.resolveProtocolFee(params.payer);

    const fixedAccounts = [params.payer, params.walletPda, authorityPda, vaultPda, SYSVAR_INSTRUCTIONS_PUBKEY];
    const { compactInstructions, remainingAccounts } = buildCompactLayout(fixedAccounts, params.instructions);
    const packed = packCompactInstructions(compactInstructions);

    const allAccountMetas: AccountMeta[] = [
      { pubkey: params.payer, isSigner: true, isWritable: false },
      { pubkey: params.walletPda, isSigner: false, isWritable: false },
      { pubkey: authorityPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];
    const accountsHash = computeAccountsHash(allAccountMetas, compactInstructions);
    const signedPayload = concatParts([packed, accountsHash]);

    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_EXECUTE]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_EXECUTE,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, authorityPda, vaultPda, packed, remainingAccounts, protocolFee, programId: this.programId },
    };
  }

  finalizeExecute(prepared: PreparedExecute, response: WebAuthnResponse): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createExecuteIx({
      payer: i.payer, walletPda: i.walletPda, authorityPda: i.authorityPda, vaultPda: i.vaultPda,
      packedInstructions: i.packed, authPayload, remainingAccounts: i.remainingAccounts,
      protocolFee: i.protocolFee, programId: i.programId,
    });
    return { instructions: [precompileIx, ix] };
  }

  // ── prepareAddAuthority / finalizeAddAuthority ──

  async prepareAddAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    newAuthority: CreateWalletOwner;
    role: number;
  }): Promise<PreparedAddAuthority> {
    const { authType: newType, credentialOrPubkey, secp256r1Pubkey, rpId } = resolveOwnerFields(params.newAuthority);
    const [newAuthorityPda] = this.findAuthority(params.walletPda, credentialOrPubkey);
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);

    const dataPayload = buildDataPayloadForAdd(newType, params.role, credentialOrPubkey, secp256r1Pubkey, rpId);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_ADD_AUTHORITY]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_ADD_AUTHORITY,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      newAuthorityPda,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, adminAuthorityPda: authorityPda, newAuthorityPda, newType, newRole: params.role, credentialOrPubkey, secp256r1Pubkey, rpId, programId: this.programId },
    };
  }

  finalizeAddAuthority(prepared: PreparedAddAuthority, response: WebAuthnResponse): { instructions: TransactionInstruction[]; newAuthorityPda: PublicKey } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createAddAuthorityIx({
      payer: i.payer, walletPda: i.walletPda, adminAuthorityPda: i.adminAuthorityPda,
      newAuthorityPda: i.newAuthorityPda, newType: i.newType, newRole: i.newRole,
      credentialOrPubkey: i.credentialOrPubkey, secp256r1Pubkey: i.secp256r1Pubkey,
      rpId: i.rpId, authPayload, programId: i.programId,
    });
    return { instructions: [precompileIx, ix], newAuthorityPda: i.newAuthorityPda };
  }

  // ── prepareRemoveAuthority / finalizeRemoveAuthority ──

  async prepareRemoveAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    targetAuthorityPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<PreparedRemoveAuthority> {
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);

    const signedPayload = concatParts([params.targetAuthorityPda.toBytes(), refundDest.toBytes()]);
    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_REMOVE_AUTHORITY]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_REMOVE_AUTHORITY,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, adminAuthorityPda: authorityPda, targetAuthorityPda: params.targetAuthorityPda, refundDestination: refundDest, programId: this.programId },
    };
  }

  finalizeRemoveAuthority(prepared: PreparedRemoveAuthority, response: WebAuthnResponse): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createRemoveAuthorityIx({
      payer: i.payer, walletPda: i.walletPda, adminAuthorityPda: i.adminAuthorityPda,
      targetAuthorityPda: i.targetAuthorityPda, refundDestination: i.refundDestination,
      authPayload, programId: i.programId,
    });
    return { instructions: [precompileIx, ix] };
  }

  // ── prepareTransferOwnership / finalizeTransferOwnership ──

  async prepareTransferOwnership(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    newOwner: CreateWalletOwner;
    refundDestination?: PublicKey;
  }): Promise<PreparedTransferOwnership> {
    const { authType: newType, credentialOrPubkey, secp256r1Pubkey, rpId } = resolveOwnerFields(params.newOwner);
    const [newOwnerAuthorityPda] = this.findAuthority(params.walletPda, credentialOrPubkey);
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);

    const dataPayload = buildDataPayloadForTransfer(newType, credentialOrPubkey, secp256r1Pubkey, rpId);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes(), refundDest.toBytes()]);

    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_TRANSFER_OWNERSHIP]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_TRANSFER_OWNERSHIP,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      newOwnerAuthorityPda,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, currentOwnerAuthorityPda: authorityPda, newOwnerAuthorityPda, refundDestination: refundDest, newType, credentialOrPubkey, secp256r1Pubkey, rpId, programId: this.programId },
    };
  }

  finalizeTransferOwnership(prepared: PreparedTransferOwnership, response: WebAuthnResponse): { instructions: TransactionInstruction[]; newOwnerAuthorityPda: PublicKey } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createTransferOwnershipIx({
      payer: i.payer, walletPda: i.walletPda,
      currentOwnerAuthorityPda: i.currentOwnerAuthorityPda,
      newOwnerAuthorityPda: i.newOwnerAuthorityPda,
      refundDestination: i.refundDestination, newType: i.newType,
      credentialOrPubkey: i.credentialOrPubkey, secp256r1Pubkey: i.secp256r1Pubkey,
      rpId: i.rpId, authPayload, programId: i.programId,
    });
    return { instructions: [precompileIx, ix], newOwnerAuthorityPda: i.newOwnerAuthorityPda };
  }

  // ── prepareCreateSession / finalizeCreateSession ──

  async prepareCreateSession(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    sessionKey: PublicKey;
    expiresAt: bigint;
    actions?: SessionAction[];
  }): Promise<PreparedCreateSession> {
    const sessionKeyBytes = params.sessionKey.toBytes();
    const [sessionPda] = this.findSession(params.walletPda, sessionKeyBytes);
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);
    const actionsBuffer = params.actions && params.actions.length > 0 ? serializeActions(params.actions) : undefined;

    const dataPayload = buildDataPayloadForSession(sessionKeyBytes, params.expiresAt, actionsBuffer);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_CREATE_SESSION]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_CREATE_SESSION,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      sessionPda,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, adminAuthorityPda: authorityPda, sessionPda, sessionKey: sessionKeyBytes, expiresAt: params.expiresAt, actionsBuffer, programId: this.programId },
    };
  }

  finalizeCreateSession(prepared: PreparedCreateSession, response: WebAuthnResponse): { instructions: TransactionInstruction[]; sessionPda: PublicKey } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createCreateSessionIx({
      payer: i.payer, walletPda: i.walletPda, adminAuthorityPda: i.adminAuthorityPda,
      sessionPda: i.sessionPda, sessionKey: i.sessionKey, expiresAt: i.expiresAt,
      actionsBuffer: i.actionsBuffer, authPayload, programId: i.programId,
    });
    return { instructions: [precompileIx, ix], sessionPda: i.sessionPda };
  }

  // ── prepareRevokeSession / finalizeRevokeSession ──

  async prepareRevokeSession(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    sessionPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<PreparedRevokeSession> {
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);

    const signedPayload = concatParts([params.sessionPda.toBytes(), refundDest.toBytes()]);
    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_REVOKE_SESSION]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_REVOKE_SESSION,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, adminAuthorityPda: authorityPda, sessionPda: params.sessionPda, refundDestination: refundDest, programId: this.programId },
    };
  }

  finalizeRevokeSession(prepared: PreparedRevokeSession, response: WebAuthnResponse): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const ix = createRevokeSessionIx({
      payer: i.payer, walletPda: i.walletPda, adminAuthorityPda: i.adminAuthorityPda,
      sessionPda: i.sessionPda, refundDestination: i.refundDestination,
      authPayload, programId: i.programId,
    });
    return { instructions: [precompileIx, ix] };
  }

  // ── prepareAuthorize / finalizeAuthorize ──

  async prepareAuthorize(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    instructions: TransactionInstruction[];
    expiryOffset?: number;
  }): Promise<PreparedAuthorize> {
    const [vaultPda] = this.findVault(params.walletPda);
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(params.walletPda, params.secp256r1);
    const expiryOffset = params.expiryOffset ?? 300;
    const [deferredExecPda] = this.findDeferredExec(params.walletPda, authorityPda, counter);

    const tx2FixedAccounts = [params.payer, params.walletPda, vaultPda, deferredExecPda, params.payer];
    const { compactInstructions, remainingAccounts } = buildCompactLayout(tx2FixedAccounts, params.instructions);

    const instructionsHash = computeInstructionsHash(compactInstructions);
    const tx2AccountMetas: AccountMeta[] = [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.walletPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: deferredExecPda, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: false, isWritable: true },
      ...remainingAccounts,
    ];
    const accountsHash = computeAccountsHash(tx2AccountMetas, compactInstructions);
    const expiryOffsetBuf = new Uint8Array(2);
    expiryOffsetBuf[0] = expiryOffset & 0xff;
    expiryOffsetBuf[1] = (expiryOffset >> 8) & 0xff;
    const signedPayload = concatParts([instructionsHash, accountsHash, expiryOffsetBuf]);

    const signing = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_AUTHORIZE]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_AUTHORIZE,
      slot, counter, payer: params.payer, programId: this.programId, publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      deferredExecPda,
      counter,
      _internal: { signing, payer: params.payer, walletPda: params.walletPda, authorityPda, deferredExecPda, instructionsHash, accountsHash, expiryOffset, compactInstructions, remainingAccounts, programId: this.programId },
    };
  }

  finalizeAuthorize(prepared: PreparedAuthorize, response: WebAuthnResponse): { instructions: TransactionInstruction[]; deferredExecPda: PublicKey; counter: number; deferredPayload: DeferredPayload } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = this.buildSecp256r1Auth(i.signing, response);
    const authorizeIx = createAuthorizeIx({
      payer: i.payer, walletPda: i.walletPda, authorityPda: i.authorityPda,
      deferredExecPda: i.deferredExecPda, instructionsHash: i.instructionsHash,
      accountsHash: i.accountsHash, expiryOffset: i.expiryOffset,
      authPayload, programId: i.programId,
    });
    return {
      instructions: [precompileIx, authorizeIx],
      deferredExecPda: i.deferredExecPda,
      counter: prepared.counter,
      deferredPayload: { walletPda: i.walletPda, deferredExecPda: i.deferredExecPda, compactInstructions: i.compactInstructions, remainingAccounts: i.remainingAccounts },
    };
  }

  // ─── Wallet lookup ─────────────────────────────────────────────────

  /**
   * Look up wallets by credential.
   *
   * @param credential - 32 bytes: Ed25519 pubkey or Secp256r1 credentialIdHash
   * @param authorityType - `'secp256r1'` (default) or `'ed25519'`
   * @returns array of matching wallets (one credential can be authority on multiple wallets)
   *
   * @example Passkey user returns
   * ```typescript
   * const [wallet] = await client.findWalletsByAuthority(credentialIdHash);
   * ```
   *
   * @example Ed25519 lookup
   * ```typescript
   * const [wallet] = await client.findWalletsByAuthority(pubkeyBytes, 'ed25519');
   * ```
   */
  async findWalletsByAuthority(
    credential: Uint8Array,
    authorityType: 'ed25519' | 'secp256r1' = 'secp256r1',
  ): Promise<Array<{
    walletPda: PublicKey;
    authorityPda: PublicKey;
    vaultPda: PublicKey;
    role: number;
    authorityType: number;
  }>> {
    if (credential.length !== 32) {
      throw new Error('credential must be 32 bytes');
    }

    const typeValue = authorityType === 'ed25519' ? AUTH_TYPE_ED25519 : AUTH_TYPE_SECP256R1;

    // Filters:
    //   offset 0: discriminator == 2 (Authority)
    //   offset 1: authority_type == typeValue
    //   offset 48: credential bytes match
    const discAndType = Buffer.from([2, typeValue]);

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0, bytes: discAndType.toString('base64'), encoding: 'base64' } },
        { memcmp: { offset: 48, bytes: Buffer.from(credential).toString('base64'), encoding: 'base64' } },
      ],
    });

    return accounts.map(({ pubkey: authorityPda, account }) => {
      const data = account.data;
      const walletPda = new PublicKey(data.slice(16, 48));
      const [vaultPda] = this.findVault(walletPda);
      return {
        walletPda,
        authorityPda,
        vaultPda,
        role: data[2],
        authorityType: data[1],
      };
    });
  }

  // ─── CreateWallet ────────────────────────────────────────────────

  /**
   * Create a new LazorKit wallet with the given owner.
   *
   * @example Ed25519 owner
   * ```typescript
   * const { instructions, walletPda, vaultPda } = client.createWallet({
   *   payer: payer.publicKey,
   *   userSeed: randomBytes(32),
   *   owner: { type: 'ed25519', publicKey: ownerKp.publicKey },
   * });
   * ```
   *
   * @example Secp256r1 (passkey) owner
   * ```typescript
   * const { instructions, walletPda, vaultPda } = client.createWallet({
   *   payer: payer.publicKey,
   *   userSeed: randomBytes(32),
   *   owner: {
   *     type: 'secp256r1',
   *     credentialIdHash,
   *     compressedPubkey,
   *     rpId: 'example.com',
   *   },
   * });
   * ```
   */
  async createWallet(params: {
    payer: PublicKey;
    userSeed: Uint8Array;
    owner: CreateWalletOwner;
  }): Promise<{ instructions: TransactionInstruction[]; walletPda: PublicKey; vaultPda: PublicKey; authorityPda: PublicKey }> {
    const [walletPda] = this.findWallet(params.userSeed);
    const [vaultPda] = this.findVault(walletPda);
    const { authType, credentialOrPubkey, secp256r1Pubkey, rpId } = resolveOwnerFields(params.owner);
    const [authorityPda, authBump] = this.findAuthority(walletPda, credentialOrPubkey);

    const protocolFee = await this.resolveProtocolFee(params.payer);

    const ix = createCreateWalletIx({
      payer: params.payer, walletPda, vaultPda, authorityPda,
      userSeed: params.userSeed, authType, authBump,
      credentialOrPubkey, secp256r1Pubkey, rpId,
      protocolFee,
      programId: this.programId,
    });
    return { instructions: [ix], walletPda, vaultPda, authorityPda };
  }

  // ─── AddAuthority (unified) ─────────────────────────────────────

  /**
   * Add a new authority to the wallet.
   *
   * @example Add Ed25519 admin via Ed25519 owner
   * ```typescript
   * const { instructions, newAuthorityPda } = await client.addAuthority({
   *   payer: payer.publicKey,
   *   walletPda,
   *   adminSigner: ed25519(ownerKp.publicKey),
   *   newAuthority: { type: 'ed25519', publicKey: adminKp.publicKey },
   *   role: ROLE_ADMIN,
   * });
   * ```
   *
   * @example Add Secp256r1 spender via Secp256r1 owner
   * ```typescript
   * const { instructions, newAuthorityPda } = await client.addAuthority({
   *   payer: payer.publicKey,
   *   walletPda,
   *   adminSigner: secp256r1(ceoSigner),
   *   newAuthority: { type: 'secp256r1', credentialIdHash, compressedPubkey, rpId },
   *   role: ROLE_SPENDER,
   * });
   * ```
   */
  async addAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminSigner: AdminSigner;
    newAuthority: CreateWalletOwner;
    role: number;
  }): Promise<{ instructions: TransactionInstruction[]; newAuthorityPda: PublicKey }> {
    const { authType: newType, credentialOrPubkey, secp256r1Pubkey, rpId } = resolveOwnerFields(params.newAuthority);
    const [newAuthorityPda] = this.findAuthority(params.walletPda, credentialOrPubkey);
    const s = params.adminSigner;

    if (s.type === 'ed25519') {
      const ix = createAddAuthorityIx({
        payer: params.payer, walletPda: params.walletPda,
        adminAuthorityPda: s.authorityPda ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0],
        newAuthorityPda, newType, newRole: params.role,
        credentialOrPubkey, secp256r1Pubkey, rpId,
        authorizerSigner: s.publicKey, programId: this.programId,
      });
      return { instructions: [ix], newAuthorityPda };
    }

    // Secp256r1
    const adminAuthorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(adminAuthorityPda)) + 1;

    const dataPayload = buildDataPayloadForAdd(
      newType, params.role, credentialOrPubkey, secp256r1Pubkey, rpId,
    );
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_ADD_AUTHORITY]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_ADD_AUTHORITY,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const ix = createAddAuthorityIx({
      payer: params.payer, walletPda: params.walletPda, adminAuthorityPda, newAuthorityPda,
      newType, newRole: params.role, credentialOrPubkey, secp256r1Pubkey, rpId,
      authPayload, programId: this.programId,
    });
    return { instructions: [precompileIx, ix], newAuthorityPda };
  }

  // ─── RemoveAuthority (unified) ──────────────────────────────────

  async removeAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminSigner: AdminSigner;
    targetAuthorityPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<{ instructions: TransactionInstruction[] }> {
    const refundDest = params.refundDestination ?? params.payer;
    const s = params.adminSigner;

    if (s.type === 'ed25519') {
      const ix = createRemoveAuthorityIx({
        payer: params.payer, walletPda: params.walletPda,
        adminAuthorityPda: s.authorityPda ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0],
        targetAuthorityPda: params.targetAuthorityPda, refundDestination: refundDest,
        authorizerSigner: s.publicKey, programId: this.programId,
      });
      return { instructions: [ix] };
    }

    const adminAuthorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(adminAuthorityPda)) + 1;

    const signedPayload = concatParts([
      params.targetAuthorityPda.toBytes(), refundDest.toBytes(),
    ]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_REMOVE_AUTHORITY]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_REMOVE_AUTHORITY,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const ix = createRemoveAuthorityIx({
      payer: params.payer, walletPda: params.walletPda, adminAuthorityPda,
      targetAuthorityPda: params.targetAuthorityPda, refundDestination: refundDest,
      authPayload, programId: this.programId,
    });
    return { instructions: [precompileIx, ix] };
  }

  // ─── TransferOwnership (unified) ────────────────────────────────

  /**
   * Transfer wallet ownership to a new authority.
   *
   * @example Transfer to new Secp256r1 owner
   * ```typescript
   * const { instructions } = await client.transferOwnership({
   *   payer: payer.publicKey,
   *   walletPda,
   *   ownerSigner: secp256r1(ceoSigner),
   *   newOwner: { type: 'secp256r1', credentialIdHash, compressedPubkey, rpId },
   * });
   * ```
   */
  async transferOwnership(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    ownerSigner: AdminSigner;
    newOwner: CreateWalletOwner;
    /** Where the current owner account's rent goes. Defaults to payer if omitted. */
    refundDestination?: PublicKey;
  }): Promise<{ instructions: TransactionInstruction[]; newOwnerAuthorityPda: PublicKey }> {
    const { authType: newType, credentialOrPubkey, secp256r1Pubkey, rpId } = resolveOwnerFields(params.newOwner);
    const [newOwnerAuthorityPda] = this.findAuthority(params.walletPda, credentialOrPubkey);
    const refundDest = params.refundDestination ?? params.payer;
    const s = params.ownerSigner;

    if (s.type === 'ed25519') {
      const ix = createTransferOwnershipIx({
        payer: params.payer, walletPda: params.walletPda,
        currentOwnerAuthorityPda: s.authorityPda ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0],
        newOwnerAuthorityPda, refundDestination: refundDest,
        newType, credentialOrPubkey, secp256r1Pubkey, rpId,
        authorizerSigner: s.publicKey, programId: this.programId,
      });
      return { instructions: [ix], newOwnerAuthorityPda };
    }

    const currentOwnerAuthorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(currentOwnerAuthorityPda)) + 1;

    const dataPayload = buildDataPayloadForTransfer(newType, credentialOrPubkey, secp256r1Pubkey, rpId);
    // Sign over dataPayload + payer + refundDest to prevent substitution attacks.
    const signedPayload = concatParts([dataPayload, params.payer.toBytes(), refundDest.toBytes()]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_TRANSFER_OWNERSHIP]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_TRANSFER_OWNERSHIP,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const ix = createTransferOwnershipIx({
      payer: params.payer, walletPda: params.walletPda,
      currentOwnerAuthorityPda, newOwnerAuthorityPda, refundDestination: refundDest,
      newType, credentialOrPubkey, secp256r1Pubkey, rpId,
      authPayload, programId: this.programId,
    });
    return { instructions: [precompileIx, ix], newOwnerAuthorityPda };
  }

  // ─── CreateSession (unified) ────────────────────────────────────

  /**
   * Create a session key for the wallet.
   *
   * @example
   * ```typescript
   * const { instructions, sessionPda } = await client.createSession({
   *   payer: payer.publicKey,
   *   walletPda,
   *   adminSigner: ed25519(ownerKp.publicKey),
   *   sessionKey: sessionKp.publicKey,
   *   expiresAt: currentSlot + 9000n,
   * });
   * ```
   */
  async createSession(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminSigner: AdminSigner;
    sessionKey: PublicKey;
    expiresAt: bigint;
    /** Optional permission actions to restrict this session. Empty/omitted = unrestricted. */
    actions?: SessionAction[];
  }): Promise<{ instructions: TransactionInstruction[]; sessionPda: PublicKey }> {
    const sessionKeyBytes = params.sessionKey.toBytes();
    const [sessionPda] = this.findSession(params.walletPda, sessionKeyBytes);
    const s = params.adminSigner;
    const actionsBuffer = params.actions && params.actions.length > 0
      ? serializeActions(params.actions)
      : undefined;

    if (s.type === 'ed25519') {
      const ix = createCreateSessionIx({
        payer: params.payer, walletPda: params.walletPda,
        adminAuthorityPda: s.authorityPda ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0],
        sessionPda, sessionKey: sessionKeyBytes, expiresAt: params.expiresAt,
        actionsBuffer,
        authorizerSigner: s.publicKey, programId: this.programId,
      });
      return { instructions: [ix], sessionPda };
    }

    const adminAuthorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(adminAuthorityPda)) + 1;

    const dataPayload = buildDataPayloadForSession(sessionKeyBytes, params.expiresAt, actionsBuffer);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_CREATE_SESSION]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_CREATE_SESSION,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const ix = createCreateSessionIx({
      payer: params.payer, walletPda: params.walletPda, adminAuthorityPda, sessionPda,
      sessionKey: sessionKeyBytes, expiresAt: params.expiresAt,
      actionsBuffer, authPayload, programId: this.programId,
    });
    return { instructions: [precompileIx, ix], sessionPda };
  }

  // ─── CreateSession (two-phase: prepare → sign externally → finalize) ────

  /**
   * Two-phase CreateSession for real browser passkeys (Mode 1).
   *
   * Flow:
   *   1. Call this method → get `{ sessionPda, challenge, finalize }`
   *   2. base64url-encode `challenge`, pass to portal dialog
   *   3. Receive WebAuthn response
   *   4. Call `finalize(response)` to get the instructions to send
   */
  async createSessionPrepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    publicKeyBytes: Uint8Array;
    sessionKey: PublicKey;
    expiresAt: bigint;
    actions?: SessionAction[];
    slotOverride?: bigint;
  }): Promise<{
    sessionPda: PublicKey;
    challenge: Uint8Array;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const sessionKeyBytes = params.sessionKey.toBytes();
    const [sessionPda] = this.findSession(params.walletPda, sessionKeyBytes);
    const actionsBuffer = params.actions && params.actions.length > 0
      ? serializeActions(params.actions)
      : undefined;

    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.authorityPda)) + 1;

    const dataPayload = buildDataPayloadForSession(sessionKeyBytes, params.expiresAt, actionsBuffer);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_CREATE_SESSION]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_CREATE_SESSION,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.publicKeyBytes,
    });

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const ix = createCreateSessionIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: params.authorityPda,
        sessionPda,
        sessionKey: sessionKeyBytes,
        expiresAt: params.expiresAt,
        actionsBuffer,
        authPayload,
        programId: this.programId,
      });
      return { instructions: [precompileIx, ix] };
    };

    return { sessionPda, challenge: prepared.challenge, finalize };
  }

  // ─── RemoveAuthority (two-phase: prepare → sign externally → finalize) ─

  /**
   * Two-phase RemoveAuthority for real browser passkeys (Mode 1).
   */
  async removeAuthorityPrepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    adminPublicKeyBytes: Uint8Array;
    targetAuthorityPda: PublicKey;
    refundDestination?: PublicKey;
    slotOverride?: bigint;
  }): Promise<{
    challenge: Uint8Array;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const refundDest = params.refundDestination ?? params.payer;
    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.adminAuthorityPda)) + 1;

    const signedPayload = concatParts([params.targetAuthorityPda.toBytes(), refundDest.toBytes()]);

    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_REMOVE_AUTHORITY]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_REMOVE_AUTHORITY,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.adminPublicKeyBytes,
    });

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const ix = createRemoveAuthorityIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: params.adminAuthorityPda,
        targetAuthorityPda: params.targetAuthorityPda,
        refundDestination: refundDest,
        authPayload,
        programId: this.programId,
      });
      return { instructions: [precompileIx, ix] };
    };

    return { challenge: prepared.challenge, finalize };
  }

  // ─── RevokeSession (two-phase: prepare → sign externally → finalize) ─

  /**
   * Two-phase RevokeSession for real browser passkeys (Mode 1).
   */
  async revokeSessionPrepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    sessionPda: PublicKey;
    publicKeyBytes: Uint8Array;
    refundDestination?: PublicKey;
    slotOverride?: bigint;
  }): Promise<{
    challenge: Uint8Array;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const refundDest = params.refundDestination ?? params.payer;
    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.adminAuthorityPda)) + 1;

    const signedPayload = concatParts([params.sessionPda.toBytes(), refundDest.toBytes()]);

    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_REVOKE_SESSION]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_REVOKE_SESSION,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.publicKeyBytes,
    });

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const ix = createRevokeSessionIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: params.adminAuthorityPda,
        sessionPda: params.sessionPda,
        refundDestination: refundDest,
        authPayload,
        programId: this.programId,
      });
      return { instructions: [precompileIx, ix] };
    };

    return { challenge: prepared.challenge, finalize };
  }

  // ─── AddAuthority Ed25519 (two-phase) ────────────────────────────────

  /**
   * Two-phase AddAuthority for adding an Ed25519 key, signed by a Secp256r1 passkey (Mode 1).
   */
  async addAuthorityEd25519Prepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminAuthorityPda: PublicKey;
    adminPublicKeyBytes: Uint8Array;
    newEd25519Pubkey: PublicKey;
    role: number;
    slotOverride?: bigint;
  }): Promise<{
    newAuthorityPda: PublicKey;
    challenge: Uint8Array;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const credentialOrPubkey = params.newEd25519Pubkey.toBytes();
    const [newAuthorityPda] = this.findAuthority(params.walletPda, credentialOrPubkey);
    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.adminAuthorityPda)) + 1;

    const dataPayload = buildDataPayloadForAdd(AUTH_TYPE_ED25519, params.role, credentialOrPubkey);
    const signedPayload = concatParts([dataPayload, params.payer.toBytes()]);

    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_ADD_AUTHORITY]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_ADD_AUTHORITY,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.adminPublicKeyBytes,
    });

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const ix = createAddAuthorityIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: params.adminAuthorityPda,
        newAuthorityPda,
        newType: AUTH_TYPE_ED25519,
        newRole: params.role,
        credentialOrPubkey,
        authPayload,
        programId: this.programId,
      });
      return { instructions: [precompileIx, ix] };
    };

    return { newAuthorityPda, challenge: prepared.challenge, finalize };
  }

  // ─── Authorize (two-phase: prepare → sign externally → finalize) ────────

  /**
   * Two-phase Authorize (deferred TX1) for real browser passkeys (Mode 1).
   * Returns challenge for portal signing + deferredPayload for TX2.
   */
  async authorizePrepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    publicKeyBytes: Uint8Array;
    instructions: TransactionInstruction[];
    expiryOffset?: number;
    slotOverride?: bigint;
  }): Promise<{
    challenge: Uint8Array;
    deferredExecPda: PublicKey;
    deferredPayload: DeferredPayload;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const [vaultPda] = this.findVault(params.walletPda);
    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.authorityPda)) + 1;
    const expiryOffset = params.expiryOffset ?? 300;

    const [deferredExecPda] = this.findDeferredExec(params.walletPda, params.authorityPda, counter);

    const tx2FixedAccounts = [params.payer, params.walletPda, vaultPda, deferredExecPda, params.payer];
    const { compactInstructions, remainingAccounts } = buildCompactLayout(tx2FixedAccounts, params.instructions);

    const instructionsHash = computeInstructionsHash(compactInstructions);
    const tx2AccountMetas = [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.walletPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: deferredExecPda, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: false, isWritable: true },
      ...remainingAccounts,
    ];
    const accountsHash = computeAccountsHash(tx2AccountMetas, compactInstructions);
    const expiryOffsetBuf = new Uint8Array(2);
    expiryOffsetBuf[0] = expiryOffset & 0xff;
    expiryOffsetBuf[1] = (expiryOffset >> 8) & 0xff;
    const signedPayload = concatParts([instructionsHash, accountsHash, expiryOffsetBuf]);

    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_AUTHORIZE]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_AUTHORIZE,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.publicKeyBytes,
    });

    const deferredPayload: DeferredPayload = { walletPda: params.walletPda, deferredExecPda, compactInstructions, remainingAccounts };

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const authorizeIx = createAuthorizeIx({
        payer: params.payer,
        walletPda: params.walletPda,
        authorityPda: params.authorityPda,
        deferredExecPda,
        instructionsHash,
        accountsHash,
        expiryOffset,
        authPayload,
        programId: this.programId,
      });
      return { instructions: [precompileIx, authorizeIx] };
    };

    return { challenge: prepared.challenge, deferredExecPda, deferredPayload, finalize };
  }

  // ─── ListAuthorities ─────────────────────────────────────────────────

  /**
   * Fetch all authority accounts for a given wallet PDA.
   */
  async listAuthorities(walletPda: PublicKey): Promise<Array<{
    authorityPda: PublicKey;
    authorityType: number; // 0=ed25519, 1=secp256r1
    role: number;          // 0=owner, 1=admin, 2=spender
    credential: Uint8Array;
    secp256r1Pubkey?: Uint8Array;
  }>> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0, bytes: Buffer.from([2]).toString('base64'), encoding: 'base64' } },
        { memcmp: { offset: 16, bytes: Buffer.from(walletPda.toBytes()).toString('base64'), encoding: 'base64' } },
      ],
    });

    return accounts.map(({ pubkey: authorityPda, account }) => {
      const data = account.data as unknown as Buffer;
      const authorityType = data[1];
      return {
        authorityPda,
        authorityType,
        role: data[2],
        credential: new Uint8Array(data.slice(48, 80)),
        secp256r1Pubkey: authorityType === 1 ? new Uint8Array(data.slice(80, 113)) : undefined,
      };
    });
  }

  // ─── Execute Secp256r1 (two-phase: prepare → sign externally → finalize) ──

  /**
   * Two-phase Secp256r1 execute (Mode 1): builds the challenge now, finalizes once a
   * signature is available.
   *
   * Flow:
   *   1. Call this method → get `{ challenge, finalize }`
   *   2. base64url-encode `challenge`, pass to your portal/dialog
   *   3. Receive `{ signature, authenticatorData, clientDataJsonHash, clientDataJson }` back
   *   4. Call `finalize(...)` to get the instructions to send
   */
  async executeSecp256r1Prepare(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    /** Signer's compressed Secp256r1 public key (33 bytes) */
    publicKeyBytes: Uint8Array;
    /** WebAuthn RP ID used during registration */
    rpId: string;
    instructions: TransactionInstruction[];
    /** Override slot (auto-fetched from connection if omitted) */
    slotOverride?: bigint;
  }): Promise<{
    challenge: Uint8Array;
    finalize(result: WebAuthnResponse): { instructions: TransactionInstruction[] };
  }> {
    const [vaultPda] = this.findVault(params.walletPda);
    const protocolFee = await this.resolveProtocolFee(params.payer);
    const slot = params.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(params.authorityPda)) + 1;

    // Secp256r1: sysvar_instructions at index 4
    const fixedAccounts = [
      params.payer,
      params.walletPda,
      params.authorityPda,
      vaultPda,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ];
    const { compactInstructions, remainingAccounts } = buildCompactLayout(
      fixedAccounts,
      params.instructions,
    );
    const packed = packCompactInstructions(compactInstructions);

    // Accounts hash for signature binding
    const allAccountMetas = [
      { pubkey: params.payer, isSigner: true, isWritable: false },
      { pubkey: params.walletPda, isSigner: false, isWritable: false },
      { pubkey: params.authorityPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];
    const accountsHash = computeAccountsHash(allAccountMetas, compactInstructions);
    const signedPayload = concatParts([packed, accountsHash]);

    // Mode 1: challenge computed from 14-byte prefix only
    const prepared: PreparedSecp256r1 = prepareSecp256r1({
      discriminator: new Uint8Array([DISC_EXECUTE]),
      signedPayload,
      sysvarIxIndex: SYSVAR_IX_INDEX_EXECUTE,
      slot,
      counter,
      payer: params.payer,
      programId: this.programId,
      publicKeyBytes: params.publicKeyBytes,
    });

    const finalize = (result: WebAuthnResponse) => {
      const { authPayload, precompileIx } = finalizeSecp256r1(prepared, result);
      const ix = createExecuteIx({
        payer: params.payer,
        walletPda: params.walletPda,
        authorityPda: params.authorityPda,
        vaultPda,
        packedInstructions: packed,
        authPayload,
        remainingAccounts,
        protocolFee,
        programId: this.programId,
      });
      return { instructions: [precompileIx, ix] };
    };

    return { challenge: prepared.challenge, finalize };
  }

  // ─── Execute (unified, accepts standard TransactionInstructions) ─

  /**
   * Execute arbitrary Solana instructions via the wallet.
   *
   * Works with any signer type: Ed25519, Secp256r1 (passkey), or Session key.
   * Pass standard `TransactionInstruction[]` — the SDK handles compact encoding,
   * account indexing, and signing automatically.
   *
   * @example
   * ```typescript
   * const [vault] = client.findVault(walletPda);
   * const { instructions } = await client.execute({
   *   payer: payer.publicKey,
   *   walletPda,
   *   signer: secp256r1(mySigner),
   *   instructions: [
   *     SystemProgram.transfer({ fromPubkey: vault, toPubkey: recipient, lamports: 1_000_000 }),
   *   ],
   * });
   * await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);
   * ```
   */
  async execute(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    signer: ExecuteSigner;
    instructions: TransactionInstruction[];
  }): Promise<{ instructions: TransactionInstruction[] }> {
    const [vaultPda] = this.findVault(params.walletPda);
    const s = params.signer;
    const protocolFee = await this.resolveProtocolFee(params.payer);

    switch (s.type) {
      case 'ed25519': {
        const authorityPda = s.authorityPda
          ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0];
        // Ed25519: signer at index 4 (program expects it there)
        const fixedAccounts = [params.payer, params.walletPda, authorityPda, vaultPda, s.publicKey];
        const { compactInstructions, remainingAccounts } = buildCompactLayout(fixedAccounts, params.instructions);
        const packed = packCompactInstructions(compactInstructions);
        const ix = createExecuteIx({
          payer: params.payer, walletPda: params.walletPda,
          authorityPda, vaultPda, packedInstructions: packed,
          authorizerSigner: s.publicKey,
          remainingAccounts, protocolFee,
          programId: this.programId,
        });
        return { instructions: [ix] };
      }

      case 'secp256r1': {
        const authorityPda = s.authorityPda
          ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];

        // Build prep context + challenge (no signing yet)
        const { challenge, finalize } = await this.executeSecp256r1Prepare({
          payer: params.payer,
          walletPda: params.walletPda,
          authorityPda,
          publicKeyBytes: s.signer.publicKeyBytes,
          rpId: s.signer.rpId,
          instructions: params.instructions,
          slotOverride: s.slotOverride,
        });

        // Sign the challenge internally
        const { signature, authenticatorData, clientDataJsonHash, clientDataJson } =
          await s.signer.sign(challenge);

        if (!clientDataJson) {
          throw new Error('Signer must return clientDataJson bytes (Mode 1). Ensure your signer returns raw clientDataJSON from the authenticator.');
        }

        // Finalize into [precompileIx, executeIx]
        return finalize({ signature, authenticatorData, clientDataJsonHash, clientDataJson });
      }

      case 'session': {
        // Session: sessionKey as signer is included in fixed accounts for index mapping
        const fixedAccounts = [params.payer, params.walletPda, s.sessionPda, vaultPda, s.sessionKeyPubkey];
        const { compactInstructions, remainingAccounts } = buildCompactLayout(fixedAccounts, params.instructions);
        const packed = packCompactInstructions(compactInstructions);

        // Session key must be prepended to remaining accounts as a signer
        const sessionKeyMeta = { pubkey: s.sessionKeyPubkey, isSigner: true, isWritable: false };
        const allRemaining = [sessionKeyMeta, ...remainingAccounts];

        const ix = createExecuteIx({
          payer: params.payer, walletPda: params.walletPda,
          authorityPda: s.sessionPda, vaultPda, packedInstructions: packed,
          remainingAccounts: allRemaining, protocolFee,
          programId: this.programId,
        });
        return { instructions: [ix] };
      }
    }
  }

  // ─── TransferSol (convenience) ──────────────────────────────────

  /**
   * Transfer SOL from the wallet vault to a recipient.
   * Works with any signer type.
   *
   * @example
   * ```typescript
   * const { instructions } = await client.transferSol({
   *   payer: payer.publicKey,
   *   walletPda,
   *   signer: secp256r1(mySigner),
   *   recipient: destination,
   *   lamports: 1_000_000n,
   * });
   * ```
   */
  async transferSol(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    signer: ExecuteSigner;
    recipient: PublicKey;
    lamports: bigint | number;
  }): Promise<{ instructions: TransactionInstruction[] }> {
    const [vaultPda] = this.findVault(params.walletPda);
    const amount = typeof params.lamports === 'bigint' ? Number(params.lamports) : params.lamports;

    return this.execute({
      payer: params.payer, walletPda: params.walletPda, signer: params.signer,
      instructions: [SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: params.recipient, lamports: amount })],
    });
  }

  // ─── Authorize (deferred execution TX1) ─────────────────────────

  /**
   * Authorize deferred execution. Pass standard TransactionInstructions
   * — the SDK handles compact encoding and hash computation.
   *
   * Returns pre-computed `deferredPayload` for TX2.
   */
  async authorize(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    signer: Secp256r1SignerConfig;
    /** Standard instructions to defer */
    instructions: TransactionInstruction[];
    /** Expiry offset in slots (default 300 = ~2 minutes) */
    expiryOffset?: number;
  }): Promise<{
    instructions: TransactionInstruction[];
    deferredExecPda: PublicKey;
    counter: number;
    deferredPayload: DeferredPayload;
  }> {
    const [vaultPda] = this.findVault(params.walletPda);
    const s = params.signer;
    const authorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(authorityPda)) + 1;
    const expiryOffset = params.expiryOffset ?? 300;

    const [deferredExecPda] = this.findDeferredExec(params.walletPda, authorityPda, counter);

    // TX2 fixed accounts: payer, wallet, vault, deferred, refund_destination (=payer)
    const tx2FixedAccounts = [params.payer, params.walletPda, vaultPda, deferredExecPda, params.payer];
    const { compactInstructions, remainingAccounts } = buildCompactLayout(tx2FixedAccounts, params.instructions);

    // Compute hashes
    const instructionsHash = computeInstructionsHash(compactInstructions);
    const tx2AccountMetas = [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.walletPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: deferredExecPda, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: false, isWritable: true }, // refund dest
      ...remainingAccounts,
    ];
    const accountsHash = computeAccountsHash(tx2AccountMetas, compactInstructions);
    const expiryOffsetBuf = new Uint8Array(2);
    expiryOffsetBuf[0] = expiryOffset & 0xff;
    expiryOffsetBuf[1] = (expiryOffset >> 8) & 0xff;
    const signedPayload = concatParts([instructionsHash, accountsHash, expiryOffsetBuf]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_AUTHORIZE]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_AUTHORIZE,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const authorizeIx = createAuthorizeIx({
      payer: params.payer, walletPda: params.walletPda, authorityPda, deferredExecPda,
      instructionsHash, accountsHash, expiryOffset, authPayload,
      programId: this.programId,
    });

    return {
      instructions: [precompileIx, authorizeIx],
      deferredExecPda,
      counter,
      deferredPayload: { walletPda: params.walletPda, deferredExecPda, compactInstructions, remainingAccounts },
    };
  }

  // ─── ExecuteDeferred (from payload) ─────────────────────────────

  /**
   * Build TX2 from the payload returned by `authorize()`.
   */
  async executeDeferredFromPayload(params: {
    payer: PublicKey;
    deferredPayload: DeferredPayload;
    refundDestination?: PublicKey;
  }): Promise<{ instructions: TransactionInstruction[] }> {
    const [vaultPda] = this.findVault(params.deferredPayload.walletPda);
    const refundDest = params.refundDestination ?? params.payer;
    const packed = packCompactInstructions(params.deferredPayload.compactInstructions);
    const protocolFee = await this.resolveProtocolFee(params.payer);
    const ix = createExecuteDeferredIx({
      payer: params.payer, walletPda: params.deferredPayload.walletPda, vaultPda,
      deferredExecPda: params.deferredPayload.deferredExecPda,
      refundDestination: refundDest, packedInstructions: packed,
      remainingAccounts: params.deferredPayload.remainingAccounts,
      protocolFee,
      programId: this.programId,
    });
    return { instructions: [ix] };
  }

  // ─── ReclaimDeferred ────────────────────────────────────────────

  reclaimDeferred(params: {
    payer: PublicKey;
    deferredExecPda: PublicKey;
    refundDestination?: PublicKey;
  }): { instructions: TransactionInstruction[] } {
    const ix = createReclaimDeferredIx({
      payer: params.payer,
      deferredExecPda: params.deferredExecPda,
      refundDestination: params.refundDestination ?? params.payer,
      programId: this.programId,
    });
    return { instructions: [ix] };
  }

  // ─── RevokeSession ─────────────────────────────────────────────

  /**
   * Revoke a session key early (before expiry).
   * Only Owner or Admin can revoke. Refunds session rent.
   *
   * @example Revoke with Ed25519 admin
   * ```typescript
   * const { instructions } = await client.revokeSession({
   *   payer: payer.publicKey,
   *   walletPda,
   *   adminSigner: ed25519(adminKp.publicKey, adminAuthorityPda),
   *   sessionPda,
   * });
   * ```
   */
  async revokeSession(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    adminSigner: AdminSigner;
    sessionPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<{ instructions: TransactionInstruction[] }> {
    const refundDest = params.refundDestination ?? params.payer;
    const s = params.adminSigner;

    if (s.type === 'ed25519') {
      const ix = createRevokeSessionIx({
        payer: params.payer, walletPda: params.walletPda,
        adminAuthorityPda: s.authorityPda ?? this.findAuthority(params.walletPda, s.publicKey.toBytes())[0],
        sessionPda: params.sessionPda, refundDestination: refundDest,
        authorizerSigner: s.publicKey, programId: this.programId,
      });
      return { instructions: [ix] };
    }

    const adminAuthorityPda = s.authorityPda
      ?? this.findAuthority(params.walletPda, s.signer.credentialIdHash)[0];
    const slot = s.slotOverride ?? BigInt(await this.connection.getSlot());
    const counter = (await this.readCounter(adminAuthorityPda)) + 1;

    const signedPayload = concatParts([
      params.sessionPda.toBytes(), refundDest.toBytes(),
    ]);

    const { authPayload, precompileIx } = await signWithSecp256r1({
      signer: s.signer, discriminator: new Uint8Array([DISC_REVOKE_SESSION]),
      signedPayload, sysvarIxIndex: SYSVAR_IX_INDEX_REVOKE_SESSION,
      slot, counter, payer: params.payer, programId: this.programId,
    });

    const ix = createRevokeSessionIx({
      payer: params.payer, walletPda: params.walletPda, adminAuthorityPda,
      sessionPda: params.sessionPda, refundDestination: refundDest,
      authPayload, programId: this.programId,
    });
    return { instructions: [precompileIx, ix] };
  }

  // ─── Protocol Fee Management ──────────────────────────────────────

  /** Initialize protocol fee configuration (one-time) */
  initializeProtocol(params: {
    payer: PublicKey;
    admin: PublicKey;
    treasury: PublicKey;
    creationFee: bigint;
    executionFee: bigint;
    numShards: number;
  }): { instructions: TransactionInstruction[]; protocolConfigPda: PublicKey } {
    const [protocolConfigPda] = this.findProtocolConfig();
    const ix = createInitializeProtocolIx({
      payer: params.payer, protocolConfigPda,
      admin: params.admin, treasury: params.treasury,
      creationFee: params.creationFee, executionFee: params.executionFee,
      numShards: params.numShards,
      programId: this.programId,
    });
    return { instructions: [ix], protocolConfigPda };
  }

  /** Update protocol fee configuration */
  updateProtocol(params: {
    admin: PublicKey;
    creationFee: bigint;
    executionFee: bigint;
    enabled: boolean;
    newTreasury: PublicKey;
  }): { instructions: TransactionInstruction[] } {
    const [protocolConfigPda] = this.findProtocolConfig();
    const ix = createUpdateProtocolIx({
      admin: params.admin, protocolConfigPda,
      creationFee: params.creationFee, executionFee: params.executionFee,
      enabled: params.enabled, newTreasury: params.newTreasury,
      programId: this.programId,
    });
    return { instructions: [ix] };
  }

  /** Initialize a treasury shard (call once per shard 0..numShards-1) */
  initializeTreasuryShard(params: {
    payer: PublicKey;
    admin: PublicKey;
    shardId: number;
  }): { instructions: TransactionInstruction[]; treasuryShardPda: PublicKey } {
    const [protocolConfigPda] = this.findProtocolConfig();
    const [treasuryShardPda] = this.findTreasuryShard(params.shardId);
    const ix = createInitializeTreasuryShardIx({
      payer: params.payer, protocolConfigPda, admin: params.admin,
      treasuryShardPda, shardId: params.shardId,
      programId: this.programId,
    });
    return { instructions: [ix], treasuryShardPda };
  }

  /** Register a payer for fee tracking (admin-gated) */
  registerPayer(params: {
    payer: PublicKey;
    admin: PublicKey;
    targetPayer: PublicKey;
  }): { instructions: TransactionInstruction[]; feeRecordPda: PublicKey } {
    const [protocolConfigPda] = this.findProtocolConfig();
    const [feeRecordPda] = this.findFeeRecord(params.targetPayer);
    const ix = createRegisterPayerIx({
      payer: params.payer, protocolConfigPda, admin: params.admin,
      feeRecordPda, targetPayer: params.targetPayer,
      programId: this.programId,
    });
    return { instructions: [ix], feeRecordPda };
  }

  /** Withdraw accumulated fees from a treasury shard */
  withdrawTreasury(params: {
    admin: PublicKey;
    shardId: number;
    treasury: PublicKey;
  }): { instructions: TransactionInstruction[] } {
    const [protocolConfigPda] = this.findProtocolConfig();
    const [treasuryShardPda] = this.findTreasuryShard(params.shardId);
    const ix = createWithdrawTreasuryIx({
      admin: params.admin, protocolConfigPda,
      treasuryShardPda, treasury: params.treasury,
      programId: this.programId,
    });
    return { instructions: [ix] };
  }
}
