/**
 * SIMD-0385 transaction v1 in the mobile adapter: whether a 'v1' request goes
 * out as v1, and how it is sent. Experimental, and devnet-only.
 *
 * Nothing here runs unless the caller passed `transactionOptions.txVersion:
 * 'v1'`. Every other request takes the v0 code in ./actions as before.
 *
 * A 'v1' request is sent as v1 only when all of these hold (`gateTxV1`, no
 * network):
 * - the paymaster declares `acceptsTxV1`;
 * - it has not refused a v1 transaction in this app session (-32051);
 * - no `feeToken` is set;
 * - a top-level instruction targets the devnet v2 program, and none targets
 *   another LazorKit program (mainnet, or protocol v1).
 * Otherwise it is sent as v0 by the unchanged code, and the reason is logged
 * once. v0 is never a rescue for a v1 transaction that is too large: the
 * runtime's 64 account locks count the accounts a lookup table resolves too.
 * That is `TransactionTooLargeError`, thrown before anything is sent.
 *
 * Passkey flows decide and measure before the portal opens
 * (`planTxV1BeforePrompt`, with a worst-case WebAuthn response), so the user is
 * never asked to approve a v1 transaction that cannot be sent. A request that
 * goes out as v0 is refused there only when no WebAuthn response could make it
 * fit, so it is no stricter than 'v0'. The real bytes are measured again
 * after signing (`sendViaPaymasterTxV1`), and they decide. The passkey
 * challenge binds neither the format nor the config nor the blockhash, so the
 * format can be chosen after signing. Flows without a prompt (session,
 * executeDeferred) decide and measure once, before anything is signed.
 *
 * A v1 transaction always carries a compute-unit limit and a loaded-accounts
 * data size limit: the caller's, else measured by one simulation bounded to
 * 3 s, else the maximums, which in v1 do not change the fee. The adapter's own
 * top-level ComputeBudget instructions are taken out of a v1 transaction
 * (`stripComputeBudget`): v1 reads its limits from the config, and one between
 * the Secp256r1 instruction and LazorKit's fails the passkey check.
 * SetComputeUnitLimit and SetLoadedAccountsDataSizeLimit become the config.
 *
 * A send that reached the paymaster is never sent again in another format: a
 * -32051 fails that operation, and only later 'v1' requests go out as v0.
 */
import { Buffer } from 'buffer';
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  PublicKey,
  type TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID_DEVNET, PROGRAM_ID_DEVNET_V1, PROGRAM_ID_MAINNET, PROGRAM_ID_MAINNET_V1 } from '../../program';
import { logger } from '../logger';
import { PaymasterError, signAndExecuteTransaction } from '../paymaster';
import { type AuthorityTurn, sendAndConfirm } from './sequence';
import {
  TX_V1_CEILING_CONFIG,
  TransactionTooLargeError,
  assertTxV1LimitOptions,
  assertV1Instructions,
  checkProgramCeilings,
  compileTransactionV1,
  limitsFromSimulation,
  measureV0,
  placeholderWebAuthn,
  signTransactionV1,
  type CompiledTransactionV1,
  type TxV1Config,
  type TxV1LimitOptions,
  type TxV1LimitsSource,
  type TxV1SimulationValue,
  type TxV1UnavailableReason,
  type WebAuthnPlaceholder,
} from './txv1';

/**
 * The JSON-RPC error code of a paymaster that does not accept v1
 * transactions. It answers with it before signing anything.
 */
export const TX_V1_REFUSED_CODE = -32051;

/** How long the simulation that sizes a v1 transaction's limits may take. */
const SIMULATION_TIMEOUT_MS = 3_000;
/** How long any other raw RPC read here may take. */
const READ_TIMEOUT_MS = 10_000;

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
/** Any 32 bytes: a transaction's size does not depend on its blockhash. */
const PLACEHOLDER_BLOCKHASH = '11111111111111111111111111111111';
/** LazorKit programs a v1 transaction must not reach in Phase 1. */
const NOT_V1_PROGRAMS = [PROGRAM_ID_MAINNET, PROGRAM_ID_MAINNET_V1, PROGRAM_ID_DEVNET_V1];

