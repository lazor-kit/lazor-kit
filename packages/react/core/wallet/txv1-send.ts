/**
 * Sending a `txVersion: 'v1'` request as a SIMD-0385 v1 transaction.
 * Experimental, and devnet only by construction.
 *
 * Nothing here runs unless a caller asked for 'v1': every other request takes
 * the legacy / v0 code in ./actions unchanged.
 *
 * - The gate (`gateTxV1`) is local, with no network call. v1 is used only when
 *   the paymaster declared `acceptsTxV1`, has not refused v1 in this page
 *   session (-32051), and every LazorKit instruction targets the devnet v2
 *   program. Otherwise the request goes out as v0, through the untouched code.
 * - v0 is an availability fallback, never a size rescue: a v1 transaction over
 *   4096 bytes or 64 addresses cannot fit v0's 1232 bytes and 64 account locks
 *   either. When the chosen format does not fit, the request fails with
 *   `TransactionTooLargeError`, before the passkey prompt when the estimate
 *   already shows it (`planTxV1`), else after signing and before sending.
 * - The compute-unit and loaded-accounts-data limits are always set. They come
 *   from one simulation, bounded to 3 s; any problem with it gives the
 *   ceilings, which in v1 cost the sponsor nothing more, and never blocks the
 *   send.
 * - A signed operation is never sent again in another format: a retry resends
 *   the same bytes, and the paymaster's -32051 only moves later requests to v0.
 */
import { Buffer } from 'buffer';
import {
    PublicKey,
    TransactionInstruction,
    type AddressLookupTableAccount,
    type Connection,
    type Keypair,
} from '@solana/web3.js';
import { Paymaster, txV1Availability } from '../paymaster/paymaster';
import {
    PROGRAM_ID_DEVNET,
    PROGRAM_ID_DEVNET_V1,
    PROGRAM_ID_MAINNET,
    PROGRAM_ID_MAINNET_V1,
} from '../program/utils';
import { Logger } from '../../utils/logger';
import { type AuthorityTurn, sendAndConfirm } from './sequence';
import {
    TX_V1_CEILING_CONFIG,
    TransactionTooLargeError,
    type LazorKitExecutePath,
    assertTxV1LimitOptions,
    assertV1Instructions,
    checkProgramCeilings,
    compileTransactionV1,
    limitsFromSimulation,
    measureV0,
    placeholderWebAuthn,
    signTransactionV1,
    type TxV1Config,
    type TxV1LimitOptions,
    type TxV1LimitsSource,
    type TxV1SimulationValue,
    type TxV1UnavailableReason,
    type WebAuthnPlaceholder,
} from './txv1';

/** How long the limit simulation may take: post-sign work must fit in the passkey's 150-slot window. */
const SIMULATION_TIMEOUT_MS = 3_000;
/** A raw read that is not on the clock of the 150-slot window (logs of a landed or rejected transaction). */
const READ_TIMEOUT_MS = 10_000;
/** Any 32 bytes (these are zeros): a transaction's size does not depend on its blockhash. */
const SIZING_BLOCKHASH = '11111111111111111111111111111111';

let logger: Logger | undefined;
const log = (): Logger => (logger ??= new Logger('TxV1'));

/** Each fallback reason is logged once per page. */
const warned = new Set<TxV1UnavailableReason>();

// ─── The gate ───────────────────────────────────────────────────────────────

/** The format a 'v1' request goes out in, decided once per operation (both transactions of a deferred pair). */
export type TxV1Decision =
    | { readonly v1: true; readonly lazorkitProgramId: PublicKey }
    | { readonly v1: false; readonly reason: TxV1UnavailableReason };

const LAZORKIT_ELSEWHERE = [PROGRAM_ID_MAINNET, PROGRAM_ID_MAINNET_V1, PROGRAM_ID_DEVNET_V1];

/**
 * Whether a 'v1' request may go out as v1. Local: no network call. The first
 * condition that fails is the reason:
 *
 * 1. `paymaster`: the paymaster did not declare `acceptsTxV1`;
 * 2. `refused`: it refused a v1 transaction (-32051) earlier in this page;
 * 3. `not-devnet-v2`: no instruction targets the devnet v2 program, or one
 *    targets the mainnet program or a protocol-v1 program. This alone keeps
 *    mainnet and protocol-v1 wallets off v1. A local validator uses the devnet
 *    id, so it passes.
 *
 * (`fee-token` is the mobile adapter's: the web wallet never forwards a fee token.)
 */
