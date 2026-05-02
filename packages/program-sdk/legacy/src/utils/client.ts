import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { randomFillSync } from 'crypto';
import { PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET } from '../constants';
import {
  findWalletPda,
  findVaultPda,
  findAuthorityPda,
  findSessionPda,
  findDeferredExecPda,
  findProtocolConfigPda,
  findFeeRecordPda,
  findTreasuryShardPda,
} from './pdas';
import { readAuthorityCounter, readAuthorityPubkey } from './secp256r1';
import {
  packCompactInstructions,
  computeAccountsHash,
  computeInstructionsHash,
  type CompactInstruction,
} from './packing';
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
import {
  prepareSecp256r1,
  finalizeSecp256r1,
  buildDataPayloadForAdd,
  buildDataPayloadForTransfer,
  buildDataPayloadForSession,
  type WebAuthnResponse,
  type PreparedSecp256r1,
} from './signing';
import { concatBytes } from './bytes';
import { buildCompactLayout } from './compact';
import { serializeActions, type SessionAction } from './actions';
import type {
  CreateWalletOwner,
  AdminSigner,
  ExecuteSigner,
  Secp256r1SignerConfig,
  Secp256r1Params,
  DeferredPayload,
} from './types';
import type { AccountMeta } from '@solana/web3.js';

// ─── Prepared operation types (for secp256r1 prepare/finalize flow) ──

interface PreparedBase {
  /** SHA-256 challenge to pass to navigator.credentials.get() */
  challenge: Uint8Array;
}

export interface PreparedExecute extends PreparedBase {
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
  _internal: {
    signing: PreparedSecp256r1;
    payer: PublicKey;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    vaultPda: PublicKey;
    packed: Uint8Array;
    remainingAccounts: AccountMeta[];
    protocolFee?: {
      protocolConfigPda: PublicKey;
      feeRecordPda: PublicKey;
      treasuryShardPda: PublicKey;
    };
    /** Auto-prepended payer-self-registration ix (first fee-paying tx only) */
    registerIx?: TransactionInstruction;
    programId: PublicKey;
  };
}

export interface PreparedAddAuthority extends PreparedBase {
  newAuthorityPda: PublicKey;
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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

/** One hit from `findWalletsByAuthority` — enough to bootstrap all downstream calls. */
export interface WalletAuthorityRecord {
  walletPda: PublicKey;
  authorityPda: PublicKey;
  vaultPda: PublicKey;
  /** Role enum: 0=Owner, 1=Admin, 2=Spender */
  role: number;
  /** Authority type enum: 0=Ed25519, 1=Secp256r1 */
  authorityType: number;
}

export interface PreparedAuthorize extends PreparedBase {
  deferredExecPda: PublicKey;
  counter: number;
  /** @internal — opaque signing state threaded to finalize(). Do not touch. */
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

/** Throws if a Uint8Array isn't exactly the expected length. */
function assertByteLength(
  value: Uint8Array,
  expected: number,
  name: string,
): void {
  if (value.length !== expected) {
    throw new Error(
      `${name} must be exactly ${expected} bytes, got ${value.length}`,
    );
  }
}

/** Resolves a CreateWalletOwner to the low-level fields needed by IX builders */
function resolveOwnerFields(owner: CreateWalletOwner): {
  authType: number;
  credentialOrPubkey: Uint8Array;
  secp256r1Pubkey?: Uint8Array;
  rpId?: string;
} {
  if (owner.type === 'ed25519') {
    return {
      authType: AUTH_TYPE_ED25519,
      credentialOrPubkey: owner.publicKey.toBytes(),
    };
  }
  assertByteLength(owner.credentialIdHash, 32, 'credentialIdHash');
  assertByteLength(owner.compressedPubkey, 33, 'compressedPubkey');
  return {
    authType: AUTH_TYPE_SECP256R1,
    credentialOrPubkey: owner.credentialIdHash,
    secp256r1Pubkey: owner.compressedPubkey,
    rpId: owner.rpId,
  };
}

/**
 * Shared pipeline for prepareExecute + prepareAuthorize:
 *  1. runs buildCompactLayout over fixed keys + user instructions
 *  2. assembles the full AccountMeta[] with per-fixed-account flags
 *  3. computes the accounts hash that gets folded into the signed payload
 *
 * Call sites just need to declare the fixed accounts (with their signer/
 * writable flags) and pass the user instructions.
 */
function buildCompactLayoutAndHash(
  fixedAccounts: AccountMeta[],
  userInstructions: TransactionInstruction[],
): {
  compactInstructions: CompactInstruction[];
  remainingAccounts: AccountMeta[];
  allAccountMetas: AccountMeta[];
  accountsHash: Uint8Array;
} {
  const fixedKeys = fixedAccounts.map((a) => a.pubkey);
  const { compactInstructions, remainingAccounts } = buildCompactLayout(
    fixedKeys,
    userInstructions,
  );
  const allAccountMetas: AccountMeta[] = [
    ...fixedAccounts,
    ...remainingAccounts,
  ];
  const accountsHash = computeAccountsHash(allAccountMetas, compactInstructions);
  return {
    compactInstructions,
    remainingAccounts,
    allAccountMetas,
    accountsHash,
  };
}

/**
 * Infer the LazorKit program ID from a Connection's RPC endpoint:
 *
 *   - URLs containing "mainnet" → mainnet program ID
 *   - URLs containing "devnet"  → devnet program ID
 *   - localhost / 127.0.0.1     → devnet program ID (local-validator convention)
 *   - anything else              → throw, caller must pass `programId` explicitly
 *
 * The inference is intentionally narrow: covering Solana's canonical RPCs and
 * common third-party providers (Helius, Triton, QuickNode all encode cluster
 * in the hostname). For air-gapped clusters, forks, mainnet-forks served from
 * an unlabelled RPC, or any unusual setup, callers must pass `programId`
 * explicitly to avoid silently deriving wrong PDAs.
 */
function inferProgramIdFromRpc(connection: Connection): PublicKey {
  const rpc = connection.rpcEndpoint.toLowerCase();
  if (rpc.includes('mainnet')) return PROGRAM_ID_MAINNET;
  if (rpc.includes('devnet')) return PROGRAM_ID_DEVNET;
  if (
    rpc.includes('localhost') ||
    rpc.includes('127.0.0.1') ||
    rpc.includes('0.0.0.0')
  ) {
    return PROGRAM_ID_DEVNET;
  }
  throw new Error(
    `LazorKitClient: cannot infer program ID from RPC endpoint "${connection.rpcEndpoint}". ` +
      `Pass an explicit programId, e.g. ` +
      `\`new LazorKitClient(connection, PROGRAM_ID_MAINNET)\` or ` +
      `\`new LazorKitClient(connection, PROGRAM_ID_DEVNET)\`.`,
  );
}

export class LazorKitClient {
  /** Cached protocol config (fetched on first fee-eligible call) */
  private _protocolConfig:
    | { numShards: number; enabled: boolean }
    | null
    | undefined;

