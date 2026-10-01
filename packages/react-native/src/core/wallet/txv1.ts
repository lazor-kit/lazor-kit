/**
 * SIMD-0385 transaction v1: a pure writer, the size checks around it, and the
 * wallet's limit policy. Experimental, and devnet-only in the wallets.
 *
 * Byte-identical in packages/react/core/wallet/txv1.ts and
 * packages/react-native/src/core/wallet/txv1.ts: CI runs
 * `node scripts/check-txv1-identical.mjs`, which fails when they differ, so
 * edit one and copy it over the other. The golden vectors are
 * test-vectors/txv1.json (`node scripts/txv1-vectors.mjs`), and
 * tools/txv1-oracle checks this writer against @solana/kit 8.4.0 and
 * @solana/web3.js 1.99.0.
 *
 * No network, storage, globals, TextEncoder or WebCrypto: web3.js and
 * @noble/curves only, so the same file runs on Hermes. BigInt is needed only
 * for a priority fee, which the wallets never set.
 *
 * Wire layout (the signatures come last, unlike legacy and v0):
 *
 *   0x81 | numRequiredSignatures u8 | numReadonlySigned u8 | numReadonlyUnsigned u8
 *   | configMask u32 LE | blockhash [32] | numInstructions u8 | numAddresses u8
 *   | addresses [32 × numAddresses]
 *   | config values in bit order: priority fee u64 (bits 0+1), compute-unit limit u32 (bit 2),
 *     loaded-accounts data size limit u32 (bit 3), heap size u32 (bit 4, never written here)
 *   | per instruction: programIndex u8, numAccounts u8, dataLength u16 LE
 *   | per instruction: account indexes, then data
 *   | signatures [64 × numRequiredSignatures], signer i over everything before them
 */
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Signer,
  type TransactionInstruction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';

// ─── Limits ─────────────────────────────────────────────────────────────────

/** First byte of a v1 transaction: the version flag 0x80 with version 1. */
export const TX_V1_VERSION_PREFIX = 0x81;

/** SIMD-0385: a v1 transaction over any of these fails sanitization. */
export const TX_V1_MAX_BYTES = 4096;
export const TX_V1_MAX_ADDRESSES = 64;
export const TX_V1_MAX_INSTRUCTIONS = 64;
export const TX_V1_MAX_SIGNERS = 12;
export const TX_V1_MAX_ACCOUNTS_PER_INSTRUCTION = 255;
export const TX_V1_MAX_DATA_PER_INSTRUCTION = 0xffff;

/**
 * Legacy and v0: the packet size, and the runtime's 64 account locks, which
 * count the accounts a lookup table resolves as well as the static ones.
 */
export const V0_MAX_BYTES = 1232;
export const V0_MAX_ACCOUNTS = 64;

/** The largest compute-unit limit and loaded-accounts data size limit a transaction may request. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
export const MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

/**
 * The wallet's floors for the limits it sets. Every LazorKit transaction loads
 * about 161 KB, almost all of it the program's programdata; 196,608 (6 × 32 KiB)
 * leaves room for a programdata extension of about 35 KB.
 */
export const TX_V1_MIN_COMPUTE_UNIT_LIMIT = 20_000;
export const TX_V1_MIN_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 196_608;

/**
 * The limits used when no simulation is available, and to size a draft: the
 * config always holds exactly these two fields, so a draft is as long as the
 * final transaction. In v1 the fee does not depend on them.
 */
export const TX_V1_CEILING_CONFIG: TxV1Config = Object.freeze({
  computeUnitLimit: MAX_COMPUTE_UNIT_LIMIT,
  loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
});

/** The LazorKit program's own ceilings on an Execute payload (program/src/compact.rs). */
export const LAZORKIT_MAX_INNER_INSTRUCTIONS = 16;
/**
 * The program's fixed 32 KiB heap runs out when one inner instruction has more
 * than 64 account metas and Σ(1 + metas) over all inner instructions is more
 * than 128 (measured on devnet; a v1 heap request does not lift it).
 */