export function gateTxV1(params: {
    paymaster: Paymaster;
    instructions: readonly TransactionInstruction[];
}): TxV1Decision {
    const availability = txV1Availability(params.paymaster);
    if (availability !== 'available') return { v1: false, reason: availability };
    if (!targetsDevnetV2(params.instructions)) return { v1: false, reason: 'not-devnet-v2' };
    return { v1: true, lazorkitProgramId: PROGRAM_ID_DEVNET };
}

/** Some instruction targets the devnet v2 program, and none another LazorKit program (the gate's program rule). */
function targetsDevnetV2(instructions: readonly TransactionInstruction[]): boolean {
    const programs = instructions.map((ix) => ix.programId);
    const devnetV2 = programs.some((id) => id.equals(PROGRAM_ID_DEVNET));
    const elsewhere = programs.some((id) => LAZORKIT_ELSEWHERE.some((other) => id.equals(other)));
    return devnetV2 && !elsewhere;
}

// ─── Measuring ──────────────────────────────────────────────────────────────

/** One transaction of a request, as it will be sent, or before the prompt, as built from a stand-in WebAuthn response. */
export interface TxV1Draft {
    readonly transaction: 'single' | 'tx1' | 'tx2';
    /** The instructions; before the prompt, with the longest response the portal can return (`placeholderForPrompt`). */
    readonly instructions: readonly TransactionInstruction[];
    /**
     * Before the prompt, a passkey transaction's instructions with the
     * shortest response the portal can return (`shortestForPrompt`): what a
     * v0 fallback is measured with there. v0 must behave as a 'v0' request
     * does, so it is refused before the prompt only when it cannot fit
     * whatever the response; the measurement after signing decides the rest.
     */
    readonly shortest?: readonly TransactionInstruction[];
    /** The lookup tables its v0 form would be sent with. */
    readonly addressLookupTables?: readonly AddressLookupTableAccount[];
}

/** Throws `TransactionTooLargeError` when `draft` does not fit the format `decision` chose. */
function assertFits(
    decision: TxV1Decision,
    feePayer: PublicKey,
    draft: TxV1Draft,
    stage: 'before-signing' | 'after-signing',
): void {
    if (decision.v1) {
        const compiled = compileTransactionV1({
            payer: feePayer,
            blockhash: SIZING_BLOCKHASH,
            instructions: draft.instructions,
            config: TX_V1_CEILING_CONFIG,
        });
        if (!compiled.fits) {
            throw new TransactionTooLargeError({
                stage,
                format: 'v1',
                transaction: draft.transaction,
                bytes: compiled.bytes,
                addresses: compiled.addresses,
                instructions: compiled.instructions,
                overflow: compiled.overflow,
            });
        }
        return;
    }
    const measured = measureV0({
        payer: feePayer,
        blockhash: SIZING_BLOCKHASH,
        instructions: draft.shortest ?? draft.instructions,
        addressLookupTables: draft.addressLookupTables,
    });
    if (!measured.fits) {
        throw new TransactionTooLargeError({
            stage,
            format: 'v0',
            transaction: draft.transaction,
            bytes: measured.bytes,
            addresses: measured.accounts,
            instructions: measured.instructions,
            v1Unavailable: decision.reason,
        });
    }
}

// ─── The plan, before anything is signed ────────────────────────────────────

/** The options of a send that a 'v1' request reads. */
export interface TxV1RequestOptions {
    readonly computeUnitLimit?: number;
    readonly loadedAccountsDataSizeLimit?: number;
}

/** What a 'v1' request was decided to be, before anything was signed. */
export interface TxV1Plan {
    readonly decision: TxV1Decision;
    /** The caller's limits, range-checked; empty when the request goes out as v0, which does not use them. */
    readonly limits: TxV1LimitOptions;
}

/**
 * The inner instructions of a deferred payload, shaped for `checkProgramCeilings`
 * on the 'deferred' path, which counts only their accounts.
 */
export function innerInstructionsOf(
    compactInstructions: readonly { readonly accountIndexes: readonly number[] }[],
): TransactionInstruction[] {
    return compactInstructions.map(
        (compact) =>
            new TransactionInstruction({
                programId: PublicKey.default,
                keys: compact.accountIndexes.map(() => ({ pubkey: PublicKey.default, isSigner: false, isWritable: false })),
                data: Buffer.alloc(0),
            }),
    );
}

