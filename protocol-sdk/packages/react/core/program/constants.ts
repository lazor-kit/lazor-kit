import {
    PROGRAM_ADDRESS_MAINNET,
    PROGRAM_ID_MAINNET,
} from '@lazorkit/sdk-legacy';

export const PROGRAM_ADDRESS = PROGRAM_ADDRESS_MAINNET;
export const PROGRAM_ID = PROGRAM_ID_MAINNET;
// Compatibility exports for callers that name the protocol generation.
export { PROGRAM_ID_MAINNET as PROGRAM_ID_MAINNET_V1, PROGRAM_ID_DEVNET as PROGRAM_ID_DEVNET_V1,
  ACCOUNT_DISCRIMINATOR } from '@lazorkit/sdk-legacy';
export const V1_DISC_AUTHORITY = 2;
