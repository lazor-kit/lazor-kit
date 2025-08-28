import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const POLICY_SEED = Buffer.from('policy');

export function derivePolicyPda(
  programId: PublicKey,
  walletDevice: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POLICY_SEED, walletDevice.toBuffer()],
    programId
  )[0];
}
