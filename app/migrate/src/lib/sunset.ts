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

export type MigrationState =
  | { state: 'open' }
  | { state: 'closed' }
  | { state: 'unknown'; reason: string };

/**
 * Whether the v1 program has been retired to its sunset binary — the only
 * build that has `MigrateWallet`. Until then the page must not ask for a
 * passkey signature it cannot use.
 *
 * The probe simulates instruction 0 (CreateWallet) with no accounts. The
 * sunset binary refuses it with 4018 before reading a single account; full v1
 * fails inside the instruction some other way. Anything else — an RPC error,
 * a fee payer the cluster does not know, a program id that is not deployed —
 * says nothing about v1, and is reported as unknown rather than as "not yet".
 */
export async function migrationState(
  connection: Connection,
  v1ProgramId: PublicKey,
  feePayer: PublicKey,
): Promise<MigrationState> {
  try {
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
    const err = value.err as { InstructionError?: [number, unknown] } | string | null;
    if (err && typeof err === 'object' && Array.isArray(err.InstructionError)) {
      const inner = err.InstructionError[1] as { Custom?: number } | string;
      if (typeof inner === 'object' && inner?.Custom === RETIRED_DEPLOYMENT) return { state: 'open' };
      return { state: 'closed' };
    }
    return { state: 'unknown', reason: err ? JSON.stringify(err) : 'the probe did not fail at all' };
  } catch (e) {
    return { state: 'unknown', reason: e instanceof Error ? e.message : String(e) };
  }
}