const UNAVAILABLE: Record<TxV1UnavailableReason, string> = {
  paymaster: 'the paymaster does not declare acceptsTxV1',
  refused: 'the paymaster refused a v1 transaction earlier in this session',
  'fee-token': 'v1 is not used with a fee token',
  'not-devnet-v2': 'v1 is used only with the devnet LazorKit v2 program',
};

const COMPUTE_BUDGET_INSTRUCTIONS = [
  'RequestUnits',
  'RequestHeapFrame',
  'SetComputeUnitLimit',
  'SetComputeUnitPrice',
  'SetLoadedAccountsDataSizeLimit',
];

// ─── Module state (one per app, in memory only) ─────────────────────────────

/** Paymaster URLs that refused a v1 transaction (-32051) in this app session. */
const refusedTxV1 = new Set<string>();
/** Reasons already logged: each is logged once per app session. */
const warnedReasons = new Set<TxV1UnavailableReason>();

// ─── Types ──────────────────────────────────────────────────────────────────

/** A paymaster, as `paymasterFor` returns it. */
export interface TxV1Paymaster {
  readonly paymasterUrl: string;
  readonly apiKey?: string;
  readonly acceptsTxV1?: boolean;
}

/** Whether a 'v1' request goes out as v1, or as v0 and why. */
export type TxV1Decision =
  | { readonly v1: true }
  | { readonly v1: false; readonly reason: TxV1UnavailableReason };

/** What a send carries for a 'v1' request (`sendInstructionsViaPaymaster`'s `v1`). */
export interface TxV1Request extends TxV1LimitOptions {
  /**
   * The decision taken before the portal opened, for the transactions the
   * passkey then approved (both of a deferred pair). Absent for a flow
   * without a prompt: the send decides, before anything is signed.
   */
  readonly decision?: TxV1Decision;
  /** Which transaction of a deferred pair. Default `'single'`. */
  readonly transaction?: 'single' | 'tx1' | 'tx2';
  /** The caller's inner instructions, checked against the program's ceilings when no plan was made. */
  readonly payload?: readonly TransactionInstruction[];
  /** The passkey lane's floor: the simulation is read from a node at or past it. */
  readonly minContextSlot?: number;
}

/** A 'v1' send, as `sendInstructionsViaPaymaster` hands it over. */
export interface TxV1SendParams {
  readonly instructions: readonly TransactionInstruction[];
  readonly connection: Connection;
  readonly feePayer: PublicKey;
  readonly paymaster: TxV1Paymaster;
  readonly addressLookupTables?: readonly AddressLookupTableAccount[];
  readonly feeToken?: string;
  readonly extraSigners?: readonly Keypair[];
  readonly turn?: AuthorityTurn;
  readonly createsAuthority?: PublicKey;
  readonly v1?: TxV1Request;
}

/** A transaction's top-level instructions without its ComputeBudget ones. */
export interface ComputeBudgetStrip {
  readonly instructions: TransactionInstruction[];
  /** From a SetComputeUnitLimit (the last, if there are several). */
  readonly computeUnitLimit?: number;
  /** From a SetLoadedAccountsDataSizeLimit (the last, if there are several). */
  readonly loadedAccountsDataSizeLimit?: number;
  /** The ones taken out that have no config field to go to. */
  readonly dropped: readonly string[];
}

// ─── The gate ───────────────────────────────────────────────────────────────

/**
 * Whether a 'v1' request can go out as v1. Local: no network. Rule order, and
 * the first rule that fails is the reason: the paymaster's declaration, its
 * refusal earlier in this session, a fee token, the program.
 *
 * The program rule alone keeps mainnet and protocol-v1 wallets off v1: their
 * instructions target another LazorKit program.
 */
export function gateTxV1(params: {
  paymaster: TxV1Paymaster;
  instructions: readonly TransactionInstruction[];
  feeToken?: string;
}): TxV1Decision {
  if (params.paymaster.acceptsTxV1 !== true) return { v1: false, reason: 'paymaster' };
  if (refusedTxV1.has(params.paymaster.paymasterUrl)) return { v1: false, reason: 'refused' };
  if (params.feeToken) return { v1: false, reason: 'fee-token' };
  const programs = params.instructions.map((ix) => ix.programId);
  const devnetV2 = programs.some((id) => id.equals(PROGRAM_ID_DEVNET));
  const other = programs.some((id) => NOT_V1_PROGRAMS.some((not) => not.equals(id)));
  if (!devnetV2 || other) return { v1: false, reason: 'not-devnet-v2' };
  return { v1: true };
}

