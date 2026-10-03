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
 * No network, storage, globals, TextEncoder or WebCrypto, and no import but
 * @solana/web3.js, so the same file runs on Hermes, and an app bundles one
 * ed25519 signer, web3.js's own (`signTransactionV1`). BigInt is needed only
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
  Ed25519Program,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Signer,
  type TransactionInstruction,
} from '@solana/web3.js';

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
 * The program's heap: pinocchio's default allocator, 32 KiB handed out from
 * the top down and never freed, with its cursor in the lowest 8 bytes. A v1
 * heap request does not change it.
 */
export const LAZORKIT_HEAP_BYTES = 32 * 1024;
export const LAZORKIT_HEAP_USABLE_BYTES = LAZORKIT_HEAP_BYTES - 8;
/**
 * What the guard keeps free of the usable heap: nothing. `lazorkitHeapBytes`
 * is the program's own sum, to the byte (lazorkit-protocol#42 checked it
 * against the allocator's cursor on 112 payloads, and every payload it put
 * over 32,760 ran out of memory), so a margin would only refuse payloads that
 * run. Raise it here, and only here, if the program and the sum ever part.
 * Not counted: a FeeRecord the fee path creates inline, before Execute's own
 * buffers (60 bytes, 64 aligned). The wallet's SDK prepends RegisterPayer
 * when the fee payer has no FeeRecord, so its Executes do not take that path.
 */
export const LAZORKIT_HEAP_MARGIN_BYTES = 0;
/** The most heap a payload may need to pass `checkProgramCeilings`. */
export const LAZORKIT_HEAP_LIMIT_BYTES = LAZORKIT_HEAP_USABLE_BYTES - LAZORKIT_HEAP_MARGIN_BYTES;
/** `state::action::MAX_ACTIONS`: the most actions a policy holds. */
export const LAZORKIT_MAX_POLICY_ACTIONS = 16;

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

// Where a v2 session's or authority's policy starts (program/src/state):
// AccountDiscriminator, SESSION_HEADER_SIZE, AUTHORITY_*_FIXED_LEN, and
// ACTION_HEADER_SIZE (type u8, data length u16, expiry u64).
const AUTHORITY_DISCRIMINATOR = 0x22;
const SESSION_DISCRIMINATOR = 0x23;
const SESSION_HEADER_BYTES = 80;
const AUTHORITY_ED25519_FIXED_BYTES = 48 + 32;
const AUTHORITY_SECP256R1_FIXED_BYTES = 48 + 32 + 33 + 32;
const ACTION_HEADER_BYTES = 11;

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
    signed.set(ed25519Sign(message, signer), messageLength + SIGNATURE_BYTES * index);
  }
  return signed;
}

/**
 * `signer`'s ed25519 signature of `message`, made by web3.js's own signer
 * (the one its transactions use), so an app bundles a single copy of it:
 * importing @noble/curves here gave bundlers that load web3.js's CommonJS
 * build (esbuild does) a second, ESM copy. web3.js reaches that signer
 * publicly only through `Ed25519Program.createInstructionWithPrivateKey`,
 * which checks that the secret key's two halves agree and returns the Ed25519
 * precompile's instruction data: a 16-byte header of u16 offsets, then the
 * public key, the signature and the message, where the header says. The
 * instruction is never sent.
 */
function ed25519Sign(message: Uint8Array, signer: Signer): Uint8Array {
  let data: Uint8Array;
  try {
    data = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: signer.secretKey,
      message,
    }).data;
  } catch {
    // A secret key whose halves disagree, or that is not 64 bytes.
    data = new Uint8Array(0);
  }
  const u16 = (at: number) => (data[at] | (data[at + 1] << 8)) >>> 0;
  const signatureAt = u16(2);
  const publicKeyAt = u16(6);
  if (
    data[0] !== 1 ||
    data.length < signatureAt + SIGNATURE_BYTES ||
    !equalBytes(data.subarray(publicKeyAt, publicKeyAt + ADDRESS_BYTES), signer.publicKey.toBytes())
  ) {
    throw new Error(`txv1: the secret key given for ${signer.publicKey.toBase58()} is not its own`);
  }
  return data.slice(signatureAt, signatureAt + SIGNATURE_BYTES);
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

/**
 * The LazorKit instruction that runs a payload, which decides what it puts on
 * the program's heap:
 * - `secp256r1`: Execute approved by a passkey;
 * - `ed25519`: Execute signed by an Ed25519 authority or a session key;
 * - `deferred`: ExecuteDeferred (TX2 of a deferred pair).
 */
export type LazorKitExecutePath = 'secp256r1' | 'ed25519' | 'deferred';

