// src/types/wallet.types.ts
import { PublicKey } from '@solana/web3.js';

export interface WalletAccount {
  publicKey: string;
  smartWallet: string;
  isConnected: boolean;
  isCreated: boolean;
}

export interface PassKeyCredential {
  id: string;
  publicKey: string;
  algorithm: number;
  transports?: string[];
}

export interface SmartWalletConfig {
  programId: PublicKey;
  authority: PublicKey;
}