/**
 * Which protocol a wallet lives on, and the client that speaks it.
 *
 * LazorKit v2 runs at its own program id; v1 keeps its old one until it is
 * retired to a binary that only lets wallets migrate out. Until then an app on
 * this package has users on both: everyone who signed up before v2 has a v1
 * wallet, and everyone after gets a v2 one. So every action picks its client
 * from the wallet it acts on, never from a single global program id — sending
 * a v2 instruction to the v1 program (or the reverse) fails at best.
 *
 * The v1 client is `@lazorkit/sdk-legacy` 0.3.2, installed under the alias
 * `lazorkit-sdk-v1`: the exact SDK v1 wallets were made with. Its client and
 * the 1.x client take the same arguments method for method (1.x only adds
 * optional fields, which 0.3.2 ignores), which is what lets the actions treat
 * both through the 1.x type.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import {
  LazorKitClient as V1LazorKitClient,
  readAuthorityPubkey as v1ReadAuthorityPubkey,
  deserializeDeferredPayload as v1DeserializeDeferredPayload,
  serializeDeferredPayload as v1SerializeDeferredPayload,
} from 'lazorkit-sdk-v1';
import {
  LazorKitClient,
  PROGRAM_ID_DEVNET,
  PROGRAM_ID_MAINNET,
  legacyProgramIdFor,
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

/**
 * The v2 client for this connection's cluster: the configured `cluster` if
 * there is one, else what the RPC URL says (mainnet / devnet / localhost),
 * else mainnet — what every release before v2 assumed.
 */
export function v2Client(connection: Connection): LazorKitClient {
  const cluster = clusters.get(connection.rpcEndpoint);
  if (cluster) {
    return new LazorKitClient(connection, cluster === 'devnet' ? PROGRAM_ID_DEVNET : PROGRAM_ID_MAINNET);
  }
  try {
    return new LazorKitClient(connection);
  } catch {
    return new LazorKitClient(connection, PROGRAM_ID_MAINNET);
  }
}

/**
 * The v1 client for this connection's cluster, at the v1 id paired with the
 * cluster's v2 id — so the two can never disagree about which cluster this is.
 */
export function v1Client(connection: Connection): LazorKitClient {
  const v1ProgramId = legacyProgramIdFor(v2Client(connection).programId);
  // Same call shape as the 1.x client (see the header); typed as it so the
  // actions need no second copy.
  return new V1LazorKitClient(connection, v1ProgramId) as unknown as LazorKitClient;
}

export function clientFor(version: ProtocolVersion, connection: Connection): LazorKitClient {
  return version === 1 ? v1Client(connection) : v2Client(connection);
}

/** Read a passkey's compressed public key off its authority account. */
export function readPasskeyPubkey(
  version: ProtocolVersion,
  connection: Connection,
  authorityPda: PublicKey,
): Promise<Uint8Array> {
  return version === 1
    ? v1ReadAuthorityPubkey(connection, authorityPda)
    : readAuthorityPubkey(connection, authorityPda);
}

/**
 * The protocol an on-chain LazorKit account belongs to, read from its owner —
 * for flows that start from an account rather than a connected wallet (a
 * stored session or authority key, a deferred payload).
 */
export async function versionOfAccount(
  connection: Connection,
  account: PublicKey,
): Promise<ProtocolVersion> {
  const info = await connection.getAccountInfo(account);
  if (!info) throw new Error(`LazorKit account ${account.toBase58()} does not exist`);
  if (info.owner.equals(v2Client(connection).programId)) return 2;
  if (info.owner.equals(v1Client(connection).programId)) return 1;
  throw new Error(
    `${account.toBase58()} is owned by ${info.owner.toBase58()}, which is not a LazorKit program on this cluster`,
  );
}

/** Serialize a deferred payload in the format its own protocol reads back. */
export function serializeDeferred(version: ProtocolVersion, payload: DeferredPayload): string {
  return version === 1
    ? v1SerializeDeferredPayload(payload as Parameters<typeof v1SerializeDeferredPayload>[0])
    : serializeDeferredPayload(payload);
}

/**
 * Parse a serialized deferred payload and say which protocol wrote it. v2
 * payloads carry `version: 2`; v1 payloads carry no version at all.
 */
export function deserializeDeferred(serialized: string): { version: ProtocolVersion; payload: DeferredPayload } {
  const parsed = JSON.parse(serialized) as { version?: number };
  if (parsed && typeof parsed === 'object' && parsed.version === undefined) {
    return {
      version: 1,
      payload: v1DeserializeDeferredPayload(serialized) as unknown as DeferredPayload,
    };
  }
  return { version: 2, payload: deserializeDeferredPayload(serialized) };
}
