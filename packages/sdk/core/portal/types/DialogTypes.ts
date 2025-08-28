/**
 * Types and interfaces for dialog communication
 */

/**
 * Dialog display mode
 */
export type DialogMode = 'popup' | 'dialog' | 'auto';

/**
 * Dialog action type
 */
export type DialogAction = 'connect' | 'sign' | 'pay';

/**
 * Configuration for the communication handler
 */
export interface CommunicationConfig {
  /**
   * URL of the dialog interface
   */
  url: string;

  /**
   * Dialog mode (popup, dialog, or auto)
   */
  mode?: DialogMode;

  /**
   * Whether to fallback to popup when dialog is not supported
   */
  fallbackToPopup?: boolean;

  /**
   * URL of the RPC endpoint
   */
  rpcUrl?: string;

  /**
   * URL of the paymaster service
   */
  paymasterUrl?: string;
}

/**
 * Credential data structure
 */
export interface CredentialData {
  credentialId: string;
  publickey?: string;
  publicKey?: string;
  smartWalletAddress?: string;
  timestamp?: string | number;
  connectionType?: string;
}

/**
 * Message data structure
 */
export interface MessageData {
  type: string;
  data?: any;
  error?: string;
}
