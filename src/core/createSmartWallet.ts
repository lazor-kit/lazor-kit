import { Connection , Transaction , Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Contract } from './idl/contract';
import IDL from './idl/contract.json';
export type CreateInitSmartWalletTransactionParam = {
  secp256k1PubkeyBytes: number[];
  connection: Connection;
};

export async function createSmartWalletTransaction(
  param: CreateInitSmartWalletTransactionParam
): Promise<String> {
  const { secp256k1PubkeyBytes, connection } = param;

  const keypair = Keypair.fromSecretKey(new Uint8Array([91,139,202,42,20,31,61,11,170,237,184,147,253,10,63,240,131,46,231,211,253,181,58,104,242,192,0,143,19,252,47,158,219,165,97,103,220,26,173,243,207,52,18,44,64,84,249,104,158,221,84,61,36,240,55,20,76,59,142,34,100,132,243,236]))
  if (secp256k1PubkeyBytes.length !== 33) {
    throw new Error('Invalid pubkey length');
  }

  const program = new anchor.Program(IDL as Contract, {
    connection: connection,
  });

  const id = new anchor.BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  const createSmartWalletIns = await program.methods
    .initSmartWallet(secp256k1PubkeyBytes, id)
    .accounts({
      signer: keypair.publicKey,
    })
    .instruction();

  const txn = new Transaction().add(createSmartWalletIns);

  txn.feePayer = keypair.publicKey;
  txn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  txn.sign(keypair)
  const txid = await connection.sendRawTransaction(txn.serialize());
  return txid;
}