import { Connection, PublicKey, TransactionInstruction , Transaction , VersionedTransaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Contract } from './services/idl/contract';


// SDK types 

export type Message = anchor.IdlTypes<Contract>['message'];
export type VerifyParam = anchor.IdlTypes<Contract>['verifyParam'];
export type PasskeyPubkey = anchor.IdlTypes<Contract>['passkeyPubkey'];
export type SmartWalletAuthority =
  anchor.IdlTypes<Contract>['smartWalletAuthority'];

export type CreateVerifyAndExecuteTransactionParam = {
  arbitraryInstruction: TransactionInstruction;
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
};

export type CreateInitSmartWalletTransactionParam = {
  secp256r1PubkeyBytes: number[];
  payer: PublicKey;
};

export type AddAuthenticatorsParam = {
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  newPasskey: PasskeyPubkey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
};

// React SDK Types
export interface WalletConnectionData {
  credentialId: string;
  publicKey: string;
}

export interface SignatureData {
  signature: string;
}

export interface WalletState {
  credentialId: string | null;
  publicKey: string | null;
  isConnected: boolean;
}

export interface PopupConfig {
  width?: number;
  height?: number;
  title?: string;
}

export interface LazorKitConfig {
  ipfsHubUrl: string;
  popupConfig?: PopupConfig;
  timeout?: number;
  rpcUrl?: string;
}

export interface UseLazorKitReturn {
  connect: () => Promise<WalletConnectionData>;
  sign: (message: string) => Promise<SignatureData>;
  disconnect: () => void;
  walletState: WalletState;
  isLoading: boolean;
  error: Error | null;
  // Solana specific methods
  createSmartWallet: (params: CreateSmartWalletParams) => Promise<Transaction>;
  executeTransaction: (params: ExecuteTransactionParams) => Promise<VersionedTransaction>;
  addAuthenticator: (params: AddAuthenticatorParams) => Promise<VersionedTransaction>;
}

// Solana SDK Types



