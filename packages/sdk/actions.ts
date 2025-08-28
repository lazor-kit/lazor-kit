/**
 * SDK Actions - Core wallet operations
 */

import { Connection, TransactionInstruction } from '@solana/web3.js';
import { DialogManager, DialogResult, SignResult } from './core/portal';
import { StorageManager, WalletInfo, WalletConfig } from './core/storage';
import { SmartWallet, SignResponse } from './core/wallet/SmartWallet';
import { Paymaster } from './core/wallet/Paymaster';
import { SmartWalletAction, SmartWalletActionArgs } from './core/wallet/contract-integration';

/**
 * Wallet state interface
 */
export interface WalletState {
  // Data
  wallet: WalletInfo | null;
  config: WalletConfig;
  connection: Connection;

  // Status
  isLoading: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;

  // State setters
  setConfig: (config: WalletConfig) => void;
  setWallet: (wallet: WalletInfo | null) => void;
  setLoading: (isLoading: boolean) => void;
  setConnecting: (isConnecting: boolean) => void;
  setSigning: (isSigning: boolean) => void;
  setConnection: (connection: Connection) => void;
  setError: (error: Error | null) => void;
  clearError: () => void;

  // Actions
  connect: () => Promise<WalletInfo>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (instruction: TransactionInstruction) => Promise<string>;
}

export interface ConnectOptions {
  readonly onSuccess?: (wallet: WalletInfo) => void;
  readonly onFail?: (error: Error) => void;
}

export interface DisconnectOptions {
  readonly onSuccess?: () => void;
  readonly onFail?: (error: Error) => void;
}

export interface SignOptions {
  readonly onSuccess?: (signature: string) => void;
  readonly onFail?: (error: Error) => void;
}

/**
 * Connect wallet action
 * @param get - State getter function
 * @param set - State setter function
 * @param options - Connection options with callbacks
 * @returns Promise that resolves to wallet information
 */
export const connectAction = async (
  get: () => WalletState,
  set: (state: Partial<WalletState>) => void,
  options?: ConnectOptions
): Promise<WalletInfo> => {
  const { isConnecting, config } = get();
  
  if (isConnecting) {
    throw new Error('Already connecting');
  }

  set({ isConnecting: true, error: null });

  try {
    // Check if wallet already exists in storage
    const existingWallet = await StorageManager.getWallet();
    
    // Clean up legacy Zustand data conflicts
    const oldZustandData = localStorage.getItem('lazorkit-wallet');
    if (oldZustandData) {
      try {
        const parsed = JSON.parse(oldZustandData);
        if (parsed.state && parsed.version !== undefined) {
          localStorage.removeItem('lazorkit-wallet');
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    if (existingWallet) {
      set({ wallet: existingWallet });
      options?.onSuccess?.(existingWallet);
      return existingWallet;
    }

    // Initialize dialog manager for portal connection
    const dialogManager = new DialogManager({
      portalUrl: config.portalUrl,
      rpcUrl: config.rpcUrl,
      paymasterUrl: config.paymasterUrl,
    });

    try {
      // Open portal connection dialog
      const dialogResult: DialogResult = await dialogManager.openConnect();
      
      // Initialize smart wallet and paymaster
      const paymaster = new Paymaster(config.paymasterUrl);
      const smartWallet = new SmartWallet(paymaster, get().connection);
      
      let smartWalletAddress: string;
      
      try {
        // Try to find existing smart wallet first
        smartWalletAddress = await smartWallet.getSmartWalletCredential(dialogResult.credentialId);
      } catch (error) {
        // Smart wallet not found, create new one
        if (!dialogResult.publicKey) {
          throw new Error(
            'Cannot create smart wallet: publicKey is required but not provided. ' +
            'This usually means the portal returned an existing credential without publicKey, ' +
            'but no smart wallet was found for this credential.'
          );
        }
        
        smartWalletAddress = await smartWallet.createSmartWallet(
          dialogResult.publicKey,
          dialogResult.credentialId
        );
      }

      // Create wallet info
      const walletInfo: WalletInfo = {
        credentialId: dialogResult.credentialId,
        passkeyPubkey: dialogResult.publicKey 
          ? Array.from(Buffer.from(dialogResult.publicKey, 'base64'))
          : [],
        expo: 'web',
        platform: navigator.platform,
        smartWallet: smartWalletAddress,
        walletDevice: '',
      };

      // Save wallet to storage and update state
      await StorageManager.saveWallet(walletInfo);
      set({ wallet: walletInfo });
      options?.onSuccess?.(walletInfo);
      return walletInfo;
      
    } finally {
      dialogManager.destroy();
    }
    
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    set({ error: err });
    options?.onFail?.(err);
    throw err;
  } finally {
    set({ isConnecting: false });
  }
};

/**
 * Disconnect wallet action
 * @param set - State setter function
 * @param options - Disconnect options with callbacks
 */
export const disconnectAction = async (
  set: (state: Partial<WalletState>) => void,
  options?: DisconnectOptions
): Promise<void> => {
  set({ isLoading: true });
  
  try {
    await StorageManager.clearWallet();
    set({ wallet: null, error: null });
    options?.onSuccess?.();
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    set({ error: err });
    options?.onFail?.(err);
    throw err;
  } finally {
    set({ isLoading: false });
  }
};

/**
 * Sign and send transaction action
 * @param get - State getter function
 * @param set - State setter function
 * @param instruction - Transaction instruction to execute
 * @param options - Sign options with callbacks
 * @returns Promise that resolves to transaction hash
 */
export const signAndSendTransactionAction = async (
  get: () => WalletState,
  set: (state: Partial<WalletState>) => void,
  instruction: TransactionInstruction,
  options?: SignOptions
): Promise<string> => {
  const { isSigning, connection, wallet, config } = get();
  
  if (isSigning) {
    throw new Error('Already signing');
  }

  if (!wallet) {
    const error = new Error('No wallet connected');
    options?.onFail?.(error);
    throw error;
  }

  if (!connection) {
    const error = new Error('No connection available');
    options?.onFail?.(error);
    throw error;
  }

  set({ isSigning: true, error: null });

  try {
    // Initialize smart wallet and paymaster
    const paymaster = new Paymaster(config.paymasterUrl);
    const smartWallet = new SmartWallet(paymaster, connection);
    
    // Build smart wallet action
    const action: SmartWalletActionArgs = {
      type: SmartWalletAction.ExecuteTransaction,
      args: {
        policyInstruction: null,
        cpiInstruction: instruction,
      },
    };
    
    // Build authorization message for signing
    const message = await smartWallet.getMessage(action);
    
    // Create dialog manager for signing
    const dialogManager = new DialogManager({
      portalUrl: config.portalUrl,
      rpcUrl: config.rpcUrl,
      paymasterUrl: config.paymasterUrl,
    });

    try {
      // Open signing dialog
      const signResult: SignResult = await dialogManager.openSign(message);
      
      // Build and send transaction using new SmartWallet design
      const signResponse: SignResponse = {
        msg: message,
        normalized: signResult.signature,
        clientDataJSONReturn: signResult.clientDataJsonBase64,
        authenticatorDataReturn: signResult.authenticatorDataBase64,
      };
      
      const { transaction } = await smartWallet.buildTransaction(instruction, signResponse);
      
      // Send transaction via paymaster
      const signature = await paymaster.signAndSend(transaction);
      
      options?.onSuccess?.(signature);
      return signature;
      
    } finally {
      dialogManager.destroy();
    }
    
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    set({ error: err });
    options?.onFail?.(err);
    throw err;
  } finally {
    set({ isSigning: false });
  }
};
