/** Routing for the standalone LazorKit Protocol deployment. */
import { Connection, PublicKey } from '@solana/web3.js';
import {
  LazorKitClient,
  PROGRAM_ID_DEVNET,
  PROGRAM_ID_MAINNET,
  readAuthorityPubkey,
  deserializeDeferredPayload,
  serializeDeferredPayload,
  type DeferredPayload,
} from './utils';
import { chainHasError, errorChainText } from './errorShape';

/** 1 = a wallet made before LazorKit v2; 2 = everything since. */
export type ProtocolVersion = 1 | 2;

/**
 * Error code the retired v1 program answers everything but a migration with
 * (`RetiredDeployment`). Seen as `custom program error: 0xfb2`.
 */
export const RETIRED_DEPLOYMENT_CODE = 4018;

/** The v1 wallet can no longer transact: LazorKit v1 has been retired. */
export class V1WalletRetiredError extends Error {
  readonly code = RETIRED_DEPLOYMENT_CODE;
  constructor(cause?: unknown) {
    super(
      'This wallet is on LazorKit v1, which has been retired. Its funds are safe, ' +
        'but it can only be moved to a v2 wallet now: migrate it ' +
        '(LazorKitClient.migrateV1Wallet, or the LazorKit migration page).',
    );
    this.name = 'V1WalletRetiredError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const V1_PROGRAM_IDS = [
  'LazorjRFNavitUaBu5m3WaNPjU1maipvSW2rZfAFAKi',
  '4h3XoNReAgEcHVxcZ8sw2aufi9MTr7BbvYYjzjWDyDxS',
];

/**
 * True for a `V1WalletRetiredError` (also one from another copy of this
 * package, by `name` and `code`), and for the error a retired v1 program
 * returns (`RetiredDeployment`, 4018): web3.js text (`0xfb2`), a
 * TransactionError (`"Custom":4018`) or Kora's text (`Custom(4018)`), with the
 * logs in `logs` or in a paymaster's `data`. 4018 is only that when it came
 * from a v1 program: when the logs name one, or when the transaction was a v1
 * wallet's (`version === 1`). Any other program is free to use the code.
 *
 * The error is read through what wraps it: `cause`, and `error` (a
 * wallet-adapter `WalletError`, as a dApp on the Wallet Standard gets it).
 */
export function isRetiredDeploymentError(error: unknown, version?: ProtocolVersion): boolean {
  if (chainHasError(error, V1WalletRetiredError, 'V1WalletRetiredError', RETIRED_DEPLOYMENT_CODE)) return true;
  const text = errorChainText(error);
  if (
    !/custom program error: 0xfb2\b/i.test(text) &&
    !/"Custom":\s*4018\b/.test(text) &&
    !/Custom\(\s*4018\s*\)/.test(text)
  ) {
    return false;
  }
  if (V1_PROGRAM_IDS.some((id) => new RegExp(`Program ${id} failed: custom program error: 0xfb2`).test(text))) {
    return true;
  }
  return version === 1;
}

/**
 * The LazorKit program's `SignatureReused`: a passkey signature commits to
 * its authority's counter + 1, and this one's counter had already been used.
 * Seen as `custom program error: 0xbbe`.
 */
export const SIGNATURE_REUSED_CODE = 3006;

/**
 * The passkey signed a counter that another transaction of the same passkey
 * had already used, so LazorKit rejected it (`SignatureReused`, 3006).
 *
 * The signature is bound to that counter and can never become valid, so the
 * adapter does not send it again, and it does not open a new prompt on its
 * own. Ask the user to sign again. The adapter waits for each transaction it
 * sent for a passkey before preparing that passkey's next signature, so this
 * is left for the same passkey signing somewhere else at the same moment, or
 * a paymaster reading older state than the adapter did.
 */
export class SignatureReusedError extends Error {
  readonly code = SIGNATURE_REUSED_CODE;
  constructor(cause?: unknown) {
    super(
      'LazorKit rejected the passkey signature with SignatureReused (3006): the counter it was ' +
        'signed for had already been used by another transaction of this passkey. That ' +
        'signature can never be valid, so it was not sent again. Ask the user to sign again.',
    );
    this.name = 'SignatureReusedError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function isLazorKitProgramId(id: string): boolean {
  return id === PROGRAM_ID_DEVNET.toBase58() || id === PROGRAM_ID_MAINNET.toBase58() || V1_PROGRAM_IDS.includes(id);
}

/**
 * Whose `SignatureReused` (3006) this error is, as far as the error itself
 * says. It reaches the wallet as web3.js text (`custom program error: 0xbbe`),
 * a TransactionError as JSON (`"Custom":3006`) or as Kora prints it
 * (`Custom(3006)`). An inner program may use 3006 too (Anchor's
 * `AccountNotMutable`), and the instruction that CPI'd it then fails with the
 * same code. Only logs tell them apart: the first program that failed.
 *
 * - `'lazorkit'`: a 3006, and the logs name LazorKit as the first program
 *   to fail with it.
 * - `'other'`: not a 3006, or the logs name another program.
 * - `'unknown'`: a 3006 with no logs that name who failed with it (a
 *   TransactionError read from chain, Kora's text): fetch the logs.
 *
 * Reads the error and everything it wraps (`cause`, `error`): message, logs,
 * a paymaster's `data`, a TransactionError.
 */
export function signatureReusedVerdict(error: unknown): 'lazorkit' | 'other' | 'unknown' {
  const text = errorChainText(error);
  if (!/custom program error: 0xbbe\b/i.test(text) && !/"Custom":\s*3006\b/.test(text) && !/Custom\(\s*3006\s*\)/.test(text)) {
    return 'other';
  }
  const firstFailure = /Program (\w{32,44}) failed: custom program error: 0xbbe\b/i.exec(text);
  if (!firstFailure) return 'unknown';
  return isLazorKitProgramId(firstFailure[1]) ? 'lazorkit' : 'other';
}

/**
 * True for a `SignatureReusedError` (also one from another copy of this
 * package, by `name` and `code`, and one wrapped in `cause` or in a
 * wallet-adapter `WalletError`'s `error`), and for LazorKit's raw
 * `SignatureReused` (3006) in any of the shapes it reaches the wallet in (see
 * `signatureReusedVerdict`). A raw 3006 whose logs name another program as
 * the first to fail is not LazorKit's; one with no logs at all counts as
 * LazorKit's here. The wallet fetches the logs of such a failure before it
 * reports `SignatureReusedError`.
 */
export function isSignatureReusedError(error: unknown): boolean {
  if (chainHasError(error, SignatureReusedError, 'SignatureReusedError', SIGNATURE_REUSED_CODE)) return true;
  return signatureReusedVerdict(error) !== 'other';
}

/**
 * The connected v1 wallet no longer exists: it has been migrated to v2 (or
 * otherwise closed). Connect again to pick up the passkey's v2 wallet.
 */
export class V1WalletMigratedError extends Error {
  constructor() {
    super(
      'This wallet has moved to LazorKit v2 and the old one is closed. Connect again to use ' +
        'the new wallet; nothing should be sent to the old address.',
    );
    this.name = 'V1WalletMigratedError';
  }
}

/**
 * A stored wallet's protocol. Wallets saved before this field existed were all
 * made by the v1 build of this package, so a missing field means v1.
 */
export function versionOf(wallet: { protocolVersion?: ProtocolVersion }): ProtocolVersion {
  return wallet.protocolVersion ?? 1;
}

export type Cluster = 'mainnet' | 'devnet';
export type ProtocolV1Deployment = 'baseline' | 'hardened';

const protocolV1Deployments = new WeakMap<Connection, ProtocolV1Deployment>();

export function bindProtocolV1Deployment(connection: Connection, deployment?: ProtocolV1Deployment): void {
  if (deployment) protocolV1Deployments.set(connection, deployment);
}

export function protocolV1DirectProgram(connection: Connection, version: ProtocolVersion): PublicKey | undefined {
  if (version === 1 && protocolV1Deployments.has(connection)) {
    return protocolProgramId(connection);
  }
  return undefined;
}

/** Clusters named in config, by RPC URL — see `registerCluster`. */
const clusters = new Map<string, Cluster>();

/**
 * Pin an RPC URL to a cluster. The provider/adapter calls this with the app's
 * `cluster` setting, for RPC URLs that do not say which cluster they serve
 * (an app's own proxy, most keyed provider URLs).
 */
export function registerCluster(rpcUrl: string | undefined, cluster: Cluster | undefined): void {
  if (rpcUrl && cluster) clusters.set(rpcUrl, cluster);
}

/** Resolve the Protocol program independently of Enterprise. */
function protocolProgramId(connection: Connection): PublicKey {
  const cluster = clusters.get(connection.rpcEndpoint);
  if (cluster) return cluster === 'devnet' ? PROGRAM_ID_DEVNET : PROGRAM_ID_MAINNET;
  return /devnet|localhost|127\.0\.0\.1/i.test(connection.rpcEndpoint) ? PROGRAM_ID_DEVNET : PROGRAM_ID_MAINNET;
}

export function v1Client(connection: Connection): LazorKitClient {
  return new LazorKitClient(connection, protocolProgramId(connection), {
    hardened: protocolV1Deployments.get(connection) === 'hardened',
  });
}

function assertProtocol(version: ProtocolVersion): void {
  if (version !== 1) throw new Error('This adapter only supports LazorKit Protocol wallets');
}

export function clientFor(version: ProtocolVersion, connection: Connection): LazorKitClient {
  assertProtocol(version);
  return v1Client(connection);
}

export function readPasskeyPubkey(
  version: ProtocolVersion,
  connection: Connection,
  authorityPda: PublicKey,
): Promise<Uint8Array> {
  assertProtocol(version);
  return readAuthorityPubkey(connection, authorityPda);
}

export async function versionOfAccount(connection: Connection, account: PublicKey): Promise<ProtocolVersion> {
  const info = await connection.getAccountInfo(account);
  if (!info?.owner.equals(protocolProgramId(connection))) {
    throw new Error(`Account ${account.toBase58()} is not owned by LazorKit Protocol on this cluster`);
  }
  return 1;
}

export function serializeDeferred(version: ProtocolVersion, payload: DeferredPayload): string {
  assertProtocol(version);
  return serializeDeferredPayload(payload);
}

export function deserializeDeferred(serialized: string): { version: ProtocolVersion; payload: DeferredPayload } {
  const parsed = JSON.parse(serialized) as { version?: number };
  if (parsed.version !== undefined) assertProtocol(parsed.version as ProtocolVersion);
  return { version: 1, payload: deserializeDeferredPayload(serialized) };
}
