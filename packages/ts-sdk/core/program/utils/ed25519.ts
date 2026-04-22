import { PublicKey } from '@solana/web3.js';

/**
 * Callback interface for Ed25519 signing. The SDK never touches private keys.
 * Implementors provide their own signing logic (e.g. Keypair.sign, hardware wallet).
 */
export interface Ed25519Signer {
  publicKey: PublicKey;
  sign(message: Uint8Array): Promise<Uint8Array>;
}
