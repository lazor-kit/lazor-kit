import { PublicKey } from '@solana/web3.js';

// Solana RPC URL
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

// IPFS Hub URL
export const DEFAULT_IPFS_HUB_URL = 'https://bafybeief3qw667srfsovy6zspxqy3ti2bgqseicsvzd5bpkkezn2kzblb4.ipfs.w3s.link';

// Program ID
export const PROGRAM_ID = new PublicKey('your_program_id_here');

// Lookup Table Address
export const LOOKUP_TABLE_ADDRESS = new PublicKey('6GxBfXPQxVV17tdvpXLD7uz2tGqyEhRYYVWw8rKHMFw1');

// Popup Configuration
export const DEFAULT_POPUP_CONFIG = {
  width: 600,
  height: 400,
  title: 'WalletAction'
};

// Timeout Configuration (in milliseconds)
export const DEFAULT_TIMEOUT = 60000;

// Smart Wallet Seed
export const SMART_WALLET_SEED = Buffer.from('smart_wallet');

// Secp256r1 Native Program
export const SECP256R1_NATIVE_PROGRAM = new PublicKey('your_secp256r1_program_id_here');

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