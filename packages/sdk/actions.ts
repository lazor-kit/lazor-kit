/**
 * SDK Actions - Core wallet operations
 */

import { 
  Connection, 
  TransactionInstruction, 
  PublicKey, 
  VersionedTransaction,
} from '@solana/web3.js';
import { DialogManager, DialogResult, SignResult } from './core/portal';
import { StorageManager, WalletInfo, WalletConfig } from './core/storage';
import { SmartWallet, SignResponse } from './core/wallet/SmartWallet';
import { Paymaster } from './core/wallet/Paymaster';
import { SmartWalletAction, SmartWalletActionArgs , PasskeySignature} from './core/wallet/contract-integration';

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
  createPasskeyOnly: () => Promise<PasskeyData>;
  createSmartWalletOnly: (passkeyData: PasskeyData) => Promise<SmartWalletCreationResult>;
  buildSmartWalletTransaction: (payer: PublicKey, instruction: TransactionInstruction) => Promise<{
    createSessionTx: VersionedTransaction;
    executeSessionTx: VersionedTransaction;
  }>;
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

export interface CreatePasskeyOptions {
  readonly onSuccess?: (passkeyData: PasskeyData) => void;
  readonly onFail?: (error: Error) => void;
}

export interface CreateSmartWalletOptions {
  readonly onSuccess?: (result: SmartWalletCreationResult) => void;
  readonly onFail?: (error: Error) => void;
}

export interface PasskeyData {
  readonly publicKey: string;
  readonly credentialId: string;
  readonly isCreated: boolean;
}

