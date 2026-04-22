import { type AccountMeta } from '@solana/web3.js';
import { createHash } from 'crypto';

export interface CompactInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

/**
 * Packs a list of compact instructions into the binary format expected
 * by LazorKit's Execute instruction.
 *
 * Format:
 *   [num_instructions: u8]
 *   for each instruction:
 *     [program_id_index: u8]
 *     [num_accounts: u8]
 *     [account_indexes: u8[]]
 *     [data_len: u16 LE]
 *     [data: u8[]]
 */
export function packCompactInstructions(instructions: CompactInstruction[]): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([instructions.length]));

  for (const ix of instructions) {
    parts.push(new Uint8Array([ix.programIdIndex, ix.accountIndexes.length]));
    parts.push(new Uint8Array(ix.accountIndexes));
    const len = ix.data.length;
    parts.push(new Uint8Array([len & 0xff, (len >> 8) & 0xff]));
    parts.push(ix.data);
  }

  return concatBytes(parts);
}

/**
 * Computes the SHA-256 hash of all account pubkeys referenced by compact instructions.
 * Must match the on-chain `compute_accounts_hash`.
 */
export function computeAccountsHash(
  accountMetas: AccountMeta[],
  instructions: CompactInstruction[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const ix of instructions) {
    parts.push(accountMetas[ix.programIdIndex].pubkey.toBytes());
    for (const idx of ix.accountIndexes) {
      parts.push(accountMetas[idx].pubkey.toBytes());
    }
  }
  const data = concatBytes(parts);
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/**
 * Computes the SHA-256 hash of packed compact instructions.
 * Used for deferred execution — the hash is signed in tx1 and verified in tx2.
 */
export function computeInstructionsHash(
  instructions: CompactInstruction[],
): Uint8Array {
  const packed = packCompactInstructions(instructions);
  return new Uint8Array(createHash('sha256').update(packed).digest());
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
