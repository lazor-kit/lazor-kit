import * as anchor from '@coral-xyz/anchor';
import {
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

/**
 * Builds a versioned transaction (v0) from instructions
 */
export async function buildVersionedTransaction(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
  instructions: anchor.web3.TransactionInstruction[]
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

/**
 * Builds a legacy transaction from instructions
 */
export async function buildLegacyTransaction(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
  instructions: anchor.web3.TransactionInstruction[]
): Promise<Transaction> {
  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = payer;
  transaction.recentBlockhash = blockhash;
  return transaction;
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
