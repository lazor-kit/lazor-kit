// Import necessary Solana and Anchor dependencies
import {
    ComputeBudgetProgram, // Solana program to manage compute unit limits
    Connection, // Solana connection object
    PublicKey, // Represents a public key in Solana
    Transaction, // Represents a transaction in Solana
    TransactionInstruction, // Represents an instruction in a transaction
} from '@solana/web3.js';
import { createSecp256r1Instruction } from './utils'; // Utility to create secp256r1 signature verification instructions
import * as anchor from '@coral-xyz/anchor'; // Anchor framework for Solana programs
import { Contract } from './idl/contract'; // Type definition for the smart wallet contract
import IDL from './idl/contract.json'; // IDL (Interface Definition Language) for the smart wallet program

// Define the parameters required to create a verify-and-execute transaction
type CreateVerifyAndExecuteTransactionParams = {
    arbitraryInstruction: TransactionInstruction; // Instruction to be verified and executed
    pubkey: Buffer<ArrayBuffer>; // Public key of the signer
    signature: Buffer<ArrayBuffer>; // Signature to verify
    message: Buffer<ArrayBuffer>; // Message that was signed
    connection: Connection; // Solana connection object
    payer: PublicKey; // Public key of the fee payer
    smartWalletPda: PublicKey; // PDA of the smart wallet
};

/**
 * Creates a transaction to verify a signature and execute an arbitrary instruction.
 * @param {CreateVerifyAndExecuteTransactionParams} params - Parameters for the transaction.
 * @returns {Promise<Transaction>} - The constructed transaction.
 */
export async function createVerifyAndExecuteTransaction(
    params: CreateVerifyAndExecuteTransactionParams
): Promise<Transaction> {
    const {
        arbitraryInstruction,
        pubkey,
        signature,
        message,
        connection,
        payer,
        smartWalletPda,
    } = params;

    // Initialize the Anchor program with the provided connection and IDL
    const program = new anchor.Program(IDL as Contract, {
        connection: connection,
    });

    // Map the keys from the arbitrary instruction to remaining accounts
    let remainingAccounts = arbitraryInstruction.keys.map((key) => {
        return {
            pubkey: key.pubkey,
            isSigner: false,
            isWritable: key.isWritable,
        };
    });

    // Create the secp256r1 signature verification instruction
    const verifySecp256r1Instruction = createSecp256r1Instruction(
        message,
        pubkey,
        signature
    );

    // Construct the transaction
    const txn = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })) // Set compute unit limit
        .add(verifySecp256r1Instruction) // Add the signature verification instruction
        .add(
            await program.methods
                .verifyAndExecuteInstruction(
                    Array.from(pubkey),
                    message,
                    Array.from(signature),
                    arbitraryInstruction.data
                )
                .accounts({
                    smartWallet: smartWalletPda, // Smart wallet PDA
                    cpiProgram: arbitraryInstruction.programId, // Program ID of the instruction
                })
                .remainingAccounts(remainingAccounts) // Add remaining accounts
                .instruction()
        );

    // Set the recent blockhash and fee payer for the transaction
    txn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    txn.feePayer = payer;

    return txn; // Return the constructed transaction
}
