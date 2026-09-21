import { Buffer } from 'buffer';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { config } from './config';
import type { Passkey } from './portal';

/**
 * Dev-only: create a v1 wallet owned by the connected passkey, so there is
 * something to migrate.
 *
 * This exists because the one thing an operator cannot set up for a tester is
 * the passkey itself. It is gated on VITE_DEV_SETUP and a payer key supplied
 * through the environment, and the protocol v1 SDK is imported lazily so none
 * of it reaches a production bundle.
 *
 * The program must be running its v1 binary when this is called.
 */
export async function seedV1Wallet(passkey: Passkey): Promise<{
  walletPda: PublicKey;
  vault: PublicKey;
  signature: string;
}> {
  const secret = import.meta.env.VITE_DEV_PAYER as string | undefined;
  if (!secret) throw new Error('set VITE_DEV_PAYER to a devnet keypair (JSON array) to seed');

  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const { LazorKitClient } = (await import('sdk-v1')) as unknown as {
    LazorKitClient: new (c: Connection, p?: PublicKey) => {
      createWallet(params: {
        payer: PublicKey;
        userSeed: Uint8Array;
        owner: { type: 'secp256r1'; credentialIdHash: Uint8Array; compressedPubkey: Uint8Array; rpId: string };
      }): Promise<{ instructions: Parameters<Transaction['add']>[0][]; walletPda: PublicKey }>;
      findVault(wallet: PublicKey): [PublicKey, number];
    };
  };

  const client = new LazorKitClient(connection, config.programId);
  // Random, and deliberately discarded: the migration must not need it.
  const userSeed = crypto.getRandomValues(new Uint8Array(32));

  const { instructions, walletPda } = await client.createWallet({
    payer: payer.publicKey,
    userSeed,
    owner: {
      type: 'secp256r1',
      credentialIdHash: passkey.credentialIdHash,
      compressedPubkey: passkey.compressedPubkey,
      rpId: new URL(config.portalUrl).hostname,
    },
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [payer],
    { commitment: 'confirmed' },
  );
  const [vault] = client.findVault(walletPda);
  return { walletPda, vault, signature };
}

export const devSeedEnabled = (): boolean =>
  import.meta.env.VITE_DEV_SETUP === '1' && !!import.meta.env.VITE_DEV_PAYER;

export { Buffer };