/**
 * Take the top-level ComputeBudget instructions out of a v1 transaction.
 * SetComputeUnitLimit and SetLoadedAccountsDataSizeLimit become config
 * values; any other (a priority fee, a heap request) is dropped, and listed
 * in `dropped` for a warning. The v0 path never calls this: its prepended
 * SetComputeUnitLimit stays as it is.
 */
export function stripComputeBudget(instructions: readonly TransactionInstruction[]): ComputeBudgetStrip {
  const kept: TransactionInstruction[] = [];
  const dropped: string[] = [];
  let computeUnitLimit: number | undefined;
  let loadedAccountsDataSizeLimit: number | undefined;
  for (const ix of instructions) {
    if (!ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      kept.push(ix);
      continue;
    }
    const kind = ix.data.length > 0 ? ix.data[0] : -1;
    const name = COMPUTE_BUDGET_INSTRUCTIONS[kind] ?? `ComputeBudget instruction ${kind}`;
    if ((kind === 2 || kind === 4) && ix.data.length === 5) {
      const value = (ix.data[1] | (ix.data[2] << 8) | (ix.data[3] << 16) | (ix.data[4] << 24)) >>> 0;
      if (kind === 2) computeUnitLimit = value;
      else loadedAccountsDataSizeLimit = value;
    } else {
      dropped.push(kind === 2 || kind === 4 ? `a malformed ${name}` : name);
    }
  }
  return { instructions: kept, computeUnitLimit, loadedAccountsDataSizeLimit, dropped };
}

/**
 * The adapter's own prepend, as the v0 path builds it: a SetComputeUnitLimit
 * first when `computeUnitLimit` is set. Used to measure, before the prompt,
 * the transaction the send will build.
 */
export function withComputeUnitLimit(
  instructions: readonly TransactionInstruction[],
  computeUnitLimit?: number,
): TransactionInstruction[] {
  return computeUnitLimit
    ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }), ...instructions]
    : [...instructions];
}

/** A WebAuthn response at least as long as the portal's will be (see txv1.ts). */
export function placeholderFor(portalUrl: string): WebAuthnPlaceholder {
  return placeholderWebAuthn({ portalOrigin: originOf(portalUrl) });
}

/**
 * A WebAuthn response no longer than the portal's can be: a clientDataJSON
 * with only `type`, `challenge` and `origin`. Never signed, never sent.
 */
function shortestWebAuthn(portalUrl: string): WebAuthnPlaceholder {
  const clientDataJson =
    `{"type":"webauthn.get","challenge":"${'A'.repeat(43)}","origin":${JSON.stringify(originOf(portalUrl))}}`;
  return {
    signature: new Uint8Array(64),
    authenticatorData: new Uint8Array(37),
    clientDataJsonHash: new Uint8Array(32),
    clientDataJson: new Uint8Array(Buffer.from(clientDataJson, 'utf8')),
  };
}

/** A URL's origin, with a regular expression: older React Native runtimes do not implement `URL`'s getters. */
function originOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? url;
}

// ─── Before the prompt ──────────────────────────────────────────────────────

/**
 * Decide a passkey flow's format and measure it before the portal opens.
 * Throws, and nothing is signed or sent:
 * - RangeError for a limit out of range;
 * - PayloadExceedsProgramLimitsError when the payload is over the LazorKit
 *   program's ceilings;
 * - TransactionTooLargeError (stage 'before-signing') when the transaction,
 *   or a deferred pair's TX2, cannot be sent in the format decided.
 *
 * `draft` builds the transaction as it will be sent, from a WebAuthn
 * response. As v1 it is measured with one at least as long as the portal's
 * (`placeholderFor`), so the user is not asked to approve what cannot be sent.
 * As v0 (the gate failed) it is refused here only when even the shortest
 * response could not fit: a 'v1' request on a paymaster without v1 is no
 * stricter than 'v0', and between the two the real bytes decide after
 * signing. `tx2` builds a deferred pair's TX2, which carries no WebAuthn bytes
 * and so is measured exactly, in the same format: TX1 is never sent for a TX2
 * that could not be.
 */
