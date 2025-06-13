import { EventEmitter } from 'eventemitter3';
import { Connection, TransactionInstruction, Transaction } from '@solana/web3.js';
import { DialogManager } from './dialog/DialogManager';
import { SmartWallet } from './wallet/SmartWallet';
import { Paymaster } from './wallet/Paymaster';
import { Security } from './security/Security';
import { MessageHandler } from './bridge/MessageHandler';
import { validateConfig } from '../utils/validation';
import { SDKError } from '../constants/errors';
import { Buffer } from 'buffer';
import {
  SDKOptions,
  SDKEvents,
  WalletAccount,
  ErrorCode
} from '../types';
import { ConnectResponse, SignResponse } from '../types/message.types';
import { PublicKey } from '@solana/web3.js';
import { CommunicationConfig } from './dialog/CommunicationHandler';
import { StorageUtil } from '../utils/storage';

/**
 * Lazorkit is the main entry point for the Lazor Kit SDK
 * It manages wallet connection, transaction signing, and communication with the Lazor portal
 */
export class Lazorkit extends EventEmitter<SDKEvents> {
  private config: CommunicationConfig;
  private dialogManager: DialogManager;
  private messageHandler: MessageHandler;
  private security: Security;
  private paymaster: Paymaster;
  private smartWallet: SmartWallet | null = null;
  private account: WalletAccount | null = null;
  /**
   * Create a new Lazorkit instance
   * @param config SDK configuration options
   */
  constructor(config: CommunicationConfig) {
    super();
    
    validateConfig(config);
    this.config = config;
    this.security = new Security();
    this.paymaster = new Paymaster(config.paymasterUrl || 'https://paymaster.lazor.io');
    
    // Create dialog manager with proper config
    // Create dialog manager with proper config
    const dialogConfig: CommunicationConfig = {
      url: config.url,
      mode: config.mode || 'dialog',
      rpcUrl: config.rpcUrl,
      paymasterUrl: config.paymasterUrl,
      fallbackToPopup: config.fallbackToPopup
    };

    this.dialogManager = new DialogManager(dialogConfig);
    
    this.messageHandler = new MessageHandler();
    this.setupMessageHandler();
  }

  /**
   * Connect wallet and create/retrieve passkey
   * @param options Additional options for connection
   * @returns Connected wallet account information
   */
  async connect(options?: SDKOptions): Promise<WalletAccount> {
    try {
      this.emit('connect:start');
      
      if (this.account?.isConnected) {
        return this.account;
      }
      
      const challenge = this.security.generateChallenge();
      await this.dialogManager.connect();
    
      const response = await this.messageHandler.request<ConnectResponse>(this.dialogManager, {
        method: 'passkey:connect',
        params: {
          challenge,
          origin: window.location.origin,
          skipWarning: options?.skipWarning,
          ...options
        }
      });
    
      if (!response) {
        throw new SDKError(ErrorCode.CONNECTION_FAILED, 'No response received from dialog');
      }

      let { publicKey, isCreated, credentialId } = response;
      
      if (!this.config.rpcUrl) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'RPC URL is not defined');
      }
      
      // Validate public key
      if (!publicKey) {
        console.warn('Public key is undefined in connect response, checking localStorage');
        const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
        if (storedPublicKey) {
          console.log('Using public key from localStorage:', storedPublicKey);
          publicKey = storedPublicKey;
        } else {
          throw new SDKError(ErrorCode.CONNECTION_FAILED, 'Public key not available');
        }
      }

      // Store credentials in local storage immediately to ensure availability
      StorageUtil.saveCredentials({
        credentialId: credentialId,
        publickey: publicKey, // Match the case used in reference implementation
        smartWalletAddress: '', // Will be updated after smart wallet creation
        timestamp: Date.now()
      });

      // Initialize smart wallet right away
      this.smartWallet = new SmartWallet(
        this.paymaster, 
        new Connection(this.config.rpcUrl)
      );
      
      // Create smart wallet and get address
      const smartWalletAddress = await this.smartWallet.createSmartWallet(publicKey);
      
      // Update stored credentials with the smart wallet address
      StorageUtil.saveCredentials({
        credentialId: credentialId,
        publickey: publicKey,
        smartWalletAddress,
        timestamp: Date.now()
      });
      
      this.account = {
        publicKey,
        smartWallet: smartWalletAddress,
        isConnected: true,
        isCreated
      };
      
      // Emit success event before closing dialog to ensure listeners are notified
      this.emit('connect:success', this.account);
      
      // Add a small delay before closing dialog to ensure events are processed
      setTimeout(() => {
        this.dialogManager.close();
      }, 100);
      