  readonly connection: Connection;
  readonly programId: PublicKey;

  /**
   * Construct a client. The program ID is inferred from the connection's RPC
   * endpoint (mainnet / devnet / localhost), or you can pass it explicitly
   * for forks, custom RPC providers without recognisable hostnames, or
   * tests against arbitrary deploy keypairs:
   *
   * ```ts
   * // Auto-inferred from RPC URL — typical case
   * const client = new LazorKitClient(new Connection(MAINNET_RPC));
   *
   * // Explicit (custom RPC, forks, local-validator with non-default keypair)
   * const client = new LazorKitClient(connection, PROGRAM_ID_MAINNET);
   * ```
   */
  constructor(connection: Connection, programId?: PublicKey) {
    this.connection = connection;
    this.programId = programId ?? inferProgramIdFromRpc(connection);
  }

  // ─── PDA helpers ─────────────────────────────────────────────────

  findWallet(userSeed: Uint8Array) {
    return findWalletPda(userSeed, this.programId);
  }
  findVault(walletPda: PublicKey) {
    return findVaultPda(walletPda, this.programId);
  }
  findAuthority(walletPda: PublicKey, credIdHash: Uint8Array) {
    return findAuthorityPda(walletPda, credIdHash, this.programId);
  }
  findSession(walletPda: PublicKey, sessionKey: Uint8Array) {
    return findSessionPda(walletPda, sessionKey, this.programId);
  }
  findDeferredExec(
    walletPda: PublicKey,
    authorityPda: PublicKey,
    counter: number,
  ) {
    return findDeferredExecPda(
      walletPda,
      authorityPda,
      counter,
      this.programId,
    );
  }
  findProtocolConfig() {
    return findProtocolConfigPda(this.programId);
  }
  findFeeRecord(payerPubkey: PublicKey) {
    return findFeeRecordPda(payerPubkey, this.programId);
  }
  findTreasuryShard(shardId: number) {
    return findTreasuryShardPda(shardId, this.programId);
  }