export async function planTxV1BeforePrompt(params: {
  paymaster: TxV1Paymaster;
  options: TxV1LimitOptions & { readonly feeToken?: string };
  /** The caller's inner instructions. */
  payload: readonly TransactionInstruction[];
  payer: PublicKey;
  portalUrl: string;
  draft: (webAuthn: WebAuthnPlaceholder) => readonly TransactionInstruction[];
  addressLookupTables?: readonly AddressLookupTableAccount[];
  transaction?: 'single' | 'tx1';
  tx2?: () => Promise<{
    instructions: readonly TransactionInstruction[];
    addressLookupTables?: readonly AddressLookupTableAccount[];
  }>;
}): Promise<TxV1Decision> {
  assertTxV1LimitOptions({
    computeUnitLimit: params.options.computeUnitLimit,
    loadedAccountsDataSizeLimit: params.options.loadedAccountsDataSizeLimit,
  });
  checkProgramCeilings(params.payload);
  const draft = params.draft(placeholderFor(params.portalUrl));
  const decision = gateTxV1({
    paymaster: params.paymaster,
    instructions: draft,
    feeToken: params.options.feeToken,
  });
  const measured = {
    decision,
    payer: params.payer,
    addressLookupTables: params.addressLookupTables,
    stage: 'before-signing' as const,
    transaction: params.transaction ?? 'single',
  };
  if (decision.v1 || fitsV0(draft, params.payer, params.addressLookupTables)) {
    measure({ ...measured, instructions: draft });
  } else {
    measure({ ...measured, instructions: params.draft(shortestWebAuthn(params.portalUrl)) });
  }
  if (params.tx2) {
    const tx2 = await params.tx2();
    measure({
      decision,
      instructions: tx2.instructions,
      payer: params.payer,
      addressLookupTables: tx2.addressLookupTables,
      stage: 'before-signing',
      transaction: 'tx2',
    });
  }
  return decision;
}

function fitsV0(
  instructions: readonly TransactionInstruction[],
  payer: PublicKey,
  addressLookupTables?: readonly AddressLookupTableAccount[],
): boolean {
  return measureV0({ payer, blockhash: PLACEHOLDER_BLOCKHASH, instructions, addressLookupTables }).fits;
}

/**
 * Throws TransactionTooLargeError unless the transaction fits the format
 * decided: v1 as it will be sent (ComputeBudget instructions out, the config's
 * two limits in), or v0 as the unchanged path builds it, with the caller's
 * lookup tables (at most 1232 bytes and 64 account locks).
 */
function measure(params: {
  decision: TxV1Decision;
  instructions: readonly TransactionInstruction[];
  payer: PublicKey;
  addressLookupTables?: readonly AddressLookupTableAccount[];
  stage: 'before-signing' | 'after-signing';
  transaction: 'single' | 'tx1' | 'tx2';
}): void {
  const { decision, payer, stage, transaction } = params;
  if (decision.v1) {
    const compiled = compileTransactionV1({
      payer,
      blockhash: PLACEHOLDER_BLOCKHASH,
      instructions: stripComputeBudget(params.instructions).instructions,
      config: TX_V1_CEILING_CONFIG,
    });
    if (!compiled.fits) {
      throw new TransactionTooLargeError({
        stage,
        format: 'v1',
        transaction,
        bytes: compiled.bytes,
        addresses: compiled.addresses,
        instructions: compiled.instructions,
        overflow: compiled.overflow,
      });
    }
    return;
  }
  const v0 = measureV0({
    payer,
    blockhash: PLACEHOLDER_BLOCKHASH,
    instructions: params.instructions,
    addressLookupTables: params.addressLookupTables,
  });
  if (!v0.fits) {
    throw new TransactionTooLargeError({
      stage,
      format: 'v0',
      transaction,
      bytes: v0.bytes,
      addresses: v0.accounts,
      instructions: v0.instructions,
      v1Unavailable: decision.reason,
    });
  }
}

// ─── The send ───────────────────────────────────────────────────────────────

/**
 * Send a 'v1' request: as v1 when the decision (the plan's, or the gate's now)
 * allows it, else as v0 through `sendV0`, the unchanged path. The real bytes
 * are measured first; a transaction that does not fit throws
 * TransactionTooLargeError and nothing is sent. Its stage is 'after-signing'
 * when the decision came with the request (taken before a passkey prompt, so
 * the passkey has approved by now), else 'before-signing'.
 */
