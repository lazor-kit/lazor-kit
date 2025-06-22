import { EventEmitter } from 'eventemitter3';
import { Connection, TransactionInstruction, Transaction } from '@solana/web3.js';
import { SmartWallet } from './wallet/SmartWallet';
import { Paymaster } from './wallet/Paymaster';
import { Security } from './security/Security';
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
import { CommunicationConfig } from './dialog/types/DialogTypes';
import { StorageUtil } from '../utils/storage';
import { CommunicationHandler } from './dialog/CommunicationHandler';
/**
 * Lazorkit is the main entry point for the Lazor Kit SDK
 * It manages wallet connection, transaction signing, and communication with the Lazor portal
 */
export class Lazorkit extends EventEmitter<SDKEvents> {
  private config: CommunicationConfig;
  private security: Security;
  private paymaster: Paymaster;
  private communicationHandler: CommunicationHandler;
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
    this.communicationHandler = new CommunicationHandler(config);
    // Create dialog manager with proper config
    // Create dialog manager with proper config
    const dialogConfig: CommunicationConfig = {
      url: config.url,
      mode: config.mode || 'dialog',
      rpcUrl: config.rpcUrl,
      paymasterUrl: config.paymasterUrl,
      fallbackToPopup: config.fallbackToPopup
    };

    
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
      
      const connectPromise = new Promise<ConnectResponse>((resolve, reject) => {
        // Set up a one-time event listener for the connect event
        const connectHandler = (data: any) => {
          // Remove the event listener once we get a response
          this.communicationHandler.off('connect', connectHandler);
          resolve(data);
        };
        
        // Set up an error handler
        const errorHandler = (error: Error) => {
          // Remove both event listeners
          this.communicationHandler.off('connect', connectHandler);
          this.communicationHandler.off('error', errorHandler);
          reject(error);
        };
        
        // Register both event listeners
        this.communicationHandler.on('connect', connectHandler);
        this.communicationHandler.on('error', errorHandler);
        
        // Set a timeout to reject the promise if no response is received
        setTimeout(() => {
          this.communicationHandler.off('connect', connectHandler);
          this.communicationHandler.off('error', errorHandler);
        }, 30000); // 30 second timeout
      });
      let smartWalletAddress = '';
      // Open the dialog for connection
      await this.communicationHandler.openDialog('connect');
      
      // Wait for the connect event to be emitted
      const response = await connectPromise;
    
      if (!response) {
        throw new SDKError(ErrorCode.CONNECTION_FAILED, 'No response received from dialog');
      }

      let { publicKey, isCreated, credentialId } = response;
      
      if (!this.config.rpcUrl) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'RPC URL is not defined');
      }
      // Initialize smart wallet right away
      this.smartWallet = new SmartWallet(
        this.paymaster, 
        new Connection(this.config.rpcUrl)
      );
      if (!publicKey) {
        const smartWalletCredential = await this.smartWallet.getSmartWalletCredential(credentialId);
        smartWalletAddress = smartWalletCredential;
        StorageUtil.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
      } else {
        smartWalletAddress = await this.smartWallet.createSmartWallet(publicKey, credentialId);
        StorageUtil.setItem('PUBLIC_KEY', publicKey);
        StorageUtil.setItem('CREDENTIAL_ID', credentialId);
      }

      StorageUtil.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
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
        this.communicationHandler.closeDialog();
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
        // Make sure credentials are synced before opening dialog
        this.communicationHandler.syncCredentials(true);
        
        // Open the dialog for signing
        console.log('Opening dialog for signing...');
        await this.communicationHandler.openDialog('sign');
        
        // IMPORTANT: We need to wait for the user to sign the transaction
        // The messageHandler.request will wait for the response from the dialog
        // and won't return until the user has signed or cancelled
        const connectPromise = new Promise<SignResponse>((resolve, reject) => {
          // Set up a one-time event listener for the connect event
          const connectHandler = (data: any) => {
            // Remove the event listener once we get a response
            this.communicationHandler.off('connect', connectHandler);
            resolve(data);
          };
          
          // Set up an error handler
          const errorHandler = (error: Error) => {
            // Remove both event listeners
            this.communicationHandler.off('connect', connectHandler);
            this.communicationHandler.off('error', errorHandler);
            reject(error);
          };
          
          // Register both event listeners
          this.communicationHandler.on('connect', connectHandler);
          this.communicationHandler.on('error', errorHandler);
          
          // Set a timeout to reject the promise if no response is received
          setTimeout(() => {
            this.communicationHandler.off('connect', connectHandler);
            this.communicationHandler.off('error', errorHandler);
          }, 30000); // 30 second timeout
        });
        
        // Open the dialog for connection
        await this.communicationHandler.openDialog('connect');
        
        // Wait for the connect event to be emitted
        const signResponse = await connectPromise;
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
        this.communicationHandler.closeDialog();
        dialogClosed = true;
        
        this.emit('transaction:success', signedTransaction);
        return signedTransaction;
      } catch (innerError) {
        console.error('Error during transaction signing:', innerError);
        if (!dialogClosed) {
          console.log('Closing dialog due to error');
          this.communicationHandler.closeDialog();
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
        // Make sure credentials are synced before opening dialog
        this.communicationHandler.syncCredentials(true);
        
        // Open the dialog for signing
        console.log('Opening dialog for signing...');
        const signPromise = new Promise<SignResponse>((resolve, reject) => {
          // Set up a one-time event listener for the sign event
          const signHandler = (data: any) => {
            // Remove the event listener once we get a response
            this.communicationHandler.off('sign', signHandler);
            console.log('Sign event received with data:', data);
            resolve(data);
          };
          
          // Set up an error handler
          const errorHandler = (error: Error) => {
            // Remove both event listeners
            this.communicationHandler.off('sign', signHandler);
            this.communicationHandler.off('error', errorHandler);
            console.error('Error event received:', error);
            reject(error);
          };
          
          // Register both event listeners
          console.log('Registering sign event handler');
          this.communicationHandler.on('sign', signHandler);
          this.communicationHandler.on('error', errorHandler);
          
          // Set a timeout to reject the promise if no response is received
          setTimeout(() => {
            console.log('Sign timeout reached, removing handlers');
            this.communicationHandler.off('sign', signHandler);
            this.communicationHandler.off('error', errorHandler);
            reject(new Error('Signing timed out after 30 seconds'));
          }, 30000); // 30 second timeout
        });
        await this.communicationHandler.openDialog('sign');
        
        // IMPORTANT: We need to wait for the user to sign the transaction
        // The messageHandler.request will wait for the response from the dialog
        // and won't return until the user has signed or cancelled
     
        const signResponse = await signPromise;
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
        this.communicationHandler.closeDialog();
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
          this.communicationHandler.closeDialog();
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
    this.communicationHandler.destroy();
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
    this.communicationHandler.destroy();
  }
  

  /**
   * Set up message handler to forward errors to SDK events
   */
  private setupMessageHandler(): void {
    this.communicationHandler.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }
}

