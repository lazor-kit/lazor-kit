import { WalletAccount } from "./wallet.types";
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
  'transaction:start': void;
  'transaction:success': { txHash: string };
  'transaction:error': Error;
  'disconnect': void;
  'error': Error;
}