export async function sendViaPaymasterTxV1(
  params: TxV1SendParams,
  sendV0: () => Promise<string>,
): Promise<string> {
  const request = params.v1 ?? {};
  const transaction = request.transaction ?? 'single';
  const stage = request.decision ? 'after-signing' : 'before-signing';
  let decision = request.decision;
  if (!decision) {
    const strip = stripComputeBudget(params.instructions);
    assertTxV1LimitOptions(callerLimits(request, strip));
    if (request.payload) checkProgramCeilings(request.payload);
    decision = gateTxV1({ paymaster: params.paymaster, instructions: params.instructions, feeToken: params.feeToken });
  }
  measure({
    decision,
    instructions: params.instructions,
    payer: params.feePayer,
    addressLookupTables: params.addressLookupTables,
    stage,
    transaction,
  });
  if (!decision.v1) {
    if (!warnedReasons.has(decision.reason)) {
      warnedReasons.add(decision.reason);
      logger.warn(`TxV1: 'v1' requests are sent as v0: ${UNAVAILABLE[decision.reason]}.`);
    }
    return sendV0();
  }
  return sendTxV1(params, request);
}

/** The caller's limits, else what the stripped ComputeBudget instructions said. */
function callerLimits(request: TxV1LimitOptions, strip: ComputeBudgetStrip): TxV1LimitOptions {
  const computeUnitLimit = request.computeUnitLimit ?? strip.computeUnitLimit;
  const loadedAccountsDataSizeLimit = request.loadedAccountsDataSizeLimit ?? strip.loadedAccountsDataSizeLimit;
  return {
    ...(computeUnitLimit !== undefined ? { computeUnitLimit } : {}),
    ...(loadedAccountsDataSizeLimit !== undefined ? { loadedAccountsDataSizeLimit } : {}),
  };
}

async function sendTxV1(params: TxV1SendParams, request: TxV1Request): Promise<string> {
  const { connection, feePayer, paymaster } = params;
  const strip = stripComputeBudget(params.instructions);
  const instructions = strip.instructions;
  // A programming error, never a reason to fall back to another format.
  assertV1Instructions(instructions, PROGRAM_ID_DEVNET);
  for (const name of strip.dropped) {
    logger.warn(`TxV1: ${name} was left out: a v1 transaction carries its limits in its config, and the adapter sets no priority fee or heap size.`);
  }

  // The one call the v0 path makes, too.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const draft = compileTransactionV1({ payer: feePayer, blockhash, instructions, config: TX_V1_CEILING_CONFIG });
  const { config, source } = await limitsFor(connection, draft, callerLimits(request, strip), request.minContextSlot);
  const final = compileTransactionV1({ payer: feePayer, blockhash, instructions, config });
  if (!draft.fits || !final.fits || final.bytes !== draft.bytes) {
    throw new Error('txv1: internal error: the transaction is not the size it was measured at');
  }
  // Signed once the config is final: the signatures cover it.
  const wire = params.extraSigners?.length ? signTransactionV1(final, params.extraSigners) : (final.wire as Uint8Array);
  const serialized = Buffer.from(wire).toString('base64');
  logger.log(
    `TxV1: sending v1, ${final.bytes} bytes, ${final.addresses} addresses, ` +
      `compute units ${config.computeUnitLimit}, loaded data ${config.loadedAccountsDataSizeLimit} (${source})`,
  );

  return sendAndConfirm({
    connection,
    attempt: {
      blockhash,
      lastValidBlockHeight,
      // web3.js reads a v1 transaction with neither getTransaction nor
      // maxSupportedTransactionVersion 0: the logs that tell an inner
      // program's 3006 from LazorKit's are read raw.
      landedLogs: (signature) => landedLogsTxV1(connection, signature),
    },
    send: async () => {
      try {
        // No fee token: the gate sends none as v1.
        return await signAndExecuteTransaction(serialized, paymaster.paymasterUrl, feePayer.toBase58(), paymaster.apiKey);
      } catch (error) {
        // Refused before signing. This operation fails; later 'v1' requests
        // to this paymaster go out as v0.
        if (error instanceof PaymasterError && error.code === TX_V1_REFUSED_CODE) {
          refusedTxV1.add(paymaster.paymasterUrl);
        }
        throw error;
      }
    },
    turn: params.turn,
    createsAuthority: params.createsAuthority,
    simulateLogs: () => simulateLogsTxV1(connection, serialized),
  });
}

