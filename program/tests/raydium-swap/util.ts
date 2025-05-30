export const printSimulateInfo = () => {
  console.log(
    'you can paste simulate tx string here: https://explorer.solana.com/tx/inspector and click simulate to check transaction status'
  );
  console.log(
    'if tx simulate successful but did not went through successfully after running execute(xxx), usually means your txs were expired, try set up higher priority fees'
  );
  console.log(
    'strongly suggest use paid rpcs would get you better performance'
  );
};

import { AMM_STABLE, DEVNET_PROGRAM_ID } from '@raydium-io/raydium-sdk-v2';
import { AMM_PROGRAM_ID } from './config';

const VALID_PROGRAM_ID = new Set([
  AMM_PROGRAM_ID.toBase58(),
  AMM_STABLE.toBase58(),
  DEVNET_PROGRAM_ID.AmmV4.toBase58(),
  DEVNET_PROGRAM_ID.AmmStable.toBase58(),
]);

export const isValidAmm = (id: string) => VALID_PROGRAM_ID.has(id);