export interface SmartWalletCreationResult {
  readonly smartWalletAddress: string;
  readonly wallet: WalletInfo;
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
 * Create passkey only without creating smart wallet
 * @param get - State getter function
 * @param set - State setter function
 * @param options - Create passkey options with callbacks
 * @returns Promise that resolves to passkey data
 */
export const createPasskeyOnlyAction = async (
  get: () => WalletState,
  set: (state: Partial<WalletState>) => void,
  options?: CreatePasskeyOptions
): Promise<PasskeyData> => {
  const { isConnecting, config } = get();
  
  if (isConnecting) {
    throw new Error('Already connecting');
  }

  set({ isConnecting: true, error: null });

  try {
    // Initialize dialog manager for portal connection
    const dialogManager = new DialogManager({
      portalUrl: config.portalUrl,
      rpcUrl: config.rpcUrl,
      paymasterUrl: config.paymasterUrl,
    });

    try {
      // Open portal connection dialog to create passkey
      const dialogResult: DialogResult = await dialogManager.openConnect();
      
      if (!dialogResult.publicKey || !dialogResult.credentialId) {
        throw new Error('Failed to create passkey: missing publicKey or credentialId');
      }

      // Store passkey data for later use
      await StorageManager.setItem('PUBLIC_KEY', dialogResult.publicKey);
      await StorageManager.setItem('CREDENTIAL_ID', dialogResult.credentialId);

      const passkeyData: PasskeyData = {
        publicKey: dialogResult.publicKey,
        credentialId: dialogResult.credentialId,
        isCreated: true,
      };

      options?.onSuccess?.(passkeyData);
      return passkeyData;
      
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
 * Create smart wallet using existing passkey data
 * @param get - State getter function
 * @param set - State setter function
 * @param passkeyData - Passkey data from createPasskeyOnly() method
 * @param options - Create smart wallet options with callbacks
 * @returns Promise that resolves to smart wallet creation result
 */
export const createSmartWalletOnlyAction = async (
  get: () => WalletState,
  set: (state: Partial<WalletState>) => void,
  passkeyData: PasskeyData,
  options?: CreateSmartWalletOptions
): Promise<SmartWalletCreationResult> => {
  const { isLoading, connection, config } = get();
  
  if (isLoading) {
    throw new Error('Already processing');
  }

  if (!passkeyData.publicKey || !passkeyData.credentialId) {
    const error = new Error('Invalid passkey data: publicKey and credentialId are required');
    options?.onFail?.(error);
    throw error;
  }

  set({ isLoading: true, error: null });

  try {
    // Initialize smart wallet and paymaster
    const paymaster = new Paymaster(config.paymasterUrl);
    const smartWallet = new SmartWallet(paymaster, connection);
    
    // Create smart wallet using passkey data
    const smartWalletAddress = await smartWallet.createSmartWallet(
      passkeyData.publicKey,
      passkeyData.credentialId
    );

    // Create wallet info
    const walletInfo: WalletInfo = {
      credentialId: passkeyData.credentialId,
      passkeyPubkey: Array.from(Buffer.from(passkeyData.publicKey, 'base64')),
      expo: 'web',
      platform: navigator.platform,
      smartWallet: smartWalletAddress,
      walletDevice: '',
    };

    // Save wallet to storage and update state
    await StorageManager.saveWallet(walletInfo);
    set({ wallet: walletInfo });

    const result: SmartWalletCreationResult = {
      smartWalletAddress,
      wallet: walletInfo,
    };

    options?.onSuccess?.(result);
    return result;
    
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
      const signature = await paymaster.signAndSendVersionedTransaction(transaction);
      
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

/**
 * Build smart wallet transactions with external payer (unsigned)
 * @param get - State getter function
 * @param payer - External payer public key
 * @param instruction - Transaction instruction to execute
 * @returns Promise that resolves to unsigned versioned transactions
 */
export const buildSmartWalletTransaction = async (
  get: () => WalletState,
  payer: PublicKey,
  instruction: TransactionInstruction
): Promise<{
  createSessionTx: VersionedTransaction;
  executeSessionTx: VersionedTransaction;
}> => {
  const { connection, config } = get();
  
  if (!connection) {
    throw new Error('No connection available');
  }

  // Get stored passkey data
  const storedPublicKey = await StorageManager.getItem('PUBLIC_KEY');
  const smartWalletAddress = await StorageManager.getItem('SMART_WALLET_ADDRESS');
  
  if (!storedPublicKey) {
    throw new Error('Public key not found. Please create passkey first.');
  }
  
  if (!smartWalletAddress) {
    throw new Error('Smart wallet address not found. Please create smart wallet first.');
  }

  try {
    // Initialize smart wallet without paymaster for external payer usage
    const paymaster = new Paymaster(config.paymasterUrl);
    const smartWallet = new SmartWallet(paymaster, connection);
    const lazorkitClient = smartWallet.getLazorkitClient();

    // Get smart wallet and wallet device info
    const passkeyPubkey = Array.from(Buffer.from(storedPublicKey, 'base64')) as number[];
    const { smartWallet: smartWalletPubkey, walletDevice } = await lazorkitClient.getSmartWalletByPasskey(passkeyPubkey);
    
    if (!smartWalletPubkey || !walletDevice) {
      throw new Error('Smart wallet not found for this passkey');
    }

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

    // Open signing dialog
    const signResult: SignResult = await dialogManager.openSign(message);
    
    // Build and send transaction using new SmartWallet design
    const signResponse: SignResponse = {
      msg: message,
      normalized: signResult.signature,
      clientDataJSONReturn: signResult.clientDataJsonBase64,
      authenticatorDataReturn: signResult.authenticatorDataBase64,
    };

    const passkeySignature: PasskeySignature = {
      passkeyPubkey,
      signature64: signResponse.normalized,
      clientDataJsonRaw64: signResponse.clientDataJSONReturn,
      authenticatorDataRaw64: signResponse.authenticatorDataReturn,
    }; 
    const createSessionTx = await lazorkitClient.createTransactionSessionWithAuth({
      payer,
      smartWallet: smartWalletPubkey,
      passkeySignature,
      policyInstruction: null, // Use default policy
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    });

    const executeSessionTx = await lazorkitClient.executeSessionTransaction({
      payer,
      smartWallet: smartWalletPubkey,
      cpiInstruction: instruction,
    });

    return {
      createSessionTx,
      executeSessionTx,
    };

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw err;
  }
};