/**
 * The limits a v1 transaction goes out with: the caller's when both are
 * given; otherwise one simulation of the unsigned draft, bounded to 3 s, at or
 * past the lane's floor, sizes the rest. Any problem with it gives the
 * maximums: the simulation never holds a send back, and in v1 the fee does
 * not depend on the limits.
 */
async function limitsFor(
  connection: Connection,
  draft: CompiledTransactionV1,
  caller: TxV1LimitOptions,
  minContextSlot: number | undefined,
): Promise<{ config: TxV1Config; source: TxV1LimitsSource }> {
  if (caller.computeUnitLimit !== undefined && caller.loadedAccountsDataSizeLimit !== undefined) {
    return limitsFromSimulation(undefined, caller);
  }
  let simulation: TxV1SimulationValue | undefined;
  let problem: string | undefined;
  try {
    const result = await rpcRaw<{ value?: TxV1SimulationValue } | null>(
      connection,
      'simulateTransaction',
      [
        Buffer.from(draft.wire as Uint8Array).toString('base64'),
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'confirmed',
          ...(minContextSlot !== undefined ? { minContextSlot } : {}),
        },
      ],
      SIMULATION_TIMEOUT_MS,
    );
    simulation = result?.value ?? undefined;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  const limits = limitsFromSimulation(simulation, caller);
  if (limits.source === 'ceiling') {
    const why =
      problem ??
      (simulation?.err != null
        ? `the simulation failed: ${JSON.stringify(simulation.err)}`
        : 'the simulation did not report the units and data it used');
    logger.warn(`TxV1: the limits were not measured (${why}); the transaction goes out with the maximums.`);
  }
  return limits;
}

/** A landed v1 transaction's logs, read raw: maxSupportedTransactionVersion 1. */
async function landedLogsTxV1(connection: Connection, signature: string): Promise<readonly string[] | undefined> {
  const tx = await rpcRaw<{ meta?: { logMessages?: string[] | null } | null } | null>(
    connection,
    'getTransaction',
    [signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }],
    READ_TIMEOUT_MS,
  );
  return tx?.meta?.logMessages ?? undefined;
}

/** These v1 bytes' logs, simulated now (web3.js cannot serialize a v1 transaction to simulate it). */
async function simulateLogsTxV1(connection: Connection, serialized: string): Promise<readonly string[] | null | undefined> {
  const result = await rpcRaw<{ value?: { logs?: string[] | null } } | null>(
    connection,
    'simulateTransaction',
    [serialized, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }],
    READ_TIMEOUT_MS,
  );
  return result?.value?.logs;
}

// ─── Raw JSON-RPC ───────────────────────────────────────────────────────────

interface JsonRpcReply<T> {
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * One JSON-RPC call on the connection's endpoint, answered raw: web3.js's
 * response parsers drop fields this needs, and the peer range (^1.98.2)
 * includes versions that cannot parse a v1 transaction at all. Goes through
 * the connection's own transport (`_rpcRequest`, in every web3.js 1.x), else
 * `fetch`. Bounded to `timeoutMs`; an RPC error rejects with its code.
 */
export async function rpcRaw<T>(connection: Connection, method: string, args: unknown[], timeoutMs: number): Promise<T> {
  const internal = (connection as unknown as {
    _rpcRequest?: (method: string, args: unknown[]) => Promise<JsonRpcReply<T>>;
  })._rpcRequest;
  const request =
    typeof internal === 'function'
      ? internal.call(connection, method, args)
      : postJsonRpc<T>(connection.rpcEndpoint, method, args, timeoutMs);
  const reply = await withTimeout(request, timeoutMs, method);
  if (reply?.error) {
    throw Object.assign(new Error(`${method}: ${reply.error.message}`), {
      code: reply.error.code,
      data: reply.error.data,
    });
  }
  return reply?.result as T;
}

async function postJsonRpc<T>(url: string, method: string, args: unknown[], timeoutMs: number): Promise<JsonRpcReply<T>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: args }),
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    return (await response.json()) as JsonRpcReply<T>;
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} got no answer within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