export const LAZORKIT_HEAP_MAX_METAS = 64;
export const LAZORKIT_HEAP_MAX_TOTAL_METAS = 128;

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');

// Bytes before the addresses: version, header (3), mask (4), blockhash (32),
// instruction count, address count.
const FIXED_BYTES = 42;
const ADDRESS_BYTES = 32;
const SIGNATURE_BYTES = 64;
const MASK_PRIORITY_FEE = 0b00011;
const MASK_COMPUTE_UNIT_LIMIT = 0b00100;
const MASK_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 0b01000;
const CONFIG_FIELDS = ['computeUnitLimit', 'loadedAccountsDataSizeLimit', 'priorityFeeLamports'];

// ─── Writer ─────────────────────────────────────────────────────────────────

/** The transaction config. Exactly what the writer encodes, in the mask's bit order. */
export interface TxV1Config {
  /**
   * 1..1,400,000. Required: in v1 an unset limit is 0, and the transaction
   * fails ("exceeded CUs meter") with its fee charged.
   */
  readonly computeUnitLimit: number;
  /**
   * 1..67,108,864 bytes. Required: unset is 0, and the transaction fails
   * (MaxLoadedAccountsDataSizeExceeded) with its fee charged.
   */
  readonly loadedAccountsDataSizeLimit: number;
  /**
   * Total priority fee in lamports, a u64. The wallets never set it. When
   * present (0n included) both fee bits are set; there is no way to set one.
   */
  readonly priorityFeeLamports?: bigint;
}

/** The first limit a transaction breaks, in the order it is checked. */
export type TxV1Overflow =
  'addresses' | 'signers' | 'instructions' | 'accounts-per-ix' | 'data-per-ix' | 'bytes';

export interface CompiledTransactionV1 {
  /** Within every SIMD-0385 limit. `wire` and `messageLength` are present only then. */
  readonly fits: boolean;
  readonly overflow?: TxV1Overflow;
  /** Wire size: the message plus 64 bytes per required signature. */
  readonly bytes: number;
  /** Unique addresses: fee payer, programs and accounts. */
  readonly addresses: number;
  /** Top-level instructions. */
  readonly instructions: number;
  /** Required signatures, the fee payer's included. */
  readonly signers: number;
  /** The message followed by one zeroed 64-byte slot per signer. */
  readonly wire?: Uint8Array;
  /** Length of the message: the signed part of `wire`. */
  readonly messageLength?: number;
}

/**
 * Compiles to a v1 transaction with empty signature slots.
 *
 * Never throws for size: a transaction over a SIMD-0385 limit returns
 * `fits: false`, the first `overflow`, and its measurements. Throws for a
 * config that is missing a limit or out of range, for a malformed
 * blockhash, and for an instruction whose program is the fee payer: that
 * compiles (to program index 0), and kit and web3.js read it back, but the
 * runtime refuses the message when it sanitizes it, so `fits` would not
 * mean the transaction can be sent.
 *
 * Account order, deduplication, the header and the index remapping come from
 * web3.js's own compiler (`CompiledKeys`, as the legacy and v0 paths use);
 * within a header class the order is first appearance, where kit sorts.
 * `compileToV0Message()` without lookup tables is used because it is the same
 * compiler as `compileToLegacyMessage()` without the base58 round trip of
 * every instruction's data.
 */
