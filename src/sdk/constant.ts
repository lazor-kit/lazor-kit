import { Keypair, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const SMART_WALLET_SEED = Buffer.from('smart_wallet');

export const SECP256R1_NATIVE_PROGRAM = new PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
);

export const LOOKUP_TABLE_ADDRESS = new PublicKey(
  '339ZFSTd8dPonacCY5HC9bo4yWXbnFtenED7tBWCiD2V'
); // https://rpc.lazorkit.xyz

export const NONCE_KEYPAIR = Keypair.fromSecretKey(new Uint8Array([91, 139, 202, 42, 20, 31, 61, 11, 170, 237, 184, 147, 253, 10, 63, 240, 131, 46, 231, 211, 253, 181, 58, 104, 242, 192, 0, 143, 19, 252, 47, 158, 219, 165, 97, 103, 220, 26, 173, 243, 207, 52, 18, 44, 64, 84, 249, 104, 158, 221, 84, 61, 36, 240, 55, 20, 76, 59, 142, 34, 100, 132, 243, 236]));

export const WALLET_CONNECT_URL = 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/?action=connect';
