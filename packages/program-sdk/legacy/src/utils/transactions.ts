import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Signer,
} from '@solana/web3.js';

/**
 * Wrap a list of instructions into a signed legacy `Transaction`.
 *
 * Pure utility — does not touch the network. Use this when you've already
 * fetched a blockhash and want a signed tx ready to broadcast.
 */
export function buildLegacyTx(params: {
  payer: PublicKey;
  instructions: TransactionInstruction[];
  blockhash: string;
  signers: Signer[];
}): Transaction {
  const tx = new Transaction();
  for (const ix of params.instructions) tx.add(ix);
  tx.recentBlockhash = params.blockhash;
  tx.feePayer = params.payer;
  tx.sign(...params.signers);
  return tx;
}

/**
 * Wrap a list of instructions into a signed v0 `VersionedTransaction`,
 * optionally compressing repeated pubkeys via Address Lookup Tables.
 *
 * For LazorKit specifically, an ALT containing the system program, sysvar
 * accounts, the protocol_config PDA, and all treasury_shard PDAs gives the
 * largest savings on Execute / CreateWallet (~88 B per Secp256r1 Execute,
 * measured in tests-sdk/tests/benchmark-fees.ts).
 */
export function buildV0Tx(params: {
  payer: PublicKey;
  instructions: TransactionInstruction[];
  blockhash: string;
  signers: Signer[];
  lookupTables?: AddressLookupTableAccount[];
}): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: params.payer,
    recentBlockhash: params.blockhash,
    instructions: params.instructions,
  }).compileToV0Message(params.lookupTables);
  const vtx = new VersionedTransaction(message);
  vtx.sign(params.signers);
  return vtx;
}

/**
 * One-shot Address Lookup Table bootstrap: creates the table, extends it
 * with `addresses` (chunked to fit the per-tx instruction size cap), waits
 * one slot so it's usable in the current session, and returns the loaded
 * `AddressLookupTableAccount` ready to feed into {@link buildV0Tx}.
 *
 * Recommended contents for a LazorKit integrator's shared LUT:
 *   - `SystemProgram.programId`
 *   - `SYSVAR_INSTRUCTIONS_PUBKEY`
 *   - `SYSVAR_RENT_PUBKEY`
 *   - `client.findProtocolConfig()[0]`
 *   - all `client.findTreasuryShard(i)[0]` for i in 0..numShards
 *
 * `recentSlot` must be a finalized slot — using `confirmed` here triggers
 * "is not a recent slot" from the AddressLookupTable program.
 */
export async function createAndExtendLut(params: {
  connection: Connection;
  authority: Signer;
  addresses: PublicKey[];
}): Promise<AddressLookupTableAccount> {
  const { connection, authority, addresses } = params;

  const recentSlot = await connection.getSlot('finalized');
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createIx),
    [authority],
    { commitment: 'confirmed' },
  );

  // Extend in chunks of 30 so we stay under the per-ix size cap regardless of
  // how many addresses the caller supplies.
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: authority.publicKey,
      authority: authority.publicKey,
      lookupTable: lutAddress,
      addresses: chunk,
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(extendIx),
      [authority],
      { commitment: 'confirmed' },
    );
  }

  // ALT entries are not addressable in the same slot they were added.
  // Wait one slot so callers can use the table immediately on return.
  const target = (await connection.getSlot('confirmed')) + 1;
  while ((await connection.getSlot('confirmed')) < target) {
    await new Promise((r) => setTimeout(r, 200));
  }

  const loaded = await connection.getAddressLookupTable(lutAddress);
  if (!loaded.value) {
    throw new Error(`Lookup table ${lutAddress.toBase58()} not found after extend`);
  }
  return loaded.value;
}
