/**
 * Compatibility shims over @lazorkit/sdk-legacy 1.x (protocol v2).
 *
 * The protocol layer used to be vendored in this package. It is now the
 * published SDK, which is the implementation the protocol repo's own
 * validator suites cover. These shims keep this package's call shape: the
 * SDK made `programId` a required argument on the PDA helpers, while
 * everything here has always defaulted it.
 *
 * The client does NOT default to a fixed id. The SDK infers the v2 program
 * from the RPC URL (devnet vs mainnet), and a fixed default here would put a
 * devnet app's wallets at the mainnet address. The PDA helpers default to the
 * mainnet v2 id; pass `programId` (e.g. `client.programId`) anywhere else.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import {
  LazorKitClient as SdkLazorKitClient,
  type LazorKitClientOptions,
  findWalletPda as sdkFindWalletPda,
  findVaultPda as sdkFindVaultPda,
  findAuthorityPda as sdkFindAuthorityPda,
  findSessionPda as sdkFindSessionPda,
  findProtocolConfigPda as sdkFindProtocolConfigPda,
  findFeeRecordPda as sdkFindFeeRecordPda,
  findTreasuryShardPda as sdkFindTreasuryShardPda,
  findDeferredExecPda as sdkFindDeferredExecPda,
  buildSecp256r1Challenge as sdkBuildSecp256r1Challenge,
  readAuthorityCounter,
  readAuthorityPubkey,
} from '@lazorkit/sdk-legacy';

import { PROGRAM_ID } from '../constants';

/** The SDK client. Without `programId` it picks the v2 id for the RPC's cluster. */
export class LazorKitClient extends SdkLazorKitClient {
  constructor(
    connection: Connection,
    programId?: PublicKey,
    options: LazorKitClientOptions = {},
  ) {
    super(connection, programId, options);
  }
}

export const findWalletPda = (
  userSeed: Uint8Array,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindWalletPda(userSeed, programId);

export const findVaultPda = (
  walletPda: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindVaultPda(walletPda, programId);

export const findAuthorityPda = (
  walletPda: PublicKey,
  credentialIdHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindAuthorityPda(walletPda, credentialIdHash, programId);

export const findSessionPda = (
  walletPda: PublicKey,
  sessionKey: Uint8Array,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindSessionPda(walletPda, sessionKey, programId);

export const findProtocolConfigPda = (
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindProtocolConfigPda(programId);

export const findFeeRecordPda = (
  payerPubkey: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindFeeRecordPda(payerPubkey, programId);

export const findTreasuryShardPda = (
  shardId: number,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindTreasuryShardPda(shardId, programId);

export const findDeferredExecPda = (
  walletPda: PublicKey,
  authorityPda: PublicKey,
  counter: number,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] => sdkFindDeferredExecPda(walletPda, authorityPda, counter, programId);

/**
 * `wallet` is the wallet the signing authority belongs to: the program binds
 * it into the passkey challenge, so a challenge without it never verifies.
 */
export const buildSecp256r1Challenge = (params: {
  discriminator: Uint8Array;
  authPayload: Uint8Array;
  signedPayload: Uint8Array;
  slot: bigint;
  payer: PublicKey;
  wallet: PublicKey;
  counter: number;
  programId?: PublicKey;
}): Uint8Array =>
  sdkBuildSecp256r1Challenge({ ...params, programId: params.programId ?? PROGRAM_ID });

/**
 * Dropped from the SDK; both halves are still exported, so this stays a
 * two-call convenience rather than a reimplementation.
 */
export async function readAuthorityState(
  connection: Connection,
  authorityPda: PublicKey,
): Promise<{ counter: number; publicKeyBytes: Uint8Array }> {
  const [counter, publicKeyBytes] = await Promise.all([
    readAuthorityCounter(connection, authorityPda),
    readAuthorityPubkey(connection, authorityPda),
  ]);
  return { counter, publicKeyBytes };
}
