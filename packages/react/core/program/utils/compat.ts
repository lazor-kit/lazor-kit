/**
 * Compatibility shims over @lazorkit/sdk-legacy 1.x (protocol v2).
 *
 * The protocol layer used to be vendored in this package. It is now the
 * published SDK, which is the implementation the protocol repo's own
 * validator suites cover. These shims exist only to keep this package's
 * call shape unchanged: the SDK made `programId` a required argument
 * everywhere and made its client infer the program from the RPC URL, while
 * everything here has always defaulted to PROGRAM_ID.
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

/** The SDK client, with this package's historical default program id. */
export class LazorKitClient extends SdkLazorKitClient {
  constructor(
    connection: Connection,
    programId: PublicKey = PROGRAM_ID,
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

export const buildSecp256r1Challenge = (params: {
  discriminator: Uint8Array;
  authPayload: Uint8Array;
  signedPayload: Uint8Array;
  slot: bigint;
  payer: PublicKey;
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