export function compileTransactionV1(params: {
  payer: PublicKey;
  blockhash: string;
  instructions: readonly TransactionInstruction[];
  config: TxV1Config;
}): CompiledTransactionV1 {
  const { payer, instructions, config } = params;
  checkConfig(config);
  const blockhash = blockhashBytes(params.blockhash);

  const payerKey = payer.toBase58();
  const keys = new Set<string>([payerKey]);
  const signerKeys = new Set<string>([payerKey]);
  let payloadBytes = 0;
  let accountsOverflow = false;
  let dataOverflow = false;
  for (const [i, ix] of instructions.entries()) {
    const program = ix.programId.toBase58();
    if (program === payerKey) {
      throw new TypeError(
        `txv1: instruction ${i}'s program is the fee payer (${payerKey}); the runtime refuses such a message`
      );
    }
    keys.add(program);
    for (const meta of ix.keys) {
      const key = meta.pubkey.toBase58();
      keys.add(key);
      if (meta.isSigner) signerKeys.add(key);
    }
    if (ix.keys.length > TX_V1_MAX_ACCOUNTS_PER_INSTRUCTION) accountsOverflow = true;
    if (ix.data.length > TX_V1_MAX_DATA_PER_INSTRUCTION) dataOverflow = true;
    payloadBytes += 4 + ix.keys.length + ix.data.length;
  }
  const configBytes = 8 + (config.priorityFeeLamports !== undefined ? 8 : 0);
  const messageLength = FIXED_BYTES + ADDRESS_BYTES * keys.size + configBytes + payloadBytes;
  const measured = {
    bytes: messageLength + SIGNATURE_BYTES * signerKeys.size,
    addresses: keys.size,
    instructions: instructions.length,
    signers: signerKeys.size,
  };
  const overflow: TxV1Overflow | undefined =
    measured.addresses > TX_V1_MAX_ADDRESSES
      ? 'addresses'
      : measured.signers > TX_V1_MAX_SIGNERS
        ? 'signers'
        : measured.instructions > TX_V1_MAX_INSTRUCTIONS
          ? 'instructions'
          : accountsOverflow
            ? 'accounts-per-ix'
            : dataOverflow
              ? 'data-per-ix'
              : measured.bytes > TX_V1_MAX_BYTES
                ? 'bytes'
                : undefined;
  if (overflow) return { fits: false, overflow, ...measured };

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: params.blockhash,
    instructions: [...instructions],
  }).compileToV0Message();
  const { header, staticAccountKeys, compiledInstructions } = message;
  if (
    staticAccountKeys.length !== measured.addresses ||
    header.numRequiredSignatures !== measured.signers
  ) {
    throw new Error('txv1: internal error: the compiled message does not match its measurement');
  }

  const wire = new Uint8Array(measured.bytes);
  let at = 0;
  wire[at++] = TX_V1_VERSION_PREFIX;
  wire[at++] = header.numRequiredSignatures;
  wire[at++] = header.numReadonlySignedAccounts;
  wire[at++] = header.numReadonlyUnsignedAccounts;
  const mask =
    (config.priorityFeeLamports !== undefined ? MASK_PRIORITY_FEE : 0) |
    MASK_COMPUTE_UNIT_LIMIT |
    MASK_LOADED_ACCOUNTS_DATA_SIZE_LIMIT;
  at = writeU32(wire, at, mask);
  wire.set(blockhash, at);
  at += 32;
  wire[at++] = compiledInstructions.length;
  wire[at++] = staticAccountKeys.length;
  for (const key of staticAccountKeys) {
    wire.set(key.toBytes(), at);
    at += ADDRESS_BYTES;
  }
  if (config.priorityFeeLamports !== undefined) {
    at = writeU64(wire, at, config.priorityFeeLamports);
  }
  at = writeU32(wire, at, config.computeUnitLimit);
  at = writeU32(wire, at, config.loadedAccountsDataSizeLimit);
  for (const ix of compiledInstructions) {
    wire[at++] = ix.programIdIndex;
    wire[at++] = ix.accountKeyIndexes.length;
    wire[at++] = ix.data.length & 0xff;
    wire[at++] = ix.data.length >>> 8;
  }
  for (const ix of compiledInstructions) {
    wire.set(ix.accountKeyIndexes, at);
    at += ix.accountKeyIndexes.length;
    wire.set(ix.data, at);
    at += ix.data.length;
  }
  if (at !== messageLength) {
    throw new Error('txv1: internal error: the message is not the length it was measured at');
  }
  return { fits: true, ...measured, wire, messageLength };
}

/**
 * Signs a compiled transaction. Returns a copy of `wire` with an ed25519
 * signature over the message in each signer's slot (slot i belongs to address
 * i). The slots of absent signers, such as a paymaster's fee payer, are left
 * as they are. Deterministic: the same message and key give the same bytes.
 */
