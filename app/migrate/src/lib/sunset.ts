import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

/** What the retired v1 program answers everything but the ways out with. */
const RETIRED_DEPLOYMENT = 4018;

/**
 * Whether the v1 program has been retired to its sunset binary — the only
 * build that has `MigrateWallet`. Until then the page must not ask for a
 * passkey signature it cannot use.
 *
 * The probe simulates instruction 0 (CreateWallet) with no accounts. The
 * sunset binary refuses it with 4018 before reading a single account; full v1
 * fails some other way. Nothing is signed or sent.
 */
export async function isMigrationOpen(
  connection: Connection,
  v1ProgramId: PublicKey,
  feePayer: PublicKey,
): Promise<boolean> {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [new TransactionInstruction({ programId: v1ProgramId, keys: [], data: Buffer.from([0]) })],
  }).compileToV0Message();
  const { value } = await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  const err = value.err as { InstructionError?: [number, { Custom?: number } | string] } | null;
  const custom = err?.InstructionError?.[1];
  return typeof custom === 'object' && custom?.Custom === RETIRED_DEPLOYMENT;
}
