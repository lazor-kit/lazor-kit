import * as anchor from '@coral-xyz/anchor';
import { sha256 } from 'js-sha256';
import { computeMultipleCpiHashes } from '../../messages';
import { instructionToAccountMetas } from '../../utils';

type TransactionInstruction = anchor.web3.TransactionInstruction;
type PublicKey = anchor.web3.PublicKey;

export function calculateSplitIndex(
  instructions: readonly TransactionInstruction[]
): number[] {
  const splitIndex: number[] = [];
  let currentIndex = 0;

  for (let i = 0; i < instructions.length - 1; i++) {
    currentIndex += instructions[i].keys.length + 1; // +1 program id
    splitIndex.push(currentIndex);
  }

  return splitIndex;
}

export function calculateCpiHash(
  cpiInstructions: readonly TransactionInstruction[],
  smartWallet: PublicKey,
  cpiSigners?: readonly PublicKey[]
): number[] {
  const cpiHashes = computeMultipleCpiHashes(
    cpiInstructions,
    smartWallet,
    cpiSigners
  );

  const cpiCombined = new Uint8Array(64);
  cpiCombined.set(cpiHashes.cpiDataHash, 0);
  cpiCombined.set(cpiHashes.cpiAccountsHash, 32);

  return Array.from(new Uint8Array(sha256.arrayBuffer(cpiCombined)));
}

export function collectCpiAccountMetas(
  cpiInstructions: readonly TransactionInstruction[],
  cpiSigners?: readonly PublicKey[]
): anchor.web3.AccountMeta[] {
  return cpiInstructions.flatMap((ix) => [
    {
      pubkey: ix.programId,
      isSigner: false,
      isWritable: false,
    },
    ...instructionToAccountMetas(ix, cpiSigners),
  ]);
}