/**
 * What a policy-bound signer adds to an Execute's heap: a session with
 * actions, or a Delegate authority carrying a policy (an Owner or Admin never
 * carries one). A signer without a policy is checked with none.
 */
export interface LazorKitPolicyHeap {
  /** The actions in the signer's policy, 1 to 16 (`lazorkitPolicyActions`). */
  readonly actions: number;
  /**
   * The unique writable vault-owned token accounts in the Execute's account
   * list: SPL Token or Token-2022 accounts, initialized, whose owner field is
   * the vault and which the transaction locks writable, each counted once
   * however often it is listed. The keys alone do not say which accounts
   * those are; `vaultTokenAccountsBound` bounds the count from the payload.
   */
  readonly vaultTokenAccounts: number;
}

export interface ProgramCeilingMeasurement {
  readonly innerInstructions: number;
  /** The largest account-meta count of one inner instruction. */
  readonly maxMetas: number;
  /** Σ(1 + metas) over the inner instructions. */
  readonly totalMetas: number;
  /** The heap the program allocates to run the payload (`lazorkitHeapBytes`). */
  readonly heapBytes: number;
  /** The policy terms counted in `heapBytes`, when the signer carries a policy. */
  readonly policy?: LazorKitPolicyHeap;
}

/**
 * Checks an Execute payload (the inner instructions) against the LazorKit
 * program's ceilings, which only a transaction over 1232 bytes can reach in
 * practice: at most 16 inner instructions, and the heap the program needs to
 * run them (`lazorkitHeapBytes`) within its 32,760 bytes, less
 * `LAZORKIT_HEAP_MARGIN_BYTES`. The program rejects these payloads in any
 * format. Throws PayloadExceedsProgramLimitsError.
 *
 * `path` defaults to `secp256r1`, which allocates the most. Pass `policy` for
 * a signer that carries one (`signerPolicyHeap`): without it the check is not
 * safe for that signer, since the policy allocates 64 bytes per action and
 * 240 per vault token account beside the payload.
 */
export function checkProgramCeilings(
  innerInstructions: readonly TransactionInstruction[],
  path: LazorKitExecutePath = 'secp256r1',
  policy?: LazorKitPolicyHeap
): ProgramCeilingMeasurement {
  let maxMetas = 0;
  let totalMetas = 0;
  for (const ix of innerInstructions) {
    maxMetas = Math.max(maxMetas, ix.keys.length);
    totalMetas += 1 + ix.keys.length;
  }
  const measured = {
    innerInstructions: innerInstructions.length,
    maxMetas,
    totalMetas,
    heapBytes: lazorkitHeapBytes(innerInstructions, path, policy),
    ...(policy
      ? { policy: { actions: policy.actions, vaultTokenAccounts: policy.vaultTokenAccounts } }
      : {}),
  };
  if (measured.innerInstructions > LAZORKIT_MAX_INNER_INSTRUCTIONS) {
    throw new PayloadExceedsProgramLimitsError({ limit: 'inner-instructions', ...measured });
  }
  if (measured.heapBytes > LAZORKIT_HEAP_LIMIT_BYTES) {
    throw new PayloadExceedsProgramLimitsError({ limit: 'heap', ...measured });
  }
  return measured;
}

/**
 * The heap, in bytes, the LazorKit v2 program allocates to run these inner
 * instructions, alignment included: the exact sum of lazorkit-protocol#42
 * (develop 3979196; docs/Architecture.md, "Compact instruction format"), the
 * devnet release artifact d95e5c2b… and the mainnet one 67d47162…. Every
 * buffer that scales with the payload is allocated once at its final size, on
 * a heap that never frees, in this order, for `k` inner instructions of
 * `n₁ … n_k` accounts (`M` in all, `w` in the widest) in `C` compact bytes:
 *
 * 1. the parsed instructions, 40 bytes each: `40k`;
 * 2. `secp256r1` and `deferred`: the accounts-hash preimage, 33 bytes for each
 *    instruction's program and each of its accounts: `33(k + M)`;
 * 3. `secp256r1`: the signed payload (`C + 32`) and the challenge in base64
 *    (44), so with 2 one piece of `⌈33(k + M) + C + 76⌉₈`;
 * 4. a policy: its actions (32 bytes each), and a 192-byte copy of each vault
 *    token account: `32a + 192t`;
 * 5. the account metas (16 bytes each) and CPI accounts (56), sized to the
 *    widest instruction and reused: `72w`;
 * 6. for each inner instruction, its accounts (8 bytes each) and their signer
 *    flags (1 byte each): `8nᵢ + nᵢ`;
 * 7. a policy: the mint list (48 bytes per vault token account) and its
 *    actions parsed again: `48t + 32a`.
 *
 * Each allocation is aligned down from the one before (8 bytes but for the
 * byte buffers), so a byte buffer is rounded up to 8 by whatever follows it,
 * and the last allocation of all is not rounded. A zero count allocates
 * nothing. ExecuteDeferred has no policy terms: a policy-bound signer cannot
 * reach it, and a policy with `deferred` throws a TypeError.
 *
 * Builds before #42 (devnet's 57bTNW… ran them until slot 507,081,509, when
 * it was upgraded to d95e5c2b…) grew the preimage and the reused buffers by
 * doubling and allocate more than this for many payloads (one inner
 * instruction of 128 accounts, 70 + 70, 16 × 16): the check is exact for a
 * cluster that runs #42, not for one that does not.
 */