  /**
   * Fetch and cache the on-chain ProtocolConfig. Returns null if not initialized.
   * Cached after first fetch — call `invalidateProtocolCache()` to refresh.
   */
  async getProtocolConfig(): Promise<{
    numShards: number;
    enabled: boolean;
  } | null> {
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
   * Returns the 4 accounts to append whenever the protocol is initialized and enabled,
   * regardless of whether the payer is registered. The `feeRecordPda` is always derived
   * from the payer; on-chain, the entrypoint detects whether it's a real FeeRecord and
   * only updates reward-tracking counters if so. Unregistered payers still pay the fee.
   *
   * Returns undefined only if the protocol isn't initialized or is disabled.
   */
  async resolveProtocolFee(payer: PublicKey): Promise<
    | {
        protocolConfigPda: PublicKey;
        feeRecordPda: PublicKey;
        treasuryShardPda: PublicKey;
      }
    | undefined
  > {
    const config = await this.getProtocolConfig();
    if (!config || !config.enabled) return undefined;

    const [protocolConfigPda] = this.findProtocolConfig();
    const [feeRecordPda] = this.findFeeRecord(payer);
    // CSPRNG to avoid predictable shard selection. Not a direct exploit vector
    // (fees still land in a valid shard), but violates "no Math.random in
    // crypto-adjacent code" hygiene.
    const randBuf = new Uint8Array(4);
    randomFillSync(randBuf);
    const randU32 = (randBuf[0] | (randBuf[1] << 8) | (randBuf[2] << 16) | (randBuf[3] << 24)) >>> 0;
    const shardId = randU32 % config.numShards;
    const [treasuryShardPda] = this.findTreasuryShard(shardId);
    return { protocolConfigPda, feeRecordPda, treasuryShardPda };
  }

  /**
   * Like {@link resolveProtocolFee} but additionally returns a `registerIx`
   * to prepend when the payer's FeeRecord PDA does not yet exist on-chain.
   * Fee-eligible tx builders use this so apps don't need to manually call
   * `registerPayer()` before their first fee-paying transaction.
   *
   * One extra `getAccountInfo` per first-time tx; subsequent txs short-circuit
   * via an in-memory cache of payers we've already seen registered.
   */
  private _registeredPayers = new Set<string>();

  async resolveProtocolFeeWithRegister(payer: PublicKey): Promise<
    | {
        accounts: {
          protocolConfigPda: PublicKey;
          feeRecordPda: PublicKey;
          treasuryShardPda: PublicKey;
        };
        registerIx?: TransactionInstruction;
      }
    | undefined
  > {
    const accounts = await this.resolveProtocolFee(payer);
    if (!accounts) return undefined;

    const key = payer.toBase58();
    if (this._registeredPayers.has(key)) {
      return { accounts };
    }

    const info = await this.connection.getAccountInfo(accounts.feeRecordPda);
    const exists =
      !!info && info.data.length > 0 && info.data[0] === 6; // FeeRecord discriminator
    if (exists) {
      this._registeredPayers.add(key);
      return { accounts };
    }

    const registerIx = createRegisterPayerIx({
      payer,
      feeRecordPda: accounts.feeRecordPda,
      programId: this.programId,
    });
    // Mark optimistically — the same tx will create it. If it fails we'll
    // re-detect on the next call (set is in-memory only).
    this._registeredPayers.add(key);
    return { accounts, registerIx };
  }

  // ─── Account readers ─────────────────────────────────────────────

  async readCounter(authorityPda: PublicKey): Promise<number> {
    return readAuthorityCounter(this.connection, authorityPda);
  }

  // ─── Secp256r1 prepare/finalize helpers ─────────────────────────────

  private async resolveSecp256r1(walletPda: PublicKey, p: Secp256r1Params) {
    assertByteLength(p.credentialIdHash, 32, 'credentialIdHash');
    if (p.publicKeyBytes) {
      assertByteLength(p.publicKeyBytes, 33, 'publicKeyBytes');
    }
    const authorityPda =
      p.authorityPda ?? this.findAuthority(walletPda, p.credentialIdHash)[0];

    // Fire independent RPC reads in parallel. Overrides short-circuit to
    // `Promise.resolve` so callers that pre-fetch everything make zero network calls.
    const [publicKeyBytes, slot, counter] = await Promise.all([
      p.publicKeyBytes
        ? Promise.resolve(p.publicKeyBytes)
        : readAuthorityPubkey(this.connection, authorityPda),
      p.slotOverride != null
        ? Promise.resolve(p.slotOverride)
        : this.connection.getSlot().then((s) => BigInt(s)),
      this.readCounter(authorityPda).then((c) => c + 1),
    ]);

    return { authorityPda, publicKeyBytes, slot, counter };
  }

  /**
   * Flatten a Secp256r1SignerConfig into the raw Secp256r1Params that the
   * prepare* methods take. Strips the Signer callback — prepare* doesn't
   * sign, it only derives the challenge.
   */
  private extractSecp256r1Params(s: Secp256r1SignerConfig): Secp256r1Params {
    return {
      credentialIdHash: s.signer.credentialIdHash,
      publicKeyBytes: s.signer.publicKeyBytes,
      authorityPda: s.authorityPda,
      slotOverride: s.slotOverride,
    };
  }

  /**
   * Derive the Ed25519 admin's authority PDA, honoring the pre-computed
   * override if the caller supplied one (otherwise a fresh findAuthority).
   */
  private resolveEd25519AuthorityPda(
    s: { publicKey: PublicKey; authorityPda?: PublicKey },
    walletPda: PublicKey,
  ): PublicKey {
    return s.authorityPda ?? this.findAuthority(walletPda, s.publicKey.toBytes())[0];
  }

  /**
   * Thin wrapper around `prepareSecp256r1` that injects this client's
   * programId — every prepare method passes the same `payer` + `programId`
   * + (1-byte) discriminator, so threading those through a helper keeps
   * the per-op site focused on the signedPayload.
   */
  private buildPasskeySigning(args: {
    discriminator: number;
    sysvarIxIndex: number;
    signedPayload: Uint8Array;
    slot: bigint;
    counter: number;
    payer: PublicKey;
    publicKeyBytes: Uint8Array;
  }): PreparedSecp256r1 {
    return prepareSecp256r1({
      discriminator: new Uint8Array([args.discriminator]),
      signedPayload: args.signedPayload,
      sysvarIxIndex: args.sysvarIxIndex,
      slot: args.slot,
      counter: args.counter,
      payer: args.payer,
      programId: this.programId,
      publicKeyBytes: args.publicKeyBytes,
    });
  }

  // ── prepareExecute / finalizeExecute ──

  async prepareExecute(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    instructions: TransactionInstruction[];
  }): Promise<PreparedExecute> {
    const [vaultPda] = this.findVault(params.walletPda);
    // resolveSecp256r1 and protocol-fee resolution are fully independent — run them in parallel.
    const [resolved, fee] = await Promise.all([
      this.resolveSecp256r1(params.walletPda, params.secp256r1),
      this.resolveProtocolFeeWithRegister(params.payer),
    ]);
    const { authorityPda, publicKeyBytes, slot, counter } = resolved;
    const protocolFee = fee?.accounts;
    const registerIx = fee?.registerIx;

    const { compactInstructions, remainingAccounts, accountsHash } =
      buildCompactLayoutAndHash(
        [
          { pubkey: params.payer, isSigner: true, isWritable: false },
          { pubkey: params.walletPda, isSigner: false, isWritable: false },
          { pubkey: authorityPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ],
        params.instructions,
      );
    const packed = packCompactInstructions(compactInstructions);
    const signedPayload = concatBytes([packed, accountsHash]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_EXECUTE,
      sysvarIxIndex: SYSVAR_IX_INDEX_EXECUTE,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        authorityPda,
        vaultPda,
        packed,
        remainingAccounts,
        protocolFee,
        registerIx,
        programId: this.programId,
      },
    };
  }

