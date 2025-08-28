/**
 * SmartWallet - High-level interface for smart wallet operations
 * Uses contract-integration layer for blockchain interactions
 */

import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  Connection 
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { Paymaster } from './Paymaster';
import { StorageManager } from '../storage';
import { 
  LazorkitClient,
  SmartWalletAction,
  SmartWalletActionArgs,
  PasskeySignature
} from './contract-integration';

// Buffer polyfill setup
(globalThis as any).Buffer = Buffer;

// Add subarray method to Buffer prototype if it doesn't exist
if (!Buffer.prototype.subarray) {
  Buffer.prototype.subarray = function subarray(
    begin?: number,
    end?: number
  ) {
    const result = Uint8Array.prototype.subarray.apply(this, [begin, end]);
    Object.setPrototypeOf(result, Buffer.prototype);
    return result;
  };
}

export interface SignResponse {
  readonly msg?: string;
  readonly normalized: string;
  readonly clientDataJSONReturn: string;
  readonly authenticatorDataReturn: string;
}

/**
 * SmartWallet class providing high-level smart wallet operations
 * Web-specific implementation for smart wallet operations
 */
export class SmartWallet {
  private paymaster: Paymaster;
  private lazorkitClient: LazorkitClient;


  constructor(paymaster: Paymaster, connection: Connection) {
    this.paymaster = paymaster;
    this.lazorkitClient = new LazorkitClient(connection);
  }

  /**
   * Create a new smart wallet using contract integration layer
   */
  async createSmartWallet(
    ownerPublicKey: string,
    credentialId: string
  ): Promise<string> {
    const passkeyPubkey = Array.from(Buffer.from(ownerPublicKey, 'base64')) as number[];
    
    // Check if smart wallet already exists
    const { smartWallet } = await this.lazorkitClient.getSmartWalletByPasskey(passkeyPubkey);
    if (smartWallet) {
      const address = smartWallet.toBase58();
      await StorageManager.setItem('SMART_WALLET_ADDRESS', address);
      return address;
    }

    // Create new smart wallet using contract integration
    const payer = await this.paymaster.getPayer();
    
    const { transaction, smartWallet: newSmartWallet } = await this.lazorkitClient.createSmartWalletTransaction({
      payer,
      passkeyPubkey,
      credentialIdBase64: credentialId,
      isPayForUser: true,
    });

    // Sign and send transaction via paymaster
    await this.paymaster.signAndSend(transaction);
    
    const smartWalletAddress = newSmartWallet.toBase58();
    
    // Store for future use
    await StorageManager.setItem('SMART_WALLET_ADDRESS', smartWalletAddress);
    
    return smartWalletAddress;
  }

  /**
   * Build transaction using contract integration layer
   */
  async buildTransaction(
    instruction: TransactionInstruction,
    signResponse: SignResponse,
  ): Promise<{ transaction: Transaction }> {
    // Get stored public key and smart wallet address
    const storedPublicKey = await StorageManager.getItem('PUBLIC_KEY');
    const smartWalletAddress = await StorageManager.getItem('SMART_WALLET_ADDRESS');
    
    if (!storedPublicKey) {
      throw new Error('Public key not found. Please reconnect your wallet.');
    }
    
    if (!smartWalletAddress) {
      throw new Error('Smart wallet address not found. Please reconnect your wallet.');
    }

    // Get smart wallet and wallet device info
    const passkeyPubkey = Array.from(Buffer.from(storedPublicKey, 'base64')) as number[];
    const { smartWallet, walletDevice } = await this.lazorkitClient.getSmartWalletByPasskey(passkeyPubkey);
    
    if (!smartWallet || !walletDevice) {
      throw new Error('Smart wallet not found for this passkey');
    }

    // Build passkey signature from sign response
    const passkeySignature: PasskeySignature = {
      passkeyPubkey,
      signature64: signResponse.normalized,
      clientDataJsonRaw64: signResponse.clientDataJSONReturn,
      authenticatorDataRaw64: signResponse.authenticatorDataReturn,
    };

    // Get payer from paymaster
    const payer = await this.paymaster.getPayer();

    // Execute transaction using contract integration
    const versionedTxn = await this.lazorkitClient.executeTransactionWithAuth({
      payer,
      smartWallet,
      passkeySignature,
      policyInstruction: null, // Use default policy
      cpiInstruction: instruction,
    });

    // Convert VersionedTransaction to legacy Transaction for compatibility
    const transaction = Transaction.from(versionedTxn.serialize());
    
    return { transaction };
  }