export function lazorkitHeapBytes(
  innerInstructions: readonly TransactionInstruction[],
  path: LazorKitExecutePath,
  policy?: LazorKitPolicyHeap
): number {
  if (policy !== undefined) assertPolicyHeap(policy, path);
  // Offset from the start of the heap; allocations go down from the top.
  let top = LAZORKIT_HEAP_BYTES;
  const alloc = (bytes: number, align: number) => {
    if (bytes > 0) top = Math.floor((top - bytes) / align) * align;
  };
  const k = innerInstructions.length;
  let accounts = 0;
  let widest = 0;
  let compact = 1;
  for (const ix of innerInstructions) {
    accounts += ix.keys.length;
    widest = Math.max(widest, ix.keys.length);
    compact += 4 + ix.keys.length + ix.data.length;
  }
  alloc(40 * k, 8);
  if (path !== 'ed25519') alloc(33 * (k + accounts), 1);
  if (path === 'secp256r1') {
    alloc(compact + 32, 1);
    alloc(44, 1);
  }
  if (policy) {
    alloc(32 * policy.actions, 8);
    alloc(192 * policy.vaultTokenAccounts, 8);
  }
  alloc(16 * widest, 8);
  alloc(56 * widest, 8);
  for (const ix of innerInstructions) {
    alloc(8 * ix.keys.length, 8);
    alloc(ix.keys.length, 1);
  }
  if (policy) {
    alloc(48 * policy.vaultTokenAccounts, 8);
    alloc(32 * policy.actions, 8);
  }
  return LAZORKIT_HEAP_BYTES - top;
}

/**
 * The actions in a session's or an authority's policy, read from its account
 * data as the program reads it (`PolicyLocation`, `count_action_headers`): the
 * policy is whatever follows a session's 80-byte header, or an authority's
 * key material (80 bytes for Ed25519, 145 for a passkey), as 11-byte action
 * headers (type, data length u16, expiry u64), each followed by its data.
 * 0 when the account carries none, or is neither a v2 session nor a v2
 * authority. A count over 16 is returned as it is; the program refuses such a
 * policy, and so does `lazorkitHeapBytes`.
 */
export function lazorkitPolicyActions(accountData: Uint8Array): number {
  let offset: number;
  if (accountData[0] === SESSION_DISCRIMINATOR) {
    offset = SESSION_HEADER_BYTES;
  } else if (accountData[0] === AUTHORITY_DISCRIMINATOR && accountData[1] === 0) {
    offset = AUTHORITY_ED25519_FIXED_BYTES;
  } else if (accountData[0] === AUTHORITY_DISCRIMINATOR && accountData[1] === 1) {
    offset = AUTHORITY_SECP256R1_FIXED_BYTES;
  } else {
    return 0;
  }
  let count = 0;
  let cursor = offset;
  while (
    count <= LAZORKIT_MAX_POLICY_ACTIONS &&
    cursor + ACTION_HEADER_BYTES <= accountData.length
  ) {
    cursor += ACTION_HEADER_BYTES + (accountData[cursor + 1] | (accountData[cursor + 2] << 8));
    count++;
  }
  return count;
}

/**
 * An upper bound on a policy's `vaultTokenAccounts` from the payload alone:
 * every unique account an inner instruction marks writable, less
 * `notTokenAccounts` (the vault, a System account with no data, and the fee
 * payer, which the runtime only accepts System-owned).
 *
 * It bounds the program's count when the wallet builds the transaction: the
 * Execute's account list is the payload's accounts, each with the union of
 * its flags, beside the wallet's own (fee payer, wallet, the signer's
 * authority or session, vault, session key or Instructions sysvar, fee
 * accounts), none of them a token account, and the transaction's other
 * instructions lock no other account writable. It is exact when every
 * writable account the payload names is a vault token account, and otherwise
 * counts 240 bytes for each one that is not.
 */
