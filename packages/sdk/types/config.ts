export type LazorSDKConfig = {
  /**
   * URL of the dialog interface
   */
  url: string;

  /**
  fallbackToPopup?: boolean;
  
  /**
   * URL of the RPC endpoint
   */
  rpcUrl?: string;
  
  /**
   * URL of the paymaster service
   */
  paymasterUrl?: string;
  
  /**
   * Dialog mode (popup, dialog, or auto)
   */
  dialogMode?: 'popup' | 'dialog' | 'auto';
}
