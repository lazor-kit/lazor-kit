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

      const { publicKey, isCreated } = response;

      if (!this.config.rpcUrl) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'RPC URL is not defined');
      }

      this.smartWallet = new SmartWallet(
        publicKey, 
        this.paymaster, 
        new Connection(this.config.rpcUrl)
      );
      
      const smartWalletAddress = await this.smartWallet.createSmartWallet(publicKey);
      
      this.account = {
        publicKey,
        smartWallet: smartWalletAddress,
        isConnected: true,
        isCreated
      };
      
      // Store credentials in local storage
      StorageUtil.saveCredentials({
        credentialId: response.credentialId,
        publickey: publicKey, // Match the case used in reference implementation
        smartWalletAddress,
        timestamp: Date.now()
      });
      
      // Dialog will be closed by CommunicationHandler
      this.emit('connect:success', this.account);
      this.dialogManager.close();
      return this.account;
      
    } catch (error) {
      this.emit('connect:error', error as Error);
      throw error;
    }
  }

  /**
   * Internal method to handle transaction signing
   * @param instruction The transaction instruction to sign
   * @returns SignResponse from the dialog
   */
  private async handleTransactionSign(instruction: TransactionInstruction): Promise<SignResponse> {
    if (!this.isConnected()) {
      throw new SDKError(ErrorCode.NOT_CONNECTED, 'Wallet is not connected');
    }

    const serializedInstruction = Buffer.from(JSON.stringify(instruction)).toString('base64');
    const message = {
      instructions: serializedInstruction,
      timestamp: Date.now(),
      nonce: this.security.generateNonce()
    };
    
    await this.dialogManager.sign();
    const signResponse = await this.messageHandler.request<SignResponse>(this.dialogManager, {
      method: 'passkey:sign',
      params: {
        message: Buffer.from(JSON.stringify(message)).toString('base64'),
        origin: window.location.origin
      }
    });

    if (!signResponse) {
      throw new SDKError(ErrorCode.SIGN_FAILED, 'No response received from dialog');
    }

    return signResponse;
  }

  /**
   * Sign transaction with passkey
   * @param instruction The transaction instruction to sign
   * @returns Signed transaction
   */
  async signTransaction(instruction: TransactionInstruction): Promise<Transaction> {
    try {
      this.emit('transaction:start');

      const signResponse = await this.handleTransactionSign(instruction);
      
      if (!this.smartWallet) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
      }
      
      const { transaction } = await this.smartWallet.buildTransaction(
        instruction,
        signResponse
      );
      
      const signedTransaction = await this.paymaster.sign(transaction);
      signedTransaction.feePayer = new PublicKey(await this.paymaster.getPayer());
      
      // Only close dialog after successful signing
      this.dialogManager.close();
      
      this.emit('transaction:success', signedTransaction);
      return signedTransaction;
    
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
      
      const signResponse = await this.handleTransactionSign(instruction);
      
      if (!this.smartWallet) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
      }
      
      const { transaction } = await this.smartWallet.buildTransaction(
        instruction,
        signResponse
      );
      
      this.dialogManager.close();
    
      const signedTransaction = await this.paymaster.sign(transaction);
      signedTransaction.feePayer = new PublicKey(await this.paymaster.getPayer());
      this.emit('transaction:success', signedTransaction);

      // Send the transaction
      const txHash = await this.paymaster.signAndSend(signedTransaction);
      this.emit('transaction:sent', txHash);
      return txHash;
    
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