export function vaultTokenAccountsBound(
  innerInstructions: readonly TransactionInstruction[],
  notTokenAccounts: readonly PublicKey[] = []
): number {
  const excluded = new Set(notTokenAccounts.map((key) => key.toBase58()));
  const writable = new Set<string>();
  for (const ix of innerInstructions) {
    for (const meta of ix.keys) {
      const key = meta.pubkey.toBase58();
      if (meta.isWritable && !excluded.has(key)) writable.add(key);
    }
  }
  return writable.size;
}

/**
 * The policy terms to check a payload with (`checkProgramCeilings`), for the
 * signer whose session or authority account data is `signerAccountData`:
 * its actions as the program counts them, and the payload's bound on vault
 * token accounts. Undefined when the signer carries no policy.
 */
export function signerPolicyHeap(params: {
  signerAccountData: Uint8Array;
  innerInstructions: readonly TransactionInstruction[];
  /** Accounts that cannot be token accounts: the vault and the fee payer. */
  notTokenAccounts: readonly PublicKey[];
}): LazorKitPolicyHeap | undefined {
  const actions = lazorkitPolicyActions(params.signerAccountData);
  if (actions === 0) return undefined;
  return {
    actions,
    vaultTokenAccounts: vaultTokenAccountsBound(params.innerInstructions, params.notTokenAccounts),
  };
}

function assertPolicyHeap(policy: LazorKitPolicyHeap, path: LazorKitExecutePath): void {
  if (path === 'deferred') {
    throw new TypeError(
      'txv1: ExecuteDeferred has no policy terms: a policy-bound signer cannot authorize one'
    );
  }
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !Number.isSafeInteger(policy.actions) ||
    policy.actions < 1 ||
    policy.actions > LAZORKIT_MAX_POLICY_ACTIONS ||
    !Number.isSafeInteger(policy.vaultTokenAccounts) ||
    policy.vaultTokenAccounts < 0
  ) {
    throw new RangeError(
      `txv1: a policy holds 1 to ${LAZORKIT_MAX_POLICY_ACTIONS} actions and a count of vault token accounts ` +
        `(a signer without actions has no policy: pass none), not ${JSON.stringify(policy)}`
    );
  }
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
 * or more heap than the program has (`lazorkitHeapBytes`). Thrown before the
 * prompt; nothing was signed or sent.
 */
export class PayloadExceedsProgramLimitsError extends Error {
  readonly limit: 'inner-instructions' | 'heap';
  readonly innerInstructions: number;
  /** The largest account-meta count of one inner instruction. */
  readonly maxMetas: number;
  /** Σ(1 + metas) over the inner instructions. */
  readonly totalMetas: number;
  /** The heap the program would need, in bytes; it has 32,760. */
  readonly heapBytes: number;
  /** The policy terms counted in `heapBytes`, when the signer carries a policy. */
  readonly policy?: LazorKitPolicyHeap;

  constructor(details: {
    limit: 'inner-instructions' | 'heap';
    innerInstructions: number;
    maxMetas: number;
    totalMetas: number;
    heapBytes: number;
    policy?: LazorKitPolicyHeap;
  }) {
    const policy = details.policy
      ? ` beside a policy of ${details.policy.actions} actions and ` +
        `${details.policy.vaultTokenAccounts} vault token accounts`
      : '';
    const margin =
      LAZORKIT_HEAP_MARGIN_BYTES > 0
        ? `, of which the wallet keeps ${LAZORKIT_HEAP_MARGIN_BYTES} free`
        : '';
    super(
      (details.limit === 'inner-instructions'
        ? `The payload has ${details.innerInstructions} instructions; the LazorKit program runs at most ${LAZORKIT_MAX_INNER_INSTRUCTIONS}.`
        : `The payload is too large for the LazorKit program's heap: running its ${details.innerInstructions} ` +
          `instructions (${details.totalMetas - details.innerInstructions} accounts in all, at most ${details.maxMetas} in one)` +
          `${policy} needs ${details.heapBytes} bytes, and the program has ${LAZORKIT_HEAP_USABLE_BYTES}${margin}.`) +
        ' Nothing was signed or sent.'
    );
    this.name = 'PayloadExceedsProgramLimitsError';
    this.limit = details.limit;
    this.innerInstructions = details.innerInstructions;
    this.maxMetas = details.maxMetas;
    this.totalMetas = details.totalMetas;
    this.heapBytes = details.heapBytes;
    if (details.policy !== undefined) this.policy = details.policy;
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
