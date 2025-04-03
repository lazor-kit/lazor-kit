import { PublicKey } from '@solana/web3.js';
// Solana RPC URL
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

// IPFS Hub URL
export const SMART_WALLET_SEED = new TextEncoder().encode('smart_wallet');

export const SECP256R1_NATIVE_PROGRAM = new PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
);

export const LOOKUP_TABLE_ADDRESS = new PublicKey(
  'AhUtjWCVWJZkF4XjhVo7Y2TK2m6RiX3ritwEyxKKnL19'
); // https://rpc.lazorkit.xyz

// Popup Configuration
export const DEFAULT_POPUP_CONFIG = {
  width: 600,
  height: 400,
  title: 'WalletAction'
};

// Timeout Configuration (in milliseconds)
export const DEFAULT_TIMEOUT = 60000;

// Signature Offsets
export const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 11;
export const SIGNATURE_OFFSETS_SIGNATURE_INDEX_OFFSET = 0;
export const SIGNATURE_OFFSETS_SIGNATURE_INDEX_LENGTH = 2;
export const SIGNATURE_OFFSETS_PUBKEY_INDEX_OFFSET = 2;
export const SIGNATURE_OFFSETS_PUBKEY_INDEX_LENGTH = 2;
export const SIGNATURE_OFFSETS_MESSAGE_DATA_OFFSET_OFFSET = 4;
export const SIGNATURE_OFFSETS_MESSAGE_DATA_OFFSET_LENGTH = 2;
export const SIGNATURE_OFFSETS_MESSAGE_DATA_SIZE_OFFSET = 6;
export const SIGNATURE_OFFSETS_MESSAGE_DATA_SIZE_LENGTH = 2;
export const SIGNATURE_OFFSETS_MESSAGE_INDEX_OFFSET = 8;
export const SIGNATURE_OFFSETS_MESSAGE_INDEX_LENGTH = 2;

// Secp256r1 Curve
export const SECP256R1_SERIALIZED_SIGNATURE_SIZE = 64;
export const SECP256R1_PUBKEY_SIZE = 64;
export const SECP256R1_SIGNATURE_SIZE = 64;
export const SECP256R1_RECOVERY_ID_OFFSET = 64;
export const SECP256R1_SIGNATURE_OFFSET = 0;
export const SECP256R1_PUBKEY_OFFSET = 1;
export const SECP256R1_MESSAGE_OFFSET = 65;
export const SECP256R1_MESSAGE_SIZE = 32; 