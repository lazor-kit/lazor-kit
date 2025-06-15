import { TransactionInstruction } from '@solana/web3.js';

export interface TransactionRequest {
  instructions: TransactionInstruction[];
  feePayer?: string;
}

export interface TransactionResponse {
  success: boolean;
  txHash?: string;
  transaction?: string;
  error?: string;
}

export interface SerializedInstruction {
  programId: string;
  keys: {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }[];
  data: string;
}

export interface PaymasterConfig {
  endpoint: string;
  apiKey?: string;
}