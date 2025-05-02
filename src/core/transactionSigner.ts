// /src/wallet/modules/transactionSigner.ts
import { createVerifyAndExecuteTransaction } from './verifyAndExecute';
import { createTransferCheckedInstruction, getOrCreateAssociatedTokenAccount, mintTo , createMint } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';

export const signAndSendTransaction = async (transactionData: any, connection: any, keypair: Keypair, smartWalletPubkey: string) => {
  const { normalized, msg } = transactionData;

  const mint = await createMint(connection, keypair, keypair.publicKey, keypair.publicKey, 6);
  
  const smartWalletAta = await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    mint,
    new PublicKey(smartWalletPubkey),
    true
  );

  await mintTo(connection, keypair, mint, smartWalletAta.address, keypair.publicKey, 10 * 10 ** 6);

  const walletAta = await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    mint,
    keypair.publicKey,
    false
  );

  const transferTokenInstruction = createTransferCheckedInstruction(
    smartWalletAta.address,
    mint,
    walletAta.address,
    new PublicKey(smartWalletPubkey),
    10 * 10 ** 6,
    6
  );

  const txn = await createVerifyAndExecuteTransaction({
    arbitraryInstruction: transferTokenInstruction,
    pubkey: Buffer.from(keypair.publicKey.toString(), 'base64'),
    signature: Buffer.from(normalized, 'base64'),
    message: Buffer.from(msg, 'base64'),
    connection,
    payer: keypair.publicKey,
    smartWalletPda: new PublicKey(smartWalletPubkey),
  });
  
  txn.partialSign(keypair);

  const txid = await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
  return txid;
};
