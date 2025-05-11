// Import necessary Solana and Anchor dependencies
import { Connection, Transaction, Keypair } from '@solana/web3.js'; // Solana blockchain utilities
import * as anchor from '@coral-xyz/anchor'; // Anchor framework for Solana programs
import { Contract } from './idl/contract'; // Type definition for the smart wallet contract
import IDL from './idl/contract.json'; // IDL (Interface Definition Language) for the smart wallet program

// Define the parameters required to create a smart wallet transaction
export type CreateInitSmartWalletTransactionParam = {
  secp256k1PubkeyBytes: number[]; // Public key in secp256k1 format
  connection: Connection; // Solana connection object
};

/**
 * Creates a transaction to initialize a smart wallet on the Solana blockchain.
 * @param {CreateInitSmartWalletTransactionParam} param - Parameters for the transaction.
 * @returns {Promise<string>} - The transaction ID of the submitted transaction.
 */
export async function createSmartWalletTransaction(
  param: CreateInitSmartWalletTransactionParam
): Promise<string> {
  const { secp256k1PubkeyBytes, connection } = param;

  // Generate a keypair for signing the transaction
  const keypair = Keypair.fromSecretKey(
    new Uint8Array([
      91, 139, 202, 42, 20, 31, 61, 11, 170, 237, 184, 147, 253, 10, 63, 240, 131, 46, 231, 211, 253, 181, 58, 104, 242,
      192, 0, 143, 19, 252, 47, 158, 219, 165, 97, 103, 220, 26, 173, 243, 207, 52, 18, 44, 64, 84, 249, 104, 158, 221,
      84, 61, 36, 240, 55, 20, 76, 59, 142, 34, 100, 132, 243, 236,
    ])
  );

  // Validate the length of the public key
  if (secp256k1PubkeyBytes.length !== 33) {
    throw new Error('Invalid pubkey length');
  }

  // Initialize the Anchor program with the provided connection and IDL
  const program = new anchor.Program(IDL as Contract, {
    connection: connection,
  });

  // Generate a random ID for the smart wallet
  const id = new anchor.BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  // Create the instruction to initialize the smart wallet
  const createSmartWalletIns = await program.methods
    .initSmartWallet(secp256k1PubkeyBytes, id)
    .accounts({
      signer: keypair.publicKey, // The signer of the transaction
    })
    .instruction();

  // Create a new transaction and add the instruction
  const txn = new Transaction().add(createSmartWalletIns);

  // Set the fee payer and recent blockhash for the transaction
  txn.feePayer = keypair.publicKey;
  txn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // Sign the transaction with the keypair
  txn.sign(keypair);

  // Send the transaction to the Solana blockchain
  const txid = await connection.sendRawTransaction(txn.serialize());
  return txid; // Return the transaction ID
}