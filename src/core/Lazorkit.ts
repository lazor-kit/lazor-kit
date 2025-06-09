import { EventEmitter } from 'eventemitter3';
import { Connection, TransactionInstruction } from '@solana/web3.js';
import { DialogManager } from './dialog/DialogManager';
import { SmartWallet } from './wallet/SmartWallet';
import { Paymaster } from './wallet/Paymaster';
import { Security } from './security/Security';
import { MessageHandler } from './bridge/MessageHandler';
import { validateConfig } from '../utils/validation';
import { SDKError } from '../constants/errors';
import {
  LazorSDKConfig,
  SDKOptions,
  SDKEvents,
  WalletAccount,
  ConnectResponse,
  SignResponse,
  TransactionResponse,
  ErrorCode
} from '../types';

/**
 * Lazorkit is the main entry point for the Lazor Kit SDK
 * It manages wallet connection, transaction signing, and communication with the Lazor portal
 */
export class Lazorkit extends EventEmitter<SDKEvents> {
  private config: LazorSDKConfig;
  private dialogManager: DialogManager;
  private messageHandler: MessageHandler;
  private security: Security;
  private paymaster: Paymaster;
  private smartWallet: SmartWallet | null = null;
  private account: WalletAccount | null = null;
  private isInitialized = false;

  /**
   * Create a new Lazorkit instance
   * @param config SDK configuration options
   */
  constructor(config: LazorSDKConfig) {
    super();
    
    validateConfig(config);
    this.config = config;
    
    this.security = new Security();
    this.paymaster = new Paymaster(config.paymasterUrl || 'https://paymaster.lazor.io');
    this.dialogManager = new DialogManager(config);
    this.messageHandler = new MessageHandler();
    
    this.setupMessageHandler();
    this.isInitialized = true;
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
      const dialog = this.dialogManager.getOrCreate('connect');
      dialog.open();
    
      const response = await this.messageHandler.request<ConnectResponse>(dialog, {
        method: 'passkey:connect',
        params: {
          challenge,
          origin: window.location.origin,
          skipWarning: options?.skipWarning,
          ...options
        }
      });
    
      if (!response.data) {
        throw new SDKError(ErrorCode.CONNECTION_FAILED, 'No data received from dialog');
      }

      const isValid = await this.security.verifyChallenge(
        challenge,
        response.data.signature,
        response.data.publicKey
      );

      if (!isValid) {
        throw new SDKError(ErrorCode.INVALID_SIGNATURE, 'Invalid challenge signature');
      }

      if (!this.config.rpcUrl) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'RPC URL is not defined');
      }

      this.smartWallet = new SmartWallet(
        response.data.publicKey, 
        this.paymaster, 
        new Connection(this.config.rpcUrl)
      );
      
      this.account = {
        publicKey: response.data.publicKey,
        smartWallet: await this.smartWallet.createSmartWallet(response.data.publicKey),
        isConnected: true,
        isCreated: response.data.isCreated
      };
      
      dialog.close();
      this.emit('connect:success', this.account);
      
      return this.account;
    } catch (error) {
      this.emit('connect:error', error as Error);
      throw error;
    }
  }

  /**
   * Sign transaction with passkey
   * @param instruction The transaction instruction to sign
   * @param sendTransaction Whether to send the transaction after signing
   * @returns Transaction response including transaction data and hash if sent
   */
  async signTransaction(
    instruction: TransactionInstruction,
    options?: { sendTransaction?: boolean }
  ): Promise<TransactionResponse> {
    try {
      this.emit('transaction:start');
      
      if (!this.isConnected()) {
        throw new SDKError(ErrorCode.NOT_CONNECTED, 'Wallet not connected');
      }
      
      const serializedInstruction = Buffer.from(JSON.stringify(instruction)).toString('base64');
      const message = {
        instructions: serializedInstruction,
        timestamp: Date.now(),
        nonce: this.security.generateNonce()
      };

      const dialog = this.dialogManager.getOrCreate('sign');
      dialog.open();

      const signResponse = await this.messageHandler.request<SignResponse>(dialog, {
        method: 'passkey:sign',
        params: {
          message: Buffer.from(JSON.stringify(message)).toString('base64'),
          origin: window.location.origin
        }
      });
      
      if (!signResponse.data) {
        throw new SDKError(ErrorCode.SIGN_FAILED, 'Signing failed');
      }
      
      if (!this.smartWallet) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
      }
      
      const { transaction } = await this.smartWallet.buildTransaction(
        instruction,
        signResponse.data
      );
      
      dialog.close();
      // Stick to standard events to avoid type issues

      if (options?.sendTransaction) {
        const txHash = await this.paymaster.signAndSend(transaction);
        const response = {
          success: true,
          txHash,
          transaction: transaction.serialize().toString('base64')
        };
        
        this.emit('transaction:success', response);
        return response;
      } else {
        const response = {
          success: true,
          transaction: transaction.serialize().toString('base64')
        };
        
        // Stick to standard events to avoid type issues
        return response;
      }
    } catch (error) {
      this.emit('transaction:error', error as Error);
      throw error;
    }
  }

  /**
   * Sign and send transaction
   * @param instruction The transaction instruction to sign and send
   * @returns Transaction response including transaction data and hash
   */
  async signAndSendTransaction(instruction: TransactionInstruction): Promise<TransactionResponse> {
    return this.signTransaction(instruction, true);
  }

  /**
   * Disconnect wallet
   * @returns Promise that resolves when disconnection is complete
   */
  async disconnect(): Promise<void> {
    this.dialogManager.destroyAll();
    this.account = null;
    this.smartWallet = null;
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
    this.isInitialized = false;
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