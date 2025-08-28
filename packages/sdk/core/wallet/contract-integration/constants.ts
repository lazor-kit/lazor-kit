import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';

// LAZOR.KIT PROGRAM - PDA Seeds
export const SMART_WALLET_SEED = Buffer.from('smart_wallet');
export const SMART_WALLET_DATA_SEED = Buffer.from('smart_wallet_data');
export const WALLET_DEVICE_SEED = Buffer.from('wallet_device');
export const POLICY_PROGRAM_REGISTRY_SEED = Buffer.from('policy_registry');
export const CONFIG_SEED = Buffer.from('config');
export const AUTHORITY_SEED = Buffer.from('authority');
export const TRANSACTION_SESSION_SEED = Buffer.from('transaction_session');

// POLICY PROGRAM SEEDS
export const POLICY_DATA_SEED = Buffer.from('policy_data');
export const MEMBER_SEED = Buffer.from('member');
export const POLICY_SEED = Buffer.from('policy');

// ADDRESS LOOKUP TABLE for Versioned Transactions (v0)
// This lookup table contains frequently used program IDs and accounts
// to reduce transaction size and enable more complex operations
export const ADDRESS_LOOKUP_TABLE = new anchor.web3.PublicKey(
  '7Pr3DG7tRPAjVb44gqbxTj1KstikAuVZY7YmXdotVjLA'
);
