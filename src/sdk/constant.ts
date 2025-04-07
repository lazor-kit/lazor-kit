import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
export const SMART_WALLET_SEED = Buffer.from('smart_wallet');

export const SECP256R1_NATIVE_PROGRAM = new PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
);

export const LOOKUP_TABLE_ADDRESS = new PublicKey(
  'AhUtjWCVWJZkF4XjhVo7Y2TK2m6RiX3ritwEyxKKnL19'
); // https://rpc.lazorkit.xyz