  finalizeExecute(
    prepared: PreparedExecute,
    response: WebAuthnResponse,
  ): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createExecuteIx({
      payer: i.payer,
      walletPda: i.walletPda,
      authorityPda: i.authorityPda,
      vaultPda: i.vaultPda,
      packedInstructions: i.packed,
      authPayload,
      remainingAccounts: i.remainingAccounts,
      protocolFee: i.protocolFee,
      programId: i.programId,
    });
    const head = i.registerIx ? [i.registerIx, precompileIx] : [precompileIx];
    return { instructions: [...head, ix] };
  }

  // ── prepareAddAuthority / finalizeAddAuthority ──

  /**
   * Phase 1 of adding a new authority under a passkey admin. Computes the
   * WebAuthn challenge that must be passed to `navigator.credentials.get()`.
   * After the authenticator signs, call `finalizeAddAuthority()` to build
   * the transaction instructions.
   *
   * Returns `{ challenge, _internal }`. Treat `_internal` as opaque state —
   * it carries the signing context through to the finalize step.
   */
  async prepareAddAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    newAuthority: CreateWalletOwner;
    role: number;
  }): Promise<PreparedAddAuthority> {
    const {
      authType: newType,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    } = resolveOwnerFields(params.newAuthority);
    const [newAuthorityPda] = this.findAuthority(
      params.walletPda,
      credentialOrPubkey,
    );
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );

    const dataPayload = buildDataPayloadForAdd(
      newType,
      params.role,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    );
    const signedPayload = concatBytes([dataPayload, params.payer.toBytes()]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_ADD_AUTHORITY,
      sysvarIxIndex: SYSVAR_IX_INDEX_ADD_AUTHORITY,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      newAuthorityPda,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: authorityPda,
        newAuthorityPda,
        newType,
        newRole: params.role,
        credentialOrPubkey,
        secp256r1Pubkey,
        rpId,
        programId: this.programId,
      },
    };
  }

  finalizeAddAuthority(
    prepared: PreparedAddAuthority,
    response: WebAuthnResponse,
  ): { instructions: TransactionInstruction[]; newAuthorityPda: PublicKey } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createAddAuthorityIx({
      payer: i.payer,
      walletPda: i.walletPda,
      adminAuthorityPda: i.adminAuthorityPda,
      newAuthorityPda: i.newAuthorityPda,
      newType: i.newType,
      newRole: i.newRole,
      credentialOrPubkey: i.credentialOrPubkey,
      secp256r1Pubkey: i.secp256r1Pubkey,
      rpId: i.rpId,
      authPayload,
      programId: i.programId,
    });
    return {
      instructions: [precompileIx, ix],
      newAuthorityPda: i.newAuthorityPda,
    };
  }

  // ── prepareRemoveAuthority / finalizeRemoveAuthority ──

  /**
   * Phase 1 of removing an authority under a passkey admin. Computes the
   * WebAuthn challenge; finalize with the authenticator response to produce
   * the transaction instructions. The target authority's PDA is closed and
   * its rent refunded to `refundDestination` on finalize+send.
   */
  async prepareRemoveAuthority(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    targetAuthorityPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<PreparedRemoveAuthority> {
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );

    const signedPayload = concatBytes([
      params.targetAuthorityPda.toBytes(),
      refundDest.toBytes(),
    ]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_REMOVE_AUTHORITY,
      sysvarIxIndex: SYSVAR_IX_INDEX_REMOVE_AUTHORITY,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: authorityPda,
        targetAuthorityPda: params.targetAuthorityPda,
        refundDestination: refundDest,
        programId: this.programId,
      },
    };
  }

  finalizeRemoveAuthority(
    prepared: PreparedRemoveAuthority,
    response: WebAuthnResponse,
  ): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createRemoveAuthorityIx({
      payer: i.payer,
      walletPda: i.walletPda,
      adminAuthorityPda: i.adminAuthorityPda,
      targetAuthorityPda: i.targetAuthorityPda,
      refundDestination: i.refundDestination,
      authPayload,
      programId: i.programId,
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
    const {
      authType: newType,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    } = resolveOwnerFields(params.newOwner);
    const [newOwnerAuthorityPda] = this.findAuthority(
      params.walletPda,
      credentialOrPubkey,
    );
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );

    const dataPayload = buildDataPayloadForTransfer(
      newType,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    );
    const signedPayload = concatBytes([
      dataPayload,
      params.payer.toBytes(),
      refundDest.toBytes(),
    ]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_TRANSFER_OWNERSHIP,
      sysvarIxIndex: SYSVAR_IX_INDEX_TRANSFER_OWNERSHIP,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      newOwnerAuthorityPda,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        currentOwnerAuthorityPda: authorityPda,
        newOwnerAuthorityPda,
        refundDestination: refundDest,
        newType,
        credentialOrPubkey,
        secp256r1Pubkey,
        rpId,
        programId: this.programId,
      },
    };
  }

  finalizeTransferOwnership(
    prepared: PreparedTransferOwnership,
    response: WebAuthnResponse,
  ): {
    instructions: TransactionInstruction[];
    newOwnerAuthorityPda: PublicKey;
  } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createTransferOwnershipIx({
      payer: i.payer,
      walletPda: i.walletPda,
      currentOwnerAuthorityPda: i.currentOwnerAuthorityPda,
      newOwnerAuthorityPda: i.newOwnerAuthorityPda,
      refundDestination: i.refundDestination,
      newType: i.newType,
      credentialOrPubkey: i.credentialOrPubkey,
      secp256r1Pubkey: i.secp256r1Pubkey,
      rpId: i.rpId,
      authPayload,
      programId: i.programId,
    });
    return {
      instructions: [precompileIx, ix],
      newOwnerAuthorityPda: i.newOwnerAuthorityPda,
    };
  }

  // ── prepareCreateSession / finalizeCreateSession ──

  /**
   * Phase 1 of creating a session under a passkey admin. Computes the
   * WebAuthn challenge; after the authenticator signs, call
   * `finalizeCreateSession()` to build the transaction. The session PDA
   * is created and funded by `payer` on finalize+send.
   */
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
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );
    const actionsBuffer =
      params.actions && params.actions.length > 0
        ? serializeActions(params.actions)
        : undefined;

    const dataPayload = buildDataPayloadForSession(
      sessionKeyBytes,
      params.expiresAt,
      actionsBuffer,
    );
    const signedPayload = concatBytes([dataPayload, params.payer.toBytes()]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_CREATE_SESSION,
      sysvarIxIndex: SYSVAR_IX_INDEX_CREATE_SESSION,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      sessionPda,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: authorityPda,
        sessionPda,
        sessionKey: sessionKeyBytes,
        expiresAt: params.expiresAt,
        actionsBuffer,
        programId: this.programId,
      },
    };
  }

  finalizeCreateSession(
    prepared: PreparedCreateSession,
    response: WebAuthnResponse,
  ): { instructions: TransactionInstruction[]; sessionPda: PublicKey } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createCreateSessionIx({
      payer: i.payer,
      walletPda: i.walletPda,
      adminAuthorityPda: i.adminAuthorityPda,
      sessionPda: i.sessionPda,
      sessionKey: i.sessionKey,
      expiresAt: i.expiresAt,
      actionsBuffer: i.actionsBuffer,
      authPayload,
      programId: i.programId,
    });
    return { instructions: [precompileIx, ix], sessionPda: i.sessionPda };
  }

  // ── prepareRevokeSession / finalizeRevokeSession ──

  /**
   * Phase 1 of revoking a session under a passkey admin. Computes the
   * WebAuthn challenge; finalize with the authenticator response. The
   * session PDA is closed and rent refunded to `refundDestination` on
   * finalize+send.
   */
  async prepareRevokeSession(params: {
    payer: PublicKey;
    walletPda: PublicKey;
    secp256r1: Secp256r1Params;
    sessionPda: PublicKey;
    refundDestination?: PublicKey;
  }): Promise<PreparedRevokeSession> {
    const refundDest = params.refundDestination ?? params.payer;
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );

    const signedPayload = concatBytes([
      params.sessionPda.toBytes(),
      refundDest.toBytes(),
    ]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_REVOKE_SESSION,
      sysvarIxIndex: SYSVAR_IX_INDEX_REVOKE_SESSION,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: authorityPda,
        sessionPda: params.sessionPda,
        refundDestination: refundDest,
        programId: this.programId,
      },
    };
  }

  finalizeRevokeSession(
    prepared: PreparedRevokeSession,
    response: WebAuthnResponse,
  ): { instructions: TransactionInstruction[] } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const ix = createRevokeSessionIx({
      payer: i.payer,
      walletPda: i.walletPda,
      adminAuthorityPda: i.adminAuthorityPda,
      sessionPda: i.sessionPda,
      refundDestination: i.refundDestination,
      authPayload,
      programId: i.programId,
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
    const { authorityPda, publicKeyBytes, slot, counter } = await this.resolveSecp256r1(
      params.walletPda,
      params.secp256r1,
    );
    const expiryOffset = params.expiryOffset ?? 300;
    const [deferredExecPda] = this.findDeferredExec(
      params.walletPda,
      authorityPda,
      counter,
    );

    // The compact layout reflects TX2 (ExecuteDeferred) account order, because
    // that's the set of accounts the on-chain verifier will hash when replaying.
    const { compactInstructions, remainingAccounts, accountsHash } =
      buildCompactLayoutAndHash(
        [
          { pubkey: params.payer, isSigner: true, isWritable: true },
          { pubkey: params.walletPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: deferredExecPda, isSigner: false, isWritable: true },
          { pubkey: params.payer, isSigner: false, isWritable: true },
        ],
        params.instructions,
      );
    const instructionsHash = computeInstructionsHash(compactInstructions);
    const expiryOffsetBuf = new Uint8Array(2);
    expiryOffsetBuf[0] = expiryOffset & 0xff;
    expiryOffsetBuf[1] = (expiryOffset >> 8) & 0xff;
    const signedPayload = concatBytes([
      instructionsHash,
      accountsHash,
      expiryOffsetBuf,
    ]);

    const signing = this.buildPasskeySigning({
      discriminator: DISC_AUTHORIZE,
      sysvarIxIndex: SYSVAR_IX_INDEX_AUTHORIZE,
      signedPayload,
      slot,
      counter,
      payer: params.payer,
      publicKeyBytes,
    });

    return {
      challenge: signing.challenge,
      deferredExecPda,
      counter,
      _internal: {
        signing,
        payer: params.payer,
        walletPda: params.walletPda,
        authorityPda,
        deferredExecPda,
        instructionsHash,
        accountsHash,
        expiryOffset,
        compactInstructions,
        remainingAccounts,
        programId: this.programId,
      },
    };
  }

  finalizeAuthorize(
    prepared: PreparedAuthorize,
    response: WebAuthnResponse,
  ): {
    instructions: TransactionInstruction[];
    deferredExecPda: PublicKey;
    counter: number;
    deferredPayload: DeferredPayload;
  } {
    const i = prepared._internal;
    const { authPayload, precompileIx } = finalizeSecp256r1(
      i.signing,
      response,
    );
    const authorizeIx = createAuthorizeIx({
      payer: i.payer,
      walletPda: i.walletPda,
      authorityPda: i.authorityPda,
      deferredExecPda: i.deferredExecPda,
      instructionsHash: i.instructionsHash,
      accountsHash: i.accountsHash,
      expiryOffset: i.expiryOffset,
      authPayload,
      programId: i.programId,
    });
    return {
      instructions: [precompileIx, authorizeIx],
      deferredExecPda: i.deferredExecPda,
      counter: prepared.counter,
      deferredPayload: {
        walletPda: i.walletPda,
        deferredExecPda: i.deferredExecPda,
        compactInstructions: i.compactInstructions,
        remainingAccounts: i.remainingAccounts,
      },
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
  ): Promise<WalletAuthorityRecord[]> {
    assertByteLength(credential, 32, 'credential');

    const typeValue =
      authorityType === 'ed25519' ? AUTH_TYPE_ED25519 : AUTH_TYPE_SECP256R1;

    // Filters:
    //   offset 0: discriminator == 2 (Authority)
    //   offset 1: authority_type == typeValue
    //   offset 48: credential bytes match
    const discAndType = Buffer.from([2, typeValue]);

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: discAndType.toString('base64'),
            encoding: 'base64',
          },
        },
        {
          memcmp: {
            offset: 48,
            bytes: Buffer.from(credential).toString('base64'),
            encoding: 'base64',
          },
        },
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
  }): Promise<{
    instructions: TransactionInstruction[];
    walletPda: PublicKey;
    vaultPda: PublicKey;
    authorityPda: PublicKey;
  }> {
    assertByteLength(params.userSeed, 32, 'userSeed');
    const [walletPda] = this.findWallet(params.userSeed);
    const [vaultPda] = this.findVault(walletPda);
    const { authType, credentialOrPubkey, secp256r1Pubkey, rpId } =
      resolveOwnerFields(params.owner);
    const [authorityPda, authBump] = this.findAuthority(
      walletPda,
      credentialOrPubkey,
    );

    const fee = await this.resolveProtocolFeeWithRegister(params.payer);

    const ix = createCreateWalletIx({
      payer: params.payer,
      walletPda,
      vaultPda,
      authorityPda,
      userSeed: params.userSeed,
      authType,
      authBump,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
      protocolFee: fee?.accounts,
      programId: this.programId,
    });
    const instructions = fee?.registerIx ? [fee.registerIx, ix] : [ix];
    return { instructions, walletPda, vaultPda, authorityPda };
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
  }): Promise<{
    instructions: TransactionInstruction[];
    newAuthorityPda: PublicKey;
  }> {
    const {
      authType: newType,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    } = resolveOwnerFields(params.newAuthority);
    const [newAuthorityPda] = this.findAuthority(
      params.walletPda,
      credentialOrPubkey,
    );
    const s = params.adminSigner;

    if (s.type === 'ed25519') {
      const ix = createAddAuthorityIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: this.resolveEd25519AuthorityPda(s, params.walletPda),
        newAuthorityPda,
        newType,
        newRole: params.role,
        credentialOrPubkey,
        secp256r1Pubkey,
        rpId,
        authorizerSigner: s.publicKey,
        programId: this.programId,
      });
      return { instructions: [ix], newAuthorityPda };
    }

    // Secp256r1 — delegate to prepare/finalize
    const prepared = await this.prepareAddAuthority({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: this.extractSecp256r1Params(s),
      newAuthority: params.newAuthority,
      role: params.role,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeAddAuthority(prepared, response);
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
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: this.resolveEd25519AuthorityPda(s, params.walletPda),
        targetAuthorityPda: params.targetAuthorityPda,
        refundDestination: refundDest,
        authorizerSigner: s.publicKey,
        programId: this.programId,
      });
      return { instructions: [ix] };
    }

    // Secp256r1 — delegate to prepare/finalize
    const prepared = await this.prepareRemoveAuthority({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: this.extractSecp256r1Params(s),
      targetAuthorityPda: params.targetAuthorityPda,
      refundDestination: params.refundDestination,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeRemoveAuthority(prepared, response);
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
  }): Promise<{
    instructions: TransactionInstruction[];
    newOwnerAuthorityPda: PublicKey;
  }> {
    const {
      authType: newType,
      credentialOrPubkey,
      secp256r1Pubkey,
      rpId,
    } = resolveOwnerFields(params.newOwner);
    const [newOwnerAuthorityPda] = this.findAuthority(
      params.walletPda,
      credentialOrPubkey,
    );
    const refundDest = params.refundDestination ?? params.payer;
    const s = params.ownerSigner;

    if (s.type === 'ed25519') {
      const ix = createTransferOwnershipIx({
        payer: params.payer,
        walletPda: params.walletPda,
        currentOwnerAuthorityPda: this.resolveEd25519AuthorityPda(s, params.walletPda),
        newOwnerAuthorityPda,
        refundDestination: refundDest,
        newType,
        credentialOrPubkey,
        secp256r1Pubkey,
        rpId,
        authorizerSigner: s.publicKey,
        programId: this.programId,
      });
      return { instructions: [ix], newOwnerAuthorityPda };
    }

    // Secp256r1 — delegate to prepare/finalize
    const prepared = await this.prepareTransferOwnership({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: this.extractSecp256r1Params(s),
      newOwner: params.newOwner,
      refundDestination: params.refundDestination,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeTransferOwnership(prepared, response);
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
  }): Promise<{
    instructions: TransactionInstruction[];
    sessionPda: PublicKey;
  }> {
    const sessionKeyBytes = params.sessionKey.toBytes();
    const [sessionPda] = this.findSession(params.walletPda, sessionKeyBytes);
    const s = params.adminSigner;
    const actionsBuffer =
      params.actions && params.actions.length > 0
        ? serializeActions(params.actions)
        : undefined;

    if (s.type === 'ed25519') {
      const ix = createCreateSessionIx({
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: this.resolveEd25519AuthorityPda(s, params.walletPda),
        sessionPda,
        sessionKey: sessionKeyBytes,
        expiresAt: params.expiresAt,
        actionsBuffer,
        authorizerSigner: s.publicKey,
        programId: this.programId,
      });
      return { instructions: [ix], sessionPda };
    }

    // Secp256r1 — delegate to prepare/finalize
    const prepared = await this.prepareCreateSession({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: this.extractSecp256r1Params(s),
      sessionKey: params.sessionKey,
      expiresAt: params.expiresAt,
      actions: params.actions,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeCreateSession(prepared, response);
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
    const fee = await this.resolveProtocolFeeWithRegister(params.payer);
    const protocolFee = fee?.accounts;
    const head: TransactionInstruction[] = fee?.registerIx ? [fee.registerIx] : [];

    switch (s.type) {
      case 'ed25519': {
        const authorityPda = this.resolveEd25519AuthorityPda(s, params.walletPda);
        // Ed25519: signer at index 4 (program expects it there)
        const fixedAccounts = [
          params.payer,
          params.walletPda,
          authorityPda,
          vaultPda,
          s.publicKey,
        ];
        const { compactInstructions, remainingAccounts } = buildCompactLayout(
          fixedAccounts,
          params.instructions,
        );
        const packed = packCompactInstructions(compactInstructions);
        const ix = createExecuteIx({
          payer: params.payer,
          walletPda: params.walletPda,
          authorityPda,
          vaultPda,
          packedInstructions: packed,
          authorizerSigner: s.publicKey,
          remainingAccounts,
          protocolFee,
          programId: this.programId,
        });
        return { instructions: [...head, ix] };
      }

      case 'secp256r1': {
        // Delegate to prepare/finalize (which handles its own auto-register)
        const prepared = await this.prepareExecute({
          payer: params.payer,
          walletPda: params.walletPda,
          secp256r1: this.extractSecp256r1Params(s),
          instructions: params.instructions,
        });
        const response = await s.signer.sign(prepared.challenge);
        return this.finalizeExecute(prepared, response);
      }

      case 'session': {
        // Session: sessionKey as signer is included in fixed accounts for index mapping
        const fixedAccounts = [
          params.payer,
          params.walletPda,
          s.sessionPda,
          vaultPda,
          s.sessionKeyPubkey,
        ];
        const { compactInstructions, remainingAccounts } = buildCompactLayout(
          fixedAccounts,
          params.instructions,
        );
        const packed = packCompactInstructions(compactInstructions);

        // Session key must be prepended to remaining accounts as a signer
        const sessionKeyMeta = {
          pubkey: s.sessionKeyPubkey,
          isSigner: true,
          isWritable: false,
        };
        const allRemaining = [sessionKeyMeta, ...remainingAccounts];

        const ix = createExecuteIx({
          payer: params.payer,
          walletPda: params.walletPda,
          authorityPda: s.sessionPda,
          vaultPda,
          packedInstructions: packed,
          remainingAccounts: allRemaining,
          protocolFee,
          programId: this.programId,
        });
        return { instructions: [...head, ix] };
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
    const amount =
      typeof params.lamports === 'bigint'
        ? Number(params.lamports)
        : params.lamports;

    return this.execute({
      payer: params.payer,
      walletPda: params.walletPda,
      signer: params.signer,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: vaultPda,
          toPubkey: params.recipient,
          lamports: amount,
        }),
      ],
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
    // Delegate to prepare/finalize
    const s = params.signer;
    const prepared = await this.prepareAuthorize({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: {
        credentialIdHash: s.signer.credentialIdHash,
        publicKeyBytes: s.signer.publicKeyBytes,
        authorityPda: s.authorityPda,
        slotOverride: s.slotOverride,
      },
      instructions: params.instructions,
      expiryOffset: params.expiryOffset,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeAuthorize(prepared, {
      signature: response.signature,
      authenticatorData: response.authenticatorData,
      clientDataJsonHash: response.clientDataJsonHash,
      clientDataJson: response.clientDataJson,
    });
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
    const packed = packCompactInstructions(
      params.deferredPayload.compactInstructions,
    );
    const fee = await this.resolveProtocolFeeWithRegister(params.payer);
    const ix = createExecuteDeferredIx({
      payer: params.payer,
      walletPda: params.deferredPayload.walletPda,
      vaultPda,
      deferredExecPda: params.deferredPayload.deferredExecPda,
      refundDestination: refundDest,
      packedInstructions: packed,
      remainingAccounts: params.deferredPayload.remainingAccounts,
      protocolFee: fee?.accounts,
      programId: this.programId,
    });
    return { instructions: fee?.registerIx ? [fee.registerIx, ix] : [ix] };
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
        payer: params.payer,
        walletPda: params.walletPda,
        adminAuthorityPda: this.resolveEd25519AuthorityPda(s, params.walletPda),
        sessionPda: params.sessionPda,
        refundDestination: refundDest,
        authorizerSigner: s.publicKey,
        programId: this.programId,
      });
      return { instructions: [ix] };
    }

    // Secp256r1 — delegate to prepare/finalize
    const prepared = await this.prepareRevokeSession({
      payer: params.payer,
      walletPda: params.walletPda,
      secp256r1: this.extractSecp256r1Params(s),
      sessionPda: params.sessionPda,
      refundDestination: params.refundDestination,
    });
    const response = await s.signer.sign(prepared.challenge);
    return this.finalizeRevokeSession(prepared, response);
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
      payer: params.payer,
      protocolConfigPda,
      admin: params.admin,
      treasury: params.treasury,
      creationFee: params.creationFee,
      executionFee: params.executionFee,
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
      admin: params.admin,
      protocolConfigPda,
      creationFee: params.creationFee,
      executionFee: params.executionFee,
      enabled: params.enabled,
      newTreasury: params.newTreasury,
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
      payer: params.payer,
      protocolConfigPda,
      admin: params.admin,
      treasuryShardPda,
      shardId: params.shardId,
      programId: this.programId,
    });
    return { instructions: [ix], treasuryShardPda };
  }

  /**
   * Register a payer for fee-stats tracking. Permissionless: the payer
   * registers themselves (no admin signature required). Idempotent at the
   * SDK level — the fee-eligible builders auto-prepend this only when the
   * FeeRecord doesn't yet exist, so most apps never need to call it directly.
   */
  registerPayer(params: {
    payer: PublicKey;
  }): { instructions: TransactionInstruction[]; feeRecordPda: PublicKey } {
    const [feeRecordPda] = this.findFeeRecord(params.payer);
    const ix = createRegisterPayerIx({
      payer: params.payer,
      feeRecordPda,
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
      admin: params.admin,
      protocolConfigPda,
      treasuryShardPda,
      treasury: params.treasury,
      programId: this.programId,
    });
    return { instructions: [ix] };
  }
}
