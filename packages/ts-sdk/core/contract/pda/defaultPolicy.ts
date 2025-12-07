import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';

export const POLICY_SEED = Buffer.from('policy');

export function derivePolicyPda(
  programId: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [POLICY_SEED, smartWallet.toBuffer()],
    programId
  )[0];
}
