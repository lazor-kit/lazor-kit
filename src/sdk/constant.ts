import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
export const SMART_WALLET_SEED = Buffer.from('smart_wallet');

export const SECP256R1_NATIVE_PROGRAM = new PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
);

export const LOOKUP_TABLE_ADDRESS = new PublicKey(
  '339ZFSTd8dPonacCY5HC9bo4yWXbnFtenED7tBWCiD2V'
); // https://rpc.lazorkit.xyz