      return this.account;
      
    } catch (error) {
      this.emit('connect:error', error as Error);
      throw error;
    }
  }

  /**
   * Sign transaction with passkey
   * @param instruction The transaction instruction to sign
   * @returns Signed transaction
   */
  async signTransaction(instruction: TransactionInstruction): Promise<Transaction> {
    try {
      this.emit('transaction:start');
      console.log('Transaction signing started');

      // Don't close the dialog until we're completely done
      let dialogClosed = false;
      
      try {
        // Serialize the instruction for signing
        const serializedInstruction = Buffer.from(JSON.stringify(instruction)).toString('base64');
        const message = {
          instructions: serializedInstruction,
          timestamp: Date.now(),
          nonce: this.security.generateNonce()
        };
        
        // Make sure credentials are synced before opening dialog
        this.dialogManager.syncCredentials(true);
        
        // Open the dialog for signing
        console.log('Opening dialog for signing...');
        await this.dialogManager.sign();
        
        // IMPORTANT: We need to wait for the user to sign the transaction
        // The messageHandler.request will wait for the response from the dialog
        // and won't return until the user has signed or cancelled
        console.log('Waiting for user to sign transaction...');
        const signResponse = await this.messageHandler.request<SignResponse>(this.dialogManager, {
          method: 'passkey:sign',
          params: {
            message: Buffer.from(JSON.stringify(message)).toString('base64'),
            origin: window.location.origin
          }
        }, 60000); // 60 second timeout
    
        console.log('Received signature response:', signResponse);
        
        if (!signResponse) {
          throw new SDKError(ErrorCode.SIGN_FAILED, 'No response received from dialog');
        }
        
        if (!this.smartWallet) {
          throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
        }
        
        // Build transaction with the signature
        // IMPORTANT: We build the transaction BEFORE closing the dialog
        // to ensure we have all the necessary data
        console.log('Building transaction with signature...');
        const { transaction } = await this.smartWallet.buildTransaction(
          instruction,
          signResponse
        );
        
        const signedTransaction = await this.paymaster.sign(transaction);
        signedTransaction.feePayer = new PublicKey(await this.paymaster.getPayer());
        
        console.log('Transaction built successfully, closing dialog');
        // Only close the dialog AFTER the transaction is fully built
        this.dialogManager.close();
        dialogClosed = true;
        
        this.emit('transaction:success', signedTransaction);
        return signedTransaction;
      } catch (innerError) {
        console.error('Error during transaction signing:', innerError);
        if (!dialogClosed) {
          console.log('Closing dialog due to error');
          this.dialogManager.close();
        }
        throw innerError;
      }
    } catch (error) {
      this.emit('transaction:error', error as Error);
      throw error;
    }
  }

  /**
   * Sign and send transaction
   * @param instruction The transaction instruction to sign and send
   * @returns Transaction hash as a string
   */
  async signAndSendTransaction(instruction: TransactionInstruction): Promise<string> {
    try {
      this.emit('transaction:start');
      console.log('Transaction signing and sending started');

      // Don't close the dialog until we're completely done
      let dialogClosed = false;
      
      try {
        // Serialize the instruction for signing
        const serializedInstruction = Buffer.from(JSON.stringify(instruction)).toString('base64');
        const message = {
          instructions: serializedInstruction,
          timestamp: Date.now(),
          nonce: this.security.generateNonce()
        };
        
        // Make sure credentials are synced before opening dialog
        this.dialogManager.syncCredentials(true);
        
        // Open the dialog for signing
        console.log('Opening dialog for signing...');
        await this.dialogManager.sign();
        
        // IMPORTANT: We need to wait for the user to sign the transaction
        // The messageHandler.request will wait for the response from the dialog
        // and won't return until the user has signed or cancelled
        console.log('Waiting for user to sign transaction...');
        const signResponse = await this.messageHandler.request<SignResponse>(this.dialogManager, {
          method: 'passkey:sign',
          params: {
            message: Buffer.from(JSON.stringify(message)).toString('base64'),
            origin: window.location.origin
          }
        }, 60000); // 60 second timeout
    
        console.log('Received signature response:', signResponse);
        
        if (!signResponse) {
          throw new SDKError(ErrorCode.SIGN_FAILED, 'No response received from dialog');
        }
        
        if (!this.smartWallet) {
          throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
        }
        
        // Build transaction with the signature
        // IMPORTANT: We build the transaction BEFORE closing the dialog
        // to ensure we have all the necessary data
        console.log('Building transaction with signature...');
        const { transaction } = await this.smartWallet.buildTransaction(
          instruction,
          signResponse
        );
        
        console.log('Transaction built successfully, closing dialog');
        // Only close the dialog AFTER the transaction is fully built
        this.dialogManager.close();
        dialogClosed = true;
        
        const signedTransaction = await this.paymaster.sign(transaction);
        signedTransaction.feePayer = new PublicKey(await this.paymaster.getPayer());
        this.emit('transaction:success', signedTransaction);

        // Send the transaction
        console.log('Sending transaction to blockchain...');
        const txHash = await this.paymaster.signAndSend(signedTransaction);
        console.log('Transaction sent successfully:', txHash);
        this.emit('transaction:sent', txHash);
        return txHash;
      } catch (innerError) {
        console.error('Error during transaction signing or sending:', innerError);
        if (!dialogClosed) {
          console.log('Closing dialog due to error');
          this.dialogManager.close();
        }
        throw innerError;
      }
    } catch (error) {
      this.emit('transaction:error', error as Error);
      throw error;
    }
  }

  /**
   * Disconnect wallet
   * @returns Promise that resolves when disconnection is complete
   */
  async disconnect(): Promise<void> {
    this.dialogManager.destroy();
    this.account = null;
    this.smartWallet = null;
    
    // Clear credentials from local storage
    StorageUtil.clearCredentials();
    
    this.emit('disconnect');
  }

  /**
   * Get current account
   * @returns The current wallet account or null if not connected
   */
  getAccount(): WalletAccount | null {
    return this.account;
  }

  /**
   * Check if wallet is connected
   * @returns True if wallet is connected, false otherwise
   */
  isConnected(): boolean {
    return !!this.account?.isConnected;
  }

  /**
   * Get paymaster instance
   * @returns The paymaster instance
   */
  getPaymaster(): Paymaster {
    return this.paymaster;
  }

  /**
   * Destroy SDK instance and clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
    this.messageHandler.destroy();
  }
  

  /**
   * Set up message handler to forward errors to SDK events
   */
  private setupMessageHandler(): void {
    this.messageHandler.on('error', (error) => {
      this.emit('error', error);
    });
  }
}