/**
 * Plan a 'v1' request before anything is signed: before the passkey prompt
 * (whose WebAuthn bytes `placeholderForPrompt` stands in for), or before the
 * local key signs (session, Ed25519 authority, ExecuteDeferred). Local, no
 * network call. The gate decides first. Throws, so that nothing is prompted,
 * signed or sent:
 *
 * - `RangeError` for a `computeUnitLimit` or `loadedAccountsDataSizeLimit` out
 *   of range, when the request goes out as v1 (they are its config; v0
 *   ignores them, as for a 'v0' request);
 * - `PayloadExceedsProgramLimitsError` for an inner payload the devnet v2
 *   program cannot run (more than 16 instructions, or more heap than it has,
 *   by what `execute` allocates), whether or not v1 is available. A request
 *   for another LazorKit program (mainnet, protocol v1) is not held to them:
 *   that program decides, as for a 'v0' request;
 * - `TransactionTooLargeError` (stage 'before-signing') for a transaction
 *   that does not fit the chosen format: v1 when the gate passes, measured
 *   with the longest WebAuthn response, so the user is never asked to approve
 *   one that cannot be sent; else v0 with its lookup tables, measured with
 *   the shortest response, so a transaction a 'v0' request would send is
 *   never refused. A deferred pair is decided once; as v1 its TX2 must fit
 *   too, so TX1 is never authorized for a v1 TX2 that cannot be sent (as v0,
 *   TX2 is not built before the prompt, as for a 'v0' request).
 */
export function planTxV1(params: {
    paymaster: Paymaster;
    feePayer: PublicKey;
    /** The payload's inner instructions (what the LazorKit instruction executes). */
    inner: readonly TransactionInstruction[];
    /** The LazorKit instruction that runs `inner`, which decides what it allocates. */
    execute: LazorKitExecutePath;
    /** Every transaction of the request, in send order. */
    drafts: readonly TxV1Draft[];
    options?: TxV1RequestOptions;
}): TxV1Plan {
    const instructions = params.drafts.flatMap((draft) => draft.instructions);
    const decision = gateTxV1({ paymaster: params.paymaster, instructions });
    const limits: TxV1LimitOptions = decision.v1
        ? {
              computeUnitLimit: params.options?.computeUnitLimit,
              loadedAccountsDataSizeLimit: params.options?.loadedAccountsDataSizeLimit,
          }
        : {};
    assertTxV1LimitOptions(limits);
    if (targetsDevnetV2(instructions)) checkProgramCeilings(params.inner, params.execute);
    for (const draft of params.drafts) assertFits(decision, params.feePayer, draft, 'before-signing');
    return { decision, limits };
}

/**
 * A WebAuthn response at least as long as the portal's will be, to build a
 * passkey transaction's draft before the prompt: the portal's origin, and
 * this page's as the top origin (64 characters when it is not known).
 */
export function placeholderForPrompt(portalUrl: string): WebAuthnPlaceholder {
    let topOrigin: string | undefined;
    try {
        const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
        topOrigin = origin && origin !== 'null' ? origin : undefined;
    } catch {
        topOrigin = undefined;
    }
    return placeholderWebAuthn({ portalOrigin: new URL(portalUrl).origin, topOrigin });
}

/**
 * The shortest WebAuthn response the portal can return: a 64-byte signature,
 * 37 bytes of authenticator data, and a clientDataJSON with only the members
 * WebAuthn requires, `{"type":"webauthn.get","challenge":"<43>","origin":"<portal>"}`.
 */
export function shortestForPrompt(portalUrl: string): WebAuthnPlaceholder {
    const clientDataJson =
        '{"type":"webauthn.get","challenge":"' +
        'A'.repeat(43) +
        '","origin":' +
        JSON.stringify(new URL(portalUrl).origin) +
        '}';
    return {
        signature: new Uint8Array(64),
        authenticatorData: new Uint8Array(37),
        clientDataJsonHash: new Uint8Array(32),
        clientDataJson: new Uint8Array(Buffer.from(clientDataJson, 'utf8')),
    };
}

// ─── Sending ────────────────────────────────────────────────────────────────

/**
 * Send one transaction of a planned 'v1' request.
 *
 * `stage`: the measurement on the real instructions, which is authoritative.
 * 'after-signing' for a passkey transaction (the passkey approved it; nothing
 * is sent if it does not fit), 'before-signing' for one a local key signs,
 * and null for TX2 of a pair: as v1 it was measured exactly before the prompt
 * (it carries no WebAuthn bytes); as v0 it is the 'v0' request's TX2.
 *
 * The gate failed: `sendV0()`, the unchanged v0 path with the caller's lookup
 * tables. It passed: `sendTxV1`.
 */