export function signTransactionV1(
  compiled: Pick<CompiledTransactionV1, 'wire' | 'messageLength'>,
  signers: readonly Signer[]
): Uint8Array {
  const { wire, messageLength } = compiled;
  if (!wire || messageLength === undefined) {
    throw new Error('txv1: this transaction does not fit, so it cannot be signed');
  }
  const signed = wire.slice();
  const message = signed.subarray(0, messageLength);
  const requiredSignatures = signed[1];
  for (const signer of signers) {
    const publicKey = signer.publicKey.toBytes();
    let index = -1;
    for (let i = 0; i < requiredSignatures && index < 0; i++) {
      const at = FIXED_BYTES + ADDRESS_BYTES * i;
      if (equalBytes(signed.subarray(at, at + ADDRESS_BYTES), publicKey)) index = i;
    }
    if (index < 0) {
      throw new Error(`txv1: ${signer.publicKey.toBase58()} is not a signer of this transaction`);
    }
    const seed = signer.secretKey.subarray(0, 32);
    if (!equalBytes(ed25519.getPublicKey(seed), publicKey)) {
      throw new Error(
        `txv1: the secret key given for ${signer.publicKey.toBase58()} is not its own`
      );
    }
    signed.set(ed25519.sign(message, seed), messageLength + SIGNATURE_BYTES * index);
  }
  return signed;
}

/**
 * What a v1 transaction must not contain. Both are programming errors, never a
 * reason to fall back to another format:
 * - a top-level ComputeBudget instruction: v1 ignores it for limits, it still
 *   costs compute, and between the precompile and the LazorKit instruction it
 *   breaks the passkey check;
 * - a Secp256r1 instruction that is not immediately followed by the LazorKit
 *   instruction it authorizes.
 */
export function assertV1Instructions(
  instructions: readonly TransactionInstruction[],
  lazorkitProgramId: PublicKey
): void {
  instructions.forEach((ix, i) => {
    if (ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      throw new Error(
        `txv1: instruction ${i} is a ComputeBudget instruction; a v1 transaction carries its limits in its config`
      );
    }
  });
  instructions.forEach((ix, i) => {
    if (ix.programId.equals(SECP256R1_PROGRAM_ID)) {
      const next = instructions[i + 1];
      if (!next || !next.programId.equals(lazorkitProgramId)) {
        throw new Error(
          `txv1: the Secp256r1 instruction ${i} must be followed directly by the LazorKit instruction (${lazorkitProgramId.toBase58()})`
        );
      }
    }
  });
}

// ─── v0 measurement ─────────────────────────────────────────────────────────

export interface V0Measurement {
  /** At most 1232 bytes and at most 64 accounts. */
  readonly fits: boolean;
  /** Wire size, or null when web3.js cannot serialize it (its message alone is over 1232 bytes). */
  readonly bytes: number | null;
  /** Account locks: the static accounts plus every account a lookup table resolves. */
  readonly accounts: number;
  readonly instructions: number;
}

/**
 * Measures the v0 form with the caller's lookup tables, as the existing v0
 * path would build it. Both limits are checked explicitly: web3.js only throws
 * when the message alone is over 1232 bytes, and lookup tables save bytes but
 * not locks.
 */
export function measureV0(params: {
  payer: PublicKey;
  blockhash: string;
  instructions: readonly TransactionInstruction[];
  addressLookupTables?: readonly AddressLookupTableAccount[];
}): V0Measurement {
  const { payer, instructions } = params;
  let compiled;
  try {
    compiled = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: params.blockhash,
      instructions: [...instructions],
    }).compileToV0Message(params.addressLookupTables ? [...params.addressLookupTables] : undefined);
  } catch {
    // web3.js cannot compile it (over 256 accounts). Every unique key is a lock.
    const keys = new Set<string>([payer.toBase58()]);
    for (const ix of instructions) {
      keys.add(ix.programId.toBase58());
      for (const meta of ix.keys) keys.add(meta.pubkey.toBase58());
    }
    return { fits: false, bytes: null, accounts: keys.size, instructions: instructions.length };
  }
  const accounts = compiled.addressTableLookups.reduce(
    (n, lookup) => n + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
    compiled.staticAccountKeys.length
  );
  let bytes: number | null;
  try {
    bytes = new VersionedTransaction(compiled).serialize().length;
  } catch {
    bytes = null;
  }
  return {
    fits: bytes !== null && bytes <= V0_MAX_BYTES && accounts <= V0_MAX_ACCOUNTS,
    bytes,
    accounts,
    instructions: instructions.length,
  };
}

