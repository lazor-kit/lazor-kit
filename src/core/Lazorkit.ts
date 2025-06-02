import { EventEmitter } from 'eventemitter3';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
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
  TransactionRequest,
  TransactionResponse,
  ErrorCode
} from '../types';

export class Lazorkit extends EventEmitter<SDKEvents> {
  private config: LazorSDKConfig;
  private dialogManager: DialogManager;
  private messageHandler: MessageHandler;
  private security: Security;
  private paymaster: Paymaster;
  private smartWallet: SmartWallet | null = null;
  private account: WalletAccount | null = null;
  private isInitialized = false;

  constructor(config: LazorSDKConfig) {
    super();
    
    // Validate configuration
    validateConfig(config);
    this.config = config;
    
    // Initialize components
    this.security = new Security();
    this.paymaster = new Paymaster(config.paymasterUrl || 'https://paymaster.lazor.io');
    this.dialogManager = new DialogManager(config);
    this.messageHandler = new MessageHandler();
    
    // Setup message handler
    this.setupMessageHandler();
    
    // Mark as initialized
    this.isInitialized = true;
  }

  /**
   * Connect wallet and create/retrieve passkey
   */
  async connect(options?: SDKOptions): Promise<WalletAccount> {
    try {
      this.emit('connect:start');
      
      // Check if already connected
      if (this.account?.isConnected) {
        return this.account;
      }
      
      // Generate security challenge
      const challenge = this.security.generateChallenge();
      console.log(challenge)
      // Open dialog
      const dialog = this.dialogManager.getOrCreate('connect');
      dialog.open();
    
      // Send connect request
      const response = await this.messageHandler.request<ConnectResponse>(dialog, {
        method: 'passkey:connect',
        params: {
          challenge,
          origin: window.location.origin,
          skipWarning: options?.skipWarning,
          ...options
        }
      });
    
      // Validate response
      if (!response.data) {
        throw new SDKError(ErrorCode.CONNECTION_FAILED, 'No data received from dialog');
      }

      // Verify challenge signature
      const isValid = await this.security.verifyChallenge(
        challenge,
        response.data.signature,
        response.data.publicKey
      );

      if (!isValid) {
        throw new SDKError(ErrorCode.INVALID_SIGNATURE, 'Invalid challenge signature');
      }

      // Create smart wallet
      const publicKey = new PublicKey(response.data.publicKey);
      this.smartWallet = new SmartWallet(publicKey, this.paymaster);
      
      // Initialize account
      this.account = {
        publicKey: response.data.publicKey,
        smartWallet: await this.smartWallet.getAddress(),
        isConnected: true,
        isCreated: response.data.isCreated
      };

      // Close dialog
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
   */
  async signTransaction(
    request: TransactionRequest,
    options?: { sendTransaction?: boolean }
  ): Promise<TransactionResponse> {
    if (!this.account || !this.smartWallet) {
      throw new SDKError(ErrorCode.NOT_CONNECTED, 'Wallet not connected');
    }

    try {
      this.emit('transaction:start');

      // Serialize instructions
      const serializedInstructions = request.instructions.map(ix => ({
        programId: ix.programId.toBase58(),
        keys: ix.keys.map(key => ({
          pubkey: key.pubkey.toBase58(),
          isSigner: key.isSigner,
          isWritable: key.isWritable
        })),
        data: ix.data.toString('base64')
      }));

      // Create message for signing
      const message = {
        instructions: serializedInstructions,
        timestamp: Date.now(),
        nonce: this.security.generateNonce()
      };

      // Open dialog
      const dialog = this.dialogManager.getOrCreate('sign');
      dialog.open();

      // Request signature
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

      // Build transaction
      const { transaction, message: txMessage } = await this.smartWallet.buildTransaction(
        request.instructions,
        this.account.publicKey,
        signResponse.data
      );

      // Close dialog
      dialog.close();

      // Sign and optionally send
      if (options?.sendTransaction) {
        const txHash = await this.paymaster.signAndSend(transaction);
        
        this.emit('transaction:success', { txHash });
        return { 
          success: true, 
          txHash,
          transaction: transaction.serialize().toString('base64')
        };
      } else {
        const signedTx = await this.paymaster.sign(transaction);
        
        return { 
          success: true, 
          transaction: signedTx.serialize().toString('base64')
        };
      }

    } catch (error) {
      this.emit('transaction:error', error as Error);
      throw error;
    }
  }

  /**
   * Sign and send transaction
   */
  async signAndSendTransaction(request: TransactionRequest): Promise<TransactionResponse> {
    return this.signTransaction(request, { sendTransaction: true });
  }

  /**
   * Disconnect wallet
   */
  async disconnect(): Promise<void> {
    this.dialogManager.destroyAll();
    this.account = null;
    this.smartWallet = null;
    this.emit('disconnect');
  }

  /**
   * Get current account
   */
  getAccount(): WalletAccount | null {
    return this.account;
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return !!this.account?.isConnected;
  }

  /**
   * Get paymaster instance
   */
  getPaymaster(): Paymaster {
    return this.paymaster;
  }

  /**
   * Destroy SDK instance
   */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
    this.messageHandler.destroy();
    this.isInitialized = false;
  }

  private setupMessageHandler(): void {
    this.messageHandler.on('error', (error) => {
      this.emit('error', error);
    });
  }
}