import {
    PROGRAM_ADDRESS_MAINNET,
    PROGRAM_ID_MAINNET,
} from '@lazorkit/sdk-legacy';

/**
 * LazorKit v2 program address on mainnet. v2 runs at its own id; the v1
 * program (`PROGRAM_ID_MAINNET_V1`, re-exported from the SDK) keeps the old one
 * until it is retired. Clients pick the right one per cluster from the RPC
 * URL, and per wallet from the protocol it lives on — do not pass this around
 * as "the" program id.
 */
export const PROGRAM_ADDRESS = PROGRAM_ADDRESS_MAINNET;

/** LazorKit v2 program id on mainnet. */
export const PROGRAM_ID = PROGRAM_ID_MAINNET;