  /**
   * Get message for signing using contract integration
   * @param action - Optional smart wallet action to build message for
   * @returns Base64url encoded message for signing
   */
  async getMessage(action?: SmartWalletActionArgs): Promise<string> {
    const smartWalletAddress = await StorageManager.getItem('SMART_WALLET_ADDRESS');
    const storedPublicKey = await StorageManager.getItem('PUBLIC_KEY');
    
    if (!smartWalletAddress || !storedPublicKey) {
      throw new Error('Smart wallet or public key not found');
    }

    const smartWallet = new PublicKey(smartWalletAddress);
    const passkeyPubkey = Array.from(Buffer.from(storedPublicKey, 'base64')) as number[];
    const payer = await this.paymaster.getPayer();

    // Use provided action or default execute transaction action
    const messageAction = action || {
      type: SmartWalletAction.ExecuteTransaction,
      args: {
        policyInstruction: null, // Use default policy
        cpiInstruction: {
          programId: new PublicKey('11111111111111111111111111111111'), // SystemProgram placeholder
          keys: [],
          data: Buffer.alloc(0),
        },
      },
    };

    // Build authorization message using contract integration
    const message = await this.lazorkitClient.buildAuthorizationMessage({
      action: messageAction,
      payer,
      smartWallet,
      passkeyPubkey,
    });

    // Return base64url encoded message
    return message.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Build message for specific smart wallet action
   * @param params - Parameters for building the message
   * @returns Promise that resolves to message buffer
   */
  async buildMessage(params: {
    action: SmartWalletActionArgs;
    smartWallet: PublicKey;
    passkeyPubkey: number[];
    payer: PublicKey;
  }): Promise<Buffer> {
    return await this.lazorkitClient.buildAuthorizationMessage(params);
  }

  /**
   * Get smart wallet address by credential ID
   * Note: This method needs proper implementation in contract integration layer
   */
  async getSmartWalletCredential(_credentialId: string): Promise<string> {
    // This would need to be implemented in the contract integration layer
    // For now, we'll throw an error as this needs proper implementation
    const { smartWallet } = await this.lazorkitClient.getSmartWalletByCredentialId(_credentialId);
    if (!smartWallet) {
      throw new Error('Smart wallet not found for this credential ID');
    }
    return smartWallet.toBase58();
    throw new Error('getSmartWalletCredential not yet implemented in contract integration layer');
  }

  /**
   * Build transaction for specific smart wallet action
   */
  async buildSmartWalletTransaction(
    action: SmartWalletActionArgs,
    passkeySignature: PasskeySignature
  ): Promise<Transaction> {
    const smartWalletAddress = await StorageManager.getItem('SMART_WALLET_ADDRESS');
    if (!smartWalletAddress) {
      throw new Error('Smart wallet address not found');
    }

    const smartWallet = new PublicKey(smartWalletAddress);
    const payer = await this.paymaster.getPayer();

    let versionedTxn: any;

    switch (action.type) {
      case SmartWalletAction.ExecuteTransaction: {
        const args = action.args as any; // Type assertion for complex union types
        versionedTxn = await this.lazorkitClient.executeTransactionWithAuth({
          payer,
          smartWallet,
          passkeySignature,
          policyInstruction: args.policyInstruction || null,
          cpiInstruction: args.cpiInstruction,
        });
        break;
      }

      case SmartWalletAction.InvokePolicy: {
        const args = action.args as any; // Type assertion for complex union types
        versionedTxn = await this.lazorkitClient.invokePolicyWithAuth({
          payer,
          smartWallet,
          passkeySignature,
          policyInstruction: args.policyInstruction,
          newWalletDevice: args.newWalletDevice || null,
        });
        break;
      }

      case SmartWalletAction.UpdatePolicy: {
        const args = action.args as any; // Type assertion for complex union types
        versionedTxn = await this.lazorkitClient.updatePolicyWithAuth({
          payer,
          smartWallet,
          passkeySignature,
          destroyPolicyInstruction: args.destroyPolicyIns,
          initPolicyInstruction: args.initPolicyIns,
          newWalletDevice: args.newWalletDevice || null,
        });
        break;
      }

      default:
        throw new Error(`Unsupported smart wallet action: ${action.type}`);
    }

    // Convert VersionedTransaction to legacy Transaction
    return Transaction.from(versionedTxn.serialize());
  }

  /**
   * Get LazorkitClient instance for advanced usage
   */
  getLazorkitClient(): LazorkitClient {
    return this.lazorkitClient;
  }

  /**
   * Get paymaster instance
   */
  getPaymaster(): Paymaster {
    return this.paymaster;
  }
}