export async function sendPlannedTxV1(params: {
    plan: TxV1Plan;
    draft: TxV1Draft;
    stage: 'before-signing' | 'after-signing' | null;
    paymaster: Paymaster;
    connection: Connection;
    feePayer: PublicKey;
    extraSigners: readonly Keypair[];
    turn?: AuthorityTurn;
    createsAuthority?: PublicKey;
    sendV0: () => Promise<string>;
}): Promise<string> {
    const { plan, draft } = params;
    if (params.stage) assertFits(plan.decision, params.feePayer, draft, params.stage);
    if (!plan.decision.v1) {
        const { reason } = plan.decision;
        if (!warned.has(reason)) {
            warned.add(reason);
            log().warn(`txVersion 'v1' was asked for, and this transaction goes out as v0: ${reason}`);
        }
        return params.sendV0();
    }
    return sendTxV1({
        paymaster: params.paymaster,
        connection: params.connection,
        feePayer: params.feePayer,
        instructions: draft.instructions,
        extraSigners: params.extraSigners,
        lazorkitProgramId: plan.decision.lazorkitProgramId,
        limits: plan.limits,
        turn: params.turn,
        createsAuthority: params.createsAuthority,
    });
}

/**
 * Build, size, sign and send one v1 transaction, and resolve once it is
 * confirmed (`sendAndConfirm`, as every other send).
 *
 * 1. One `getLatestBlockhash`, as the v0 path makes.
 * 2. A draft with the ceiling limits. The config always holds exactly the
 *    compute-unit and loaded-accounts-data limits, so the draft is as long as
 *    the final transaction.
 * 3. The limits: the caller's, else one simulation of the draft (see
 *    `txV1Limits`), else the ceilings.
 * 4. The final transaction, the same size; the local keys sign it, after its
 *    config is final.
 * 5. `Paymaster.signAndSendRaw`: retries resend these same bytes, and a
 *    -32051 is not retried.
 */
async function sendTxV1(params: {
    paymaster: Paymaster;
    connection: Connection;
    feePayer: PublicKey;
    instructions: readonly TransactionInstruction[];
    extraSigners: readonly Keypair[];
    lazorkitProgramId: PublicKey;
    limits: TxV1LimitOptions;
    turn?: AuthorityTurn;
    createsAuthority?: PublicKey;
}): Promise<string> {
    const { paymaster, connection, feePayer, instructions } = params;
    // A programming error, never a reason to use another format.
    assertV1Instructions(instructions, params.lazorkitProgramId);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const draft = compileTransactionV1({ payer: feePayer, blockhash, instructions, config: TX_V1_CEILING_CONFIG });
    if (!draft.fits || !draft.wire) {
        throw new Error(`txv1: internal error: a transaction measured to fit v1 does not (${draft.overflow})`);
    }
    const { config, source } = await txV1Limits({ connection, draft: draft.wire, limits: params.limits, turn: params.turn });
    const final = compileTransactionV1({ payer: feePayer, blockhash, instructions, config });
    if (!final.fits || final.bytes !== draft.bytes) {
        throw new Error('txv1: internal error: the transaction is not the size of its draft');
    }
    const signed = signTransactionV1(final, params.extraSigners);
    log().debug(
        `v1: ${final.bytes} bytes, ${final.addresses} addresses, ` +
            `cu=${config.computeUnitLimit} lad=${config.loadedAccountsDataSizeLimit} (${source})`,
    );

    return sendAndConfirm({
        connection,
        attempt: {
            blockhash,
            lastValidBlockHeight,
            landedLogs: (signature) => landedLogsV1(connection, signature),
        },
        send: () => paymaster.signAndSendRaw(signed, feePayer),
        turn: params.turn,
        createsAuthority: params.createsAuthority,
        simulateLogs: async () =>
            (await simulateV1(connection, signed, {}, READ_TIMEOUT_MS))?.logs ?? undefined,
    });
}

/**
 * The limits for a v1 transaction.
 *
 * Both given by the caller: those, with no simulation. Otherwise one
 * simulation of the draft, bounded to 3 s and read from a node at or past the
 * passkey's last landed slot (`minContextSlot`, so a lagging node cannot
 * report a stale counter as a failure): CU × 1.2 + 5,000 and loaded data ×
 * 1.1 in 32 KiB pages, with floors (see txv1.ts), and a caller's value wins
 * for its own field. Anything else (an RPC error, a 429, the timeout, a
 * simulation error, a missing field) gives the ceilings: in v1 the fee does
 * not depend on the limits, and the paymaster's own simulation is the
 * authority on a failing transaction.
 */
async function txV1Limits(params: {
    connection: Connection;
    draft: Uint8Array;
    limits: TxV1LimitOptions;
    turn?: AuthorityTurn;
}): Promise<{ config: TxV1Config; source: TxV1LimitsSource }> {
    const { connection, draft, limits, turn } = params;
    if (limits.computeUnitLimit !== undefined && limits.loadedAccountsDataSizeLimit !== undefined) {
        return limitsFromSimulation(undefined, limits);
    }
    const started = Date.now();
    let simulation: TxV1SimulationValue | undefined;
    let problem: unknown;
    try {
        simulation = await withTimeout(
            (async () => {
                // The lane is settled by now: this reads the floor, no network.
                const minContextSlot = turn ? (await turn.challengeReads(connection)).minContextSlot : undefined;
                return simulateV1(
                    connection,
                    draft,
                    minContextSlot !== undefined ? { minContextSlot } : {},
                    SIMULATION_TIMEOUT_MS,
                );
            })(),
            SIMULATION_TIMEOUT_MS,
            'the limit simulation',
        );
    } catch (error) {
        problem = error;
        simulation = undefined;
    }
    const result = limitsFromSimulation(simulation, limits);
    if (result.source === 'ceiling') {
        log().warn(
            `v1: the limit simulation gave nothing usable after ${Date.now() - started} ms; using the ceilings`,
            problem ?? simulation?.err,
        );
    }
    return result;
}

// ─── Raw RPC ────────────────────────────────────────────────────────────────
//
// web3.js cannot do these for v1: its `simulateTransaction` serializes the
// transaction (which throws for v1), and before 1.99 its `getTransaction`
// cannot parse a v1 response. So they go to the RPC as JSON, through the
// Connection's own request function (its fetch, headers and middleware).

interface RpcResponse<T> {
    result?: T;
    error?: { code?: number; message?: string; data?: unknown };
}

/** One JSON-RPC request through `connection`, bounded to `timeoutMs`. Throws the RPC's error. */
async function rpcRaw<T>(connection: Connection, method: string, params: unknown[], timeoutMs: number): Promise<T> {
    const request = (connection as unknown as { _rpcRequest?: (method: string, params: unknown[]) => Promise<RpcResponse<T>> })
        ._rpcRequest;
    const call: Promise<RpcResponse<T>> =
        typeof request === 'function'
            ? request.call(connection, method, params)
            : fetch(connection.rpcEndpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
              }).then((response) => response.json() as Promise<RpcResponse<T>>);
    const response = await withTimeout(call, timeoutMs, method);
    if (response?.error) {
        throw Object.assign(new Error(`${method}: ${response.error.message ?? 'RPC error'}`), {
            code: response.error.code,
            data: response.error.data,
        });
    }
    return response?.result as T;
}

interface SimulateResult extends TxV1SimulationValue {
    readonly logs?: readonly string[] | null;
}

/** `simulateTransaction` of v1 bytes, without signature checks (the Secp256r1 precompile still checks the passkey's). */
async function simulateV1(
    connection: Connection,
    wire: Uint8Array,
    extra: { minContextSlot?: number },
    timeoutMs: number,
): Promise<SimulateResult | undefined> {
    const result = await rpcRaw<{ value?: SimulateResult } | null>(
        connection,
        'simulateTransaction',
        [
            Buffer.from(wire).toString('base64'),
            {
                encoding: 'base64',
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: 'confirmed',
                ...extra,
            },
        ],
        timeoutMs,
    );
    return result?.value ?? undefined;
}

/** A landed v1 transaction's logs, from a raw `getTransaction` (version 1 allowed). */
async function landedLogsV1(connection: Connection, signature: string): Promise<readonly string[] | null | undefined> {
    const result = await rpcRaw<{ meta?: { logMessages?: string[] | null } | null } | null>(
        connection,
        'getTransaction',
        [signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }],
        READ_TIMEOUT_MS,
    );
    return result?.meta?.logMessages;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
