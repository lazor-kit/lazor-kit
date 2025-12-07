import * as anchor from '@coral-xyz/anchor';
import { TransactionBuilderOptions, TransactionBuilderResult } from './types';

/**
 * Creates a compute unit limit instruction
 */
export function createComputeUnitLimitInstruction(
  limit: number
): anchor.web3.TransactionInstruction {
  return anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: limit });
}

/**
 * Prepends compute unit limit instruction to the beginning of instruction array if limit is provided
 */
export function prependComputeUnitLimit(
  instructions: anchor.web3.TransactionInstruction[],
  computeUnitLimit?: number
): anchor.web3.TransactionInstruction[] {
  if (computeUnitLimit === undefined) {
    return instructions;
  }

  return [createComputeUnitLimitInstruction(computeUnitLimit), ...instructions];
}

/**
 * Builds a versioned transaction (v0) from instructions
 */
export async function buildVersionedTransaction(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
  instructions: anchor.web3.TransactionInstruction[]
): Promise<anchor.web3.VersionedTransaction> {
  const result = await buildTransaction(connection, payer, instructions, {
    useVersionedTransaction: true,
  });
  return result.transaction as anchor.web3.VersionedTransaction;
}

/**
 * Builds a legacy transaction from instructions
 */
export async function buildLegacyTransaction(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
  instructions: anchor.web3.TransactionInstruction[]
): Promise<anchor.web3.Transaction> {
  const result = await buildTransaction(connection, payer, instructions, {
    useVersionedTransaction: false,
  });
  return result.transaction as anchor.web3.Transaction;
}

/**
 * Combines authentication verification instruction with smart wallet instructions
 */
export function combineInstructionsWithAuth(
  authInstruction: anchor.web3.TransactionInstruction,
  smartWalletInstructions: anchor.web3.TransactionInstruction[]
): anchor.web3.TransactionInstruction[] {
  return [authInstruction, ...smartWalletInstructions];
}

/**
 * Combines authentication verification instruction with smart wallet instructions and optional compute unit limit
 */
export function combineInstructionsWithAuthAndCU(
  authInstruction: anchor.web3.TransactionInstruction,
  smartWalletInstructions: anchor.web3.TransactionInstruction[],
  computeUnitLimit?: number
): anchor.web3.TransactionInstruction[] {
  const combinedInstructions = [authInstruction, ...smartWalletInstructions];
  return prependComputeUnitLimit(combinedInstructions, computeUnitLimit);
}

/**
 * Calculates the correct verifyInstructionIndex based on whether compute unit limit is used
 */
export function calculateVerifyInstructionIndex(
  computeUnitLimit?: number
): number {
  return computeUnitLimit !== undefined ? 1 : 0;
}

/**
 * Flexible transaction builder that supports both legacy and versioned transactions
 * with optional address lookup table support
 */
export async function buildTransaction(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
  instructions: anchor.web3.TransactionInstruction[],
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilderResult> {
  const {
    useVersionedTransaction,
    addressLookupTable,
    recentBlockhash: customBlockhash,
    computeUnitLimit,
  } = options;

  // Prepend compute unit limit instruction if specified
  const finalInstructions = prependComputeUnitLimit(
    instructions,
    computeUnitLimit
  );

  // Auto-detect: if addressLookupTable is provided, use versioned transaction
  const shouldUseVersioned = useVersionedTransaction ?? !!addressLookupTable;

  // Get recent blockhash
  const recentBlockhash =
    customBlockhash || (await connection.getLatestBlockhash()).blockhash;

  if (shouldUseVersioned) {
    // Build versioned transaction
    const lookupTables = addressLookupTable ? [addressLookupTable] : [];

    const message = new anchor.web3.TransactionMessage({
      payerKey: payer,
      recentBlockhash,
      instructions: finalInstructions,
    }).compileToV0Message(lookupTables);

    const transaction = new anchor.web3.VersionedTransaction(message);

    return {
      transaction,
      isVersioned: true,
      recentBlockhash,
    };
  } else {
    // Build legacy transaction
    const transaction = new anchor.web3.Transaction().add(...finalInstructions);
    transaction.feePayer = payer;
    transaction.recentBlockhash = recentBlockhash;

    return {
      transaction,
      isVersioned: false,
      recentBlockhash,
    };
  }
}
