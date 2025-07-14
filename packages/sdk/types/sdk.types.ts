import { WalletAccount } from "./wallet.types";
import { Transaction } from '@solana/web3.js';
import { ConnectResponse } from './message.types';

export interface LazorSDKConfig {
  dialogUrl: string;
  paymasterUrl?: string;
  rpcUrl?: string;
  dialogMode?: 'iframe' | 'popup' | 'auto';
  timeout?: number;
  debug?: boolean;
  
  // Mobile specific
  mobileScheme?: string;
  androidPackage?: string;
  iosBundleId?: string;
}

export interface SDKOptions {
  theme?: 'light' | 'dark';
  locale?: string;
  skipWarning?: boolean;
}

export interface SDKEvents {
  'connect:start': void;
  'connect:success': WalletAccount;
  'connect:error': Error;
  'passkey:start': void;
  'passkey:success': ConnectResponse;
  'passkey:error': Error;
  'smartwallet:start': void;
  'smartwallet:success': { smartWalletAddress: string; account: WalletAccount };
  'smartwallet:error': Error;
  'transaction:start': void;
  'transaction:success': Transaction;
  'transaction:sent': string;
  'transaction:error': Error;
  'disconnect:start': void;
  'disconnect:success': void;
  'disconnect:error': Error;
  'reconnect:start': void;
  'reconnect:success': WalletAccount;
  'reconnect:error': Error;
  'disconnect': void; // Legacy event for backward compatibility
  'error': Error;
}