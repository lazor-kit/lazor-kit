import { EventEmitter } from 'eventemitter3';
import { Connection, TransactionInstruction, Transaction } from '@solana/web3.js';
import { SmartWallet } from './wallet/SmartWallet';
import { Paymaster } from './wallet/Paymaster';
import { SDKError } from '../constants/errors';
import {
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
    this.config = config;
    this.paymaster = new Paymaster(config.paymasterUrl || 'https://paymaster.lazor.io');
    this.communicationHandler = new CommunicationHandler(config);
    this.setupMessageHandler();
  }

  /**
   * Connect wallet and create/retrieve passkey
   * @returns Connected wallet account information
   */
  async connect(): Promise<WalletAccount> {
    try {
      this.emit('connect:start');
      
      if (this.account?.isConnected) {
        return this.account;
      }

      // First try to reconnect with stored credentials
      if (this.hasStoredCredentials()) {
        try {
          return await this.reconnect();
        } catch (error) {
          console.log('Reconnection failed, falling back to new connection:', error);
          // Clear corrupted credentials and continue with new connection
          StorageUtil.clearCredentials();
        }
      }
      
      // Perform new connection
      const response = await this.executeConnectDialog();
      const account = await this.processConnectionResponse(response);
      
      this.emit('connect:success', account);
      return account;
    } catch (error) {
      console.error('Connection error:', error);
      this.emit('connect:error', error as Error);
      throw error;
    }
  }

  /**
   * Create passkey only without creating smart wallet
   * @returns Passkey creation response with publicKey, credentialId, and isCreated flag
   */
  async createPasskeyOnly(): Promise<ConnectResponse> {
    try {
      this.emit('passkey:start');
      
      const response = await this.executeConnectDialog();
      const { publicKey, isCreated, credentialId } = response;
      
      // Store passkey data for later use
      if (publicKey && credentialId) {
        StorageUtil.setItem('PUBLIC_KEY', publicKey);
        StorageUtil.setItem('CREDENTIAL_ID', credentialId);
      }
      console.log(isCreated)
      this.emit('passkey:success', response);
      return response;
    } catch (error) {
      console.error('Passkey creation error:', error);
      this.emit('passkey:error', error as Error);
      throw error;
    }
  }

  /**
   * Create smart wallet using existing passkey data
   * @param passkeyData Passkey data from createPasskeyOnly() method
   * @returns Smart wallet creation result with address and account
   */
  async createSmartWalletOnly(passkeyData: ConnectResponse): Promise<{
    smartWalletAddress: string;
    account: WalletAccount;
  }> {
    try {
      this.emit('smartwallet:start');
      
      const { publicKey, credentialId } = passkeyData;
      
      if (!publicKey || !credentialId) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'Invalid passkey data: publicKey and credentialId are required');
      }
      
      this.initializeSmartWallet();
      
      // Create smart wallet using passkey data
      const smartWalletAddress = await this.smartWallet!.createSmartWallet(publicKey, credentialId);
      
      // Store smart wallet address
      StorageUtil.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
      
      // Create wallet account
      this.account = {
        smartWallet: smartWalletAddress,
        publicKey: publicKey,
        isConnected: true,
        isCreated: true
      };

      const result = {
        smartWalletAddress,
        account: this.account
      };

      this.emit('smartwallet:success', result);
      return result;
    } catch (error) {
      console.error('Smart wallet creation error:', error);
      this.emit('smartwallet:error', error as Error);
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
      
      if (!this.isConnected()) {
        throw new SDKError(ErrorCode.NOT_CONNECTED, 'Wallet is not connected');
      }

      const signResponse = await this.executeSignDialog(instruction);
      const transaction = await this.buildTransactionFromSignature(instruction, signResponse);
      
      this.emit('transaction:success', transaction);
      return transaction;
    } catch (error) {
      console.error('Transaction signing error:', error);
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
      
      if (!this.isConnected()) {
        throw new SDKError(ErrorCode.NOT_CONNECTED, 'Wallet is not connected');
      }

      const signResponse = await this.executeSignDialog(instruction);
      const transaction = await this.buildTransactionFromSignature(instruction, signResponse);
      const txHash = await this.sendTransaction(transaction);
      
      this.emit('transaction:sent', txHash);
      return txHash;
    } catch (error) {
      console.error('Transaction signing and sending error:', error);
      this.emit('transaction:error', error as Error);
      throw error;
    }
  }

  /**
   * Disconnect wallet without destroying communication handler
   * @returns Promise that resolves when disconnection is complete
   */
  async disconnect(): Promise<void> {
    try {
      this.emit('disconnect:start');
      
      // Close any open dialogs
      this.communicationHandler.closeDialog();
      
      // Clear state but preserve communication handler for reconnection
      this.account = null;
      if (this.smartWallet) {
        this.communicationHandler.setSmartWallet(this.smartWallet);
        this.smartWallet = null;
      }
      
      // Clear credentials from local storage
      StorageUtil.clearCredentials();
      
      this.emit('disconnect:success');
    } catch (error) {
      console.error('Disconnect error:', error);
      this.emit('disconnect:error', error as Error);
      throw error;
    }
  }

  /**
   * Check if stored credentials exist for reconnection
   * @returns True if stored credentials exist
   */
  hasStoredCredentials(): boolean {
    const credentialId = StorageUtil.getItem('CREDENTIAL_ID');
    const smartWalletAddress = StorageUtil.getItem('SMART_WALLET_ADDRESS');
    return !!(credentialId && smartWalletAddress);
  }

  /**
   * Reconnect using stored credentials
   * @returns Connected wallet account information
   */
  async reconnect(): Promise<WalletAccount> {
    try {
      this.emit('reconnect:start');
      
      const credentialId = StorageUtil.getItem('CREDENTIAL_ID');
      const publicKey = StorageUtil.getItem('PUBLIC_KEY');
      const smartWalletAddress = StorageUtil.getItem('SMART_WALLET_ADDRESS');
      
      if (!credentialId || !smartWalletAddress) {
        throw new SDKError(ErrorCode.NO_STORED_CREDENTIALS, 'No stored credentials found');
      }
      
      this.initializeSmartWallet();
      
      // Verify stored credentials are still valid
      const verifiedAddress = await this.smartWallet!.getSmartWalletCredential(credentialId);
      if (verifiedAddress !== smartWalletAddress) {
        throw new SDKError(ErrorCode.INVALID_CREDENTIALS, 'Stored credentials are invalid');
      }
      
      // Restore account state
      this.account = {
        smartWallet: smartWalletAddress,
        publicKey: publicKey || '',
        isConnected: true,
        isCreated: true
      };
      
      // Set SmartWallet reference in communication handler
      if (!this.smartWallet) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
      }
      this.communicationHandler.setSmartWallet(this.smartWallet);
      
      this.emit('reconnect:success', this.account);
      return this.account;
    } catch (error) {
      console.error('Reconnection error:', error);
      this.emit('reconnect:error', error as Error);
      throw error;
    }
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
    try {
      this.disconnect();
      this.removeAllListeners();
      this.communicationHandler.destroy();
    } catch (error) {
      console.error('Error during destroy:', error);
    }
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================

  /**
   * Set up message handler to forward errors to SDK events
   */
  private setupMessageHandler(): void {
    this.communicationHandler.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * Initialize smart wallet if not already initialized
   */
  private initializeSmartWallet(): void {
    if (!this.smartWallet) {
      if (!this.config.rpcUrl) {
        throw new SDKError(ErrorCode.INVALID_CONFIG, 'RPC URL is not defined');
      }
      this.smartWallet = new SmartWallet(
        this.paymaster, 
        new Connection(this.config.rpcUrl)
      );
    }
  }

  /**
   * Execute connect dialog operation
   * @returns Connect response from dialog
   */
  private async executeConnectDialog(): Promise<ConnectResponse> {
    return new Promise<ConnectResponse>((resolve, reject) => {
      const cleanup = () => {
        this.communicationHandler.off('connect', connectHandler);
        this.communicationHandler.off('error', errorHandler);
      };

      const connectHandler = (data: ConnectResponse) => {
        cleanup();
        resolve(data);
      };
      
      const errorHandler = (error: Error) => {
        cleanup();
        reject(error);
      };
      
      // Register event listeners
      this.communicationHandler.on('connect', connectHandler);
      this.communicationHandler.on('error', errorHandler);
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new SDKError(ErrorCode.TIMEOUT, 'Connection timed out after 30 seconds'));
      }, 30000);
      
      // Clear timeout when resolved/rejected
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };
      reject = (reason) => {
        clearTimeout(timeoutId);
        originalReject(reason);
      };
      
      // Open dialog
      this.communicationHandler.openDialog('connect').catch(reject);
    });
  }

  /**
   * Execute sign dialog operation
   * @param instruction Transaction instruction to sign
   * @returns Sign response from dialog
   */
  private async executeSignDialog(instruction: TransactionInstruction): Promise<SignResponse> {
    return new Promise<SignResponse>((resolve, reject) => {
      const cleanup = () => {
        this.communicationHandler.off('sign', signHandler);
        this.communicationHandler.off('error', errorHandler);
      };

      const signHandler = (data: SignResponse) => {
        cleanup();
        resolve(data);
      };
      
      const errorHandler = (error: Error) => {
        cleanup();
        reject(error);
      };
      console.log(instruction)
      // Register event listeners
      this.communicationHandler.on('sign', signHandler);
      this.communicationHandler.on('error', errorHandler);
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new SDKError(ErrorCode.TIMEOUT, 'Signing timed out after 30 seconds'));
      }, 30000);
      
      // Clear timeout when resolved/rejected
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };
      reject = (reason) => {
        clearTimeout(timeoutId);
        originalReject(reason);
      };
      
      // Open dialog for signing
      this.communicationHandler.openDialog('sign').catch(reject);
    });
  }

  /**
   * Process connection response and create wallet account
   * @param response Connect response from dialog
   * @returns Wallet account
   */
  private async processConnectionResponse(response: ConnectResponse): Promise<WalletAccount> {
    if (!response) {
      throw new SDKError(ErrorCode.CONNECTION_FAILED, 'No response received from dialog');
    }

    const { publicKey, isCreated, credentialId } = response;
    
    this.initializeSmartWallet();
    
    let smartWalletAddress: string;
    
    if (!publicKey) {
      // Existing credential case
      smartWalletAddress = await this.smartWallet!.getSmartWalletCredential(credentialId);
      StorageUtil.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
    } else {
      // New credential case
      smartWalletAddress = await this.smartWallet!.createSmartWallet(publicKey, credentialId);
      StorageUtil.setItem('PUBLIC_KEY', publicKey);
      StorageUtil.setItem('CREDENTIAL_ID', credentialId);
      StorageUtil.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
    }

    this.account = {
      smartWallet: smartWalletAddress,
      publicKey: publicKey || '',
      isConnected: true,
      isCreated
    };

    // Set SmartWallet reference in communication handler
    if (!this.smartWallet) {
      throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
    }
    this.communicationHandler.setSmartWallet(this.smartWallet);

    return this.account;
  }

  /**
   * Build transaction from signature response
   * @param instruction Original transaction instruction
   * @param signResponse Sign response from dialog
   * @returns Built transaction
   */
  private async buildTransactionFromSignature(
    instruction: TransactionInstruction, 
    signResponse: SignResponse
  ): Promise<Transaction> {
    if (!signResponse) {
      throw new SDKError(ErrorCode.SIGN_FAILED, 'No response received from dialog');
    }
    
    if (!this.smartWallet) {
      throw new SDKError(ErrorCode.INVALID_CONFIG, 'Smart wallet is not initialized');
    }
    
    const { transaction } = await this.smartWallet.buildTransaction(instruction, signResponse);
    return transaction;
  }

  /**
   * Send transaction using paymaster
   * @param transaction Transaction to send
   * @returns Transaction hash
   */
  private async sendTransaction(transaction: Transaction): Promise<string> {
    const signedTransaction = await this.paymaster.sign(transaction);
    signedTransaction.feePayer = new PublicKey(await this.paymaster.getPayer());
    
    const txHash = await this.paymaster.signAndSend(signedTransaction);
    return txHash;
  }
}