// ─── Program ceilings ───────────────────────────────────────────────────────

export interface ProgramCeilingMeasurement {
  readonly innerInstructions: number;
  /** The largest account-meta count of one inner instruction. */
  readonly maxMetas: number;
  /** Σ(1 + metas) over the inner instructions. */
  readonly totalMetas: number;
}

/**
 * Checks an Execute payload (the inner instructions) against the LazorKit
 * program's ceilings, which only a transaction over 1232 bytes can reach. The
 * program rejects these payloads in any format, so the check applies whatever
 * the format. Throws PayloadExceedsProgramLimitsError.
 */
export function checkProgramCeilings(
  innerInstructions: readonly TransactionInstruction[]
): ProgramCeilingMeasurement {
  let maxMetas = 0;
  let totalMetas = 0;
  for (const ix of innerInstructions) {
    maxMetas = Math.max(maxMetas, ix.keys.length);
    totalMetas += 1 + ix.keys.length;
  }
  const measured = { innerInstructions: innerInstructions.length, maxMetas, totalMetas };
  if (measured.innerInstructions > LAZORKIT_MAX_INNER_INSTRUCTIONS) {
    throw new PayloadExceedsProgramLimitsError({ limit: 'inner-instructions', ...measured });
  }
  if (maxMetas > LAZORKIT_HEAP_MAX_METAS && totalMetas > LAZORKIT_HEAP_MAX_TOTAL_METAS) {
    throw new PayloadExceedsProgramLimitsError({ limit: 'heap', ...measured });
  }
  return measured;
}

// ─── Limits ─────────────────────────────────────────────────────────────────

/** The limits a caller may pass with a 'v1' request. */
export interface TxV1LimitOptions {
  /** 1..1,400,000. */
  readonly computeUnitLimit?: number;
  /** 196,608..67,108,864 bytes. */
  readonly loadedAccountsDataSizeLimit?: number;
}

/** The value of a `simulateTransaction` response; only these fields are read. */
export interface TxV1SimulationValue {
  readonly err: unknown;
  readonly unitsConsumed?: number | null;
  readonly loadedAccountsDataSize?: number | null;
}

export type TxV1LimitsSource = 'simulated' | 'ceiling' | 'caller';

/** Throws a RangeError for a caller limit out of range. */
export function assertTxV1LimitOptions(options: TxV1LimitOptions = {}): void {
  if (options.computeUnitLimit !== undefined) {
    integerIn(options.computeUnitLimit, 1, MAX_COMPUTE_UNIT_LIMIT, 'computeUnitLimit');
  }
  if (options.loadedAccountsDataSizeLimit !== undefined) {
    integerIn(
      options.loadedAccountsDataSizeLimit,
      TX_V1_MIN_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
      MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
      'loadedAccountsDataSizeLimit'
    );
  }
}

/** ⌈units × 1.2⌉ + 5,000, at least 20,000 and at most 1,400,000. */
export function computeUnitLimitFromSimulation(unitsConsumed: number): number {
  // ⌈6u / 5⌉ in integers, so no float rounding can add a unit.
  const padded = Math.floor((unitsConsumed * 6 + 4) / 5) + 5_000;
  return Math.min(MAX_COMPUTE_UNIT_LIMIT, Math.max(TX_V1_MIN_COMPUTE_UNIT_LIMIT, padded));
}

/** ⌈loaded × 1.1⌉ rounded up to 32 KiB, at least 196,608 and at most 64 MiB. */
export function loadedAccountsDataSizeLimitFromSimulation(loadedBytes: number): number {
  const page = 32 * 1024;
  const padded = Math.floor((loadedBytes * 11 + 9) / 10);
  const pages = Math.ceil(padded / page) * page;
  return Math.min(
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    Math.max(TX_V1_MIN_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, pages)
  );
}

/**
 * The config to send. A caller's value always wins for its field; when the
 * caller gave both, no simulation is needed (source 'caller'). Otherwise the
 * simulation sets the rest, but only a result with `err === null` and both
 * measurements present (source 'simulated'); anything else gives the
 * ceilings (source 'ceiling'), which never block a send and do not change the
 * fee.
 */
export function limitsFromSimulation(
  simulation: TxV1SimulationValue | null | undefined,
  caller: TxV1LimitOptions = {}
): { config: TxV1Config; source: TxV1LimitsSource } {
  assertTxV1LimitOptions(caller);
  const { computeUnitLimit, loadedAccountsDataSizeLimit } = caller;
  if (computeUnitLimit !== undefined && loadedAccountsDataSizeLimit !== undefined) {
    return { config: { computeUnitLimit, loadedAccountsDataSizeLimit }, source: 'caller' };
  }
  const units = simulation?.unitsConsumed;
  const loaded = simulation?.loadedAccountsDataSize;
  const usable =
    !!simulation &&
    simulation.err === null &&
    typeof units === 'number' &&
    Number.isSafeInteger(units) &&
    units >= 0 &&
    typeof loaded === 'number' &&
    Number.isSafeInteger(loaded) &&
    loaded >= 0;
  return {
    config: {
      computeUnitLimit:
        computeUnitLimit ??
        (usable ? computeUnitLimitFromSimulation(units as number) : MAX_COMPUTE_UNIT_LIMIT),
      loadedAccountsDataSizeLimit:
        loadedAccountsDataSizeLimit ??
        (usable
          ? loadedAccountsDataSizeLimitFromSimulation(loaded as number)
          : MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT),
    },
    source: usable ? 'simulated' : 'ceiling',
  };
}

// ─── Worst-case WebAuthn response ───────────────────────────────────────────

/** Added to the clientDataJSON template: Chrome's random extra field measured +109 bytes. */
export const CLIENT_DATA_JSON_SLACK_BYTES = 128;
/** The length assumed for the app's origin when it is not known. */
export const UNKNOWN_TOP_ORIGIN_LENGTH = 64;

/** Shaped like the SDK's WebAuthnResponse. Never signed, never sent. */
export interface WebAuthnPlaceholder {
  readonly signature: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly clientDataJsonHash: Uint8Array;
  readonly clientDataJson: Uint8Array;
}

/**
 * A WebAuthn response at least as long as the real one will be, to measure a
 * passkey transaction before the prompt: the instructions built from it
 * (`finalize*` is pure byte assembly) are exact apart from these lengths.
 *
 * - signature 64 bytes, authenticatorData 37, clientDataJsonHash 32;
 * - clientDataJSON: the cross-origin template
 *   {"type":"webauthn.get","challenge":"<43>","origin":"<portal>","crossOrigin":true,"topOrigin":"<app>"}
 *   with the app's origin (64 characters when unknown), plus 128 bytes.
 *
 * The bytes are not a valid response; only their lengths matter. The
 * measurement after signing, on the real response, stays authoritative.
 */
