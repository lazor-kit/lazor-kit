import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

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
export interface CreateSmartWalletParams {
  secp256r1PubkeyBytes: number[];
  payer: PublicKey;
}

export interface ExecuteTransactionParams {
  arbitraryInstruction: TransactionInstruction;
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
}

export interface AddAuthenticatorParams {
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
}

export interface Message {
  nonce: number;
  timestamp: anchor.BN;
  payload: Buffer<ArrayBufferLike>;
}

export interface VerifyParam {
  pubkey: { data: number[] };
  msg: Message;
  sig: number[];
} 