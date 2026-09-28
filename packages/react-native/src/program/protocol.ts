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
  legacyProgramIdFor,
  readAuthorityPubkey,
  deserializeDeferredPayload,
  serializeDeferredPayload,
  type DeferredPayload,
} from './utils';

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

/** True for the error a retired v1 program returns. */
export function isRetiredDeploymentError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { logs?: unknown }).logs ?? '')}` : String(error);
  return /custom program error: 0xfb2\b/i.test(text) || /"Custom":\s*4018\b/.test(text);
}

/**
 * A stored wallet's protocol. Wallets saved before this field existed were all
 * made by the v1 build of this package, so a missing field means v1.
 */
export function versionOf(wallet: { protocolVersion?: ProtocolVersion }): ProtocolVersion {
  return wallet.protocolVersion ?? 1;
}

/** The v2 client for this connection's cluster. */
export function v2Client(connection: Connection): LazorKitClient {
  return new LazorKitClient(connection);
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