export function placeholderWebAuthn(params: {
  portalOrigin: string;
  topOrigin?: string;
}): WebAuthnPlaceholder {
  const topOrigin = params.topOrigin ?? 'x'.repeat(UNKNOWN_TOP_ORIGIN_LENGTH);
  const template = utf8(
    '{"type":"webauthn.get","challenge":"' +
      'A'.repeat(43) +
      '","origin":' +
      JSON.stringify(params.portalOrigin) +
      ',"crossOrigin":true,"topOrigin":' +
      JSON.stringify(topOrigin) +
      '}'
  );
  const clientDataJson = new Uint8Array(template.length + CLIENT_DATA_JSON_SLACK_BYTES).fill(0x20);
  clientDataJson.set(template, 0);
  return {
    signature: new Uint8Array(64),
    authenticatorData: new Uint8Array(37),
    clientDataJsonHash: new Uint8Array(32),
    clientDataJson,
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Why a 'v1' request was sent, or measured, as v0. */
export type TxV1UnavailableReason = 'paymaster' | 'not-devnet-v2' | 'fee-token' | 'refused';

const UNAVAILABLE_TEXT: Record<TxV1UnavailableReason, string> = {
  paymaster: 'the paymaster does not accept v1 transactions (acceptsTxV1)',
  'not-devnet-v2': 'v1 is used only with the devnet LazorKit v2 program',
  'fee-token': 'v1 is not used with a fee token',
  refused: 'the paymaster refused a v1 transaction earlier in this session',
};

/**
 * The transaction cannot be sent: it is over the byte or address limit of the
 * format it was measured in. Only a 'v1' request throws it, and never after
 * anything was sent. After signing (`stage: 'after-signing'`) the passkey
 * approved it, but nothing was sent and its approval was not used.
 */
export class TransactionTooLargeError extends Error {
  readonly stage: 'before-signing' | 'after-signing';
  /** The format that was measured. */
  readonly format: 'v1' | 'v0';
  /** Which transaction of a deferred pair. */
  readonly transaction: 'single' | 'tx1' | 'tx2';
  /** Wire bytes; null when web3.js could not serialize the v0 form. */
  readonly bytes: number | null;
  readonly byteLimit: 4096 | 1232;
  /** v1: unique addresses. v0: static plus lookup-resolved accounts. */
  readonly addresses: number;
  readonly addressLimit: 64;
  readonly instructions: number;
  /** Set when v1 was asked for but the transaction was measured as v0. */
  readonly v1Unavailable?: TxV1UnavailableReason;

  constructor(details: {
    stage: 'before-signing' | 'after-signing';
    format: 'v1' | 'v0';
    transaction: 'single' | 'tx1' | 'tx2';
    bytes: number | null;
    addresses: number;
    instructions: number;
    v1Unavailable?: TxV1UnavailableReason;
    /** For the message only: the limit compileTransactionV1 found broken. */
    overflow?: TxV1Overflow;
  }) {
    const byteLimit = details.format === 'v1' ? TX_V1_MAX_BYTES : V0_MAX_BYTES;
    const addressLimit = details.format === 'v1' ? TX_V1_MAX_ADDRESSES : V0_MAX_ACCOUNTS;
    const which =
      details.transaction === 'tx1'
        ? 'The Authorize transaction (tx1)'
        : details.transaction === 'tx2'
          ? 'The ExecuteDeferred transaction (tx2)'
          : 'This transaction';
    const size =
      details.overflow && details.overflow !== 'bytes' && details.overflow !== 'addresses'
        ? `it breaks the v1 limit on ${details.overflow}`
        : `${details.bytes === null ? `over ${byteLimit}` : details.bytes} bytes (limit ${byteLimit}) and ` +
          `${details.addresses} ${details.format === 'v1' ? 'addresses' : 'accounts'} (limit ${addressLimit})`;
    super(
      `${which} is too large to send as ${details.format}: ${size}.` +
        (details.v1Unavailable
          ? ` v1 was not available: ${UNAVAILABLE_TEXT[details.v1Unavailable]}.`
          : '') +
        (details.stage === 'after-signing'
          ? ' The passkey approved it, but nothing was sent and the approval was not used.'
          : ' Nothing was signed or sent.')
    );
    this.name = 'TransactionTooLargeError';
    this.stage = details.stage;
    this.format = details.format;
    this.transaction = details.transaction;
    this.bytes = details.bytes;
    this.byteLimit = byteLimit;
    this.addresses = details.addresses;
    this.addressLimit = addressLimit;
    this.instructions = details.instructions;
    if (details.v1Unavailable !== undefined) this.v1Unavailable = details.v1Unavailable;
  }
}

/**
 * The payload's inner instructions are over a LazorKit program ceiling, so
 * the program would reject it in any format: more than 16 inner instructions,
 * or the heap rule (LAZORKIT_HEAP_MAX_METAS). Thrown before the prompt;
 * nothing was signed or sent.
 */
export class PayloadExceedsProgramLimitsError extends Error {
  readonly limit: 'inner-instructions' | 'heap';
  readonly innerInstructions: number;
  /** The largest account-meta count of one inner instruction. */
  readonly maxMetas: number;
  /** Σ(1 + metas) over the inner instructions. */
  readonly totalMetas: number;

  constructor(details: {
    limit: 'inner-instructions' | 'heap';
    innerInstructions: number;
    maxMetas: number;
    totalMetas: number;
  }) {
    super(
      (details.limit === 'inner-instructions'
        ? `The payload has ${details.innerInstructions} instructions; the LazorKit program runs at most ${LAZORKIT_MAX_INNER_INSTRUCTIONS}.`
        : `The payload is too large for the LazorKit program's heap: one instruction has ${details.maxMetas} accounts ` +
          `(more than ${LAZORKIT_HEAP_MAX_METAS}) and the instructions have ${details.totalMetas} in all, counting one ` +
          `per instruction (more than ${LAZORKIT_HEAP_MAX_TOTAL_METAS}).`) +
        ' Nothing was signed or sent.'
    );
    this.name = 'PayloadExceedsProgramLimitsError';
    this.limit = details.limit;
    this.innerInstructions = details.innerInstructions;
    this.maxMetas = details.maxMetas;
    this.totalMetas = details.totalMetas;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function checkConfig(config: TxV1Config): void {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError(
      'txv1: a config with computeUnitLimit and loadedAccountsDataSizeLimit is required'
    );
  }
  for (const key of Object.keys(config)) {
    if ((config as unknown as Record<string, unknown>)[key] === undefined) continue;
    if (key === 'heapSize') {
      throw new TypeError(
        "txv1: a heap request is not supported: the LazorKit program's heap is a fixed 32 KiB, and the request only costs compute"
      );
    }
    if (CONFIG_FIELDS.indexOf(key) < 0) throw new TypeError(`txv1: unknown config field ${key}`);
  }
  integerIn(config.computeUnitLimit, 1, MAX_COMPUTE_UNIT_LIMIT, 'computeUnitLimit');
  integerIn(
    config.loadedAccountsDataSizeLimit,
    1,
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    'loadedAccountsDataSizeLimit'
  );
  const fee = config.priorityFeeLamports;
  if (fee !== undefined) {
    if (typeof fee !== 'bigint') throw new TypeError('txv1: priorityFeeLamports must be a bigint');
    if (fee < BigInt(0) || fee > BigInt('18446744073709551615')) {
      throw new RangeError('txv1: priorityFeeLamports must be a u64');
    }
  }
}

function integerIn(value: unknown, min: number, max: number, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `txv1: ${name} must be an integer from ${min} to ${max}, not ${String(value)}` +
        (value === undefined || value === 0
          ? ' (unset or 0 fails on chain with the fee charged)'
          : '')
    );
  }
}

function blockhashBytes(blockhash: string): Uint8Array {
  let key: PublicKey | undefined;
  try {
    key = new PublicKey(blockhash);
  } catch {
    key = undefined;
  }
  // The round trip rejects strings that decode to fewer than 32 bytes.
  if (!key || key.toBase58() !== blockhash) {
    throw new TypeError(`txv1: ${blockhash} is not a base58 32-byte blockhash`);
  }
  return key.toBytes();
}

function writeU32(out: Uint8Array, at: number, value: number): number {
  out[at] = value & 0xff;
  out[at + 1] = (value >>> 8) & 0xff;
  out[at + 2] = (value >>> 16) & 0xff;
  out[at + 3] = (value >>> 24) & 0xff;
  return at + 4;
}

function writeU64(out: Uint8Array, at: number, value: bigint): number {
  let rest = value;
  for (let i = 0; i < 8; i++) {
    out[at + i] = Number(rest & BigInt(0xff));
    rest >>= BigInt(8);
  }
  return at + 8;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** UTF-8 without TextEncoder, which Hermes may lack. A lone surrogate becomes 3 bytes, as with U+FFFD. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else {
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}
