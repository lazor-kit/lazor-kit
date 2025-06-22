/**
 * SmartWallet class for managing Solana smart wallet operations
 */
import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  Connection 
} from '@solana/web3.js';
import { Paymaster } from './Paymaster';
import { SignResponse } from '../../types';
import { LazorKitProgram } from './anchor/interface/lazorkit';
import { DefaultRuleProgram } from './anchor/interface/default_rule';
import { Buffer } from 'buffer';
import { Logger } from '../../utils/logger';

export class SmartWallet {
  private paymaster: Paymaster;
  private lastestSmartWallet: PublicKey | null = null;
  private lazorkitProgram: LazorKitProgram;
  private logger = new Logger('SmartWallet');

  /**
   * Create a new SmartWallet instance
   * @param ownerPublicKey The owner's public key
   * @param paymaster The paymaster instance
   * @param connection The Solana connection
   */
  constructor(paymaster: Paymaster, connection: Connection) {
    this.paymaster = paymaster;
    this.lazorkitProgram = new LazorKitProgram(connection);
  }

  /**
   * Get the smart wallet address
   * @returns The smart wallet address as a base58 encoded string
   */
  async getAddress(): Promise<string> {
    const lastestSmartWallet = await this.lazorkitProgram.getLastestSmartWallet();
    this.lastestSmartWallet = lastestSmartWallet;
    return lastestSmartWallet.toBase58();
  }

  /**
   * Build a transaction with the provided instruction and signature data
   * @param instruction The transaction instruction to execute
   * @param signResponse The signature data from the authentication process
   * @returns The built transaction
   */
  async buildTransaction(
    instruction: TransactionInstruction,
    signResponse: SignResponse,
  ): Promise<{ transaction: Transaction }> {
    this.logger.debug('Building transaction with smart wallet');
    
    // Get necessary components for transactions
    const payer = await this.paymaster.getPayer();
    const blockhash = await this.paymaster.getBlockhash();
    
    // Get public key from response
    const { msg, normalized } = signResponse;
    this.logger.debug('Signature response received', { msgLength: msg?.length, normalizedLength: normalized?.length });
    
    // Try to get public key from local storage if not in the response
    const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
    if (!storedPublicKey) {
      this.logger.error('Public key not found in local storage');
      throw new Error('Public key not found. Please reconnect your wallet.');
    }
    this.logger.debug('Using public key from storage', { keyLength: storedPublicKey.length });
    
    // Ensure we have the latest smart wallet address
    if (!this.lastestSmartWallet) {
      this.logger.debug('Smart wallet address not found, fetching...');
      await this.getAddress();
    }
    this.logger.debug('Using smart wallet address', { address: this.lastestSmartWallet?.toBase58() });
    console.log(storedPublicKey);
    const smartWalletAuthenticator  = await this.lazorkitProgram.getSmartWalletByPasskey(Array.from(Buffer.from(storedPublicKey, 'base64')));
    if (!smartWalletAuthenticator.smartWallet) {
      this.logger.error('Smart wallet authenticator not found');
      throw new Error('Smart wallet authenticator not found');
    }
    
    // Create execution transaction with authenticated instruction
    const executeTxn = await this.lazorkitProgram.executeInstructionTxn(
      Array.from(Buffer.from(storedPublicKey, 'base64')),
      Buffer.from(signResponse.clientDataJSONReturn, 'base64'),
      Buffer.from(signResponse.authenticatorDataReturn, 'base64'),
      Buffer.from(signResponse.normalized, 'base64'),
      payer,
      new PublicKey(smartWalletAuthenticator.smartWallet),
      null,
      instruction,
    );

    executeTxn.feePayer = payer;
    executeTxn.recentBlockhash = blockhash;
    
    return { transaction: executeTxn };
  }

  /**
   * Create a new smart wallet for the owner
   * @param ownerPublicKey The owner's public key as a base64 encoded string
   * @returns The smart wallet address as a base58 encoded string
   */
  async createSmartWallet(
    ownerPublicKey: string,
    credentialId: string
  ): Promise<string> {
    const { smartWallet } = await this.lazorkitProgram.getSmartWalletByPasskey(Array.from(Buffer.from(ownerPublicKey, 'base64')));
    if (smartWallet) {
      this.logger.debug('Smart wallet already exists', { address: smartWallet.toBase58() });
      return smartWallet.toBase58();
    }
    else {
      this.logger.debug('Smart wallet does not exist, creating...');
      // Get wallet address
      const smartWallet = await this.getAddress();
      this.logger.debug('Got smart wallet address', { address: smartWallet });
      
      // Store the smart wallet address in local storage for immediate access
      localStorage.setItem('SMART_WALLET_ADDRESS', smartWallet);
      
      // Get necessary components for transactions
      const payer = await this.paymaster.getPayer();
      const pubkey = Array.from(Buffer.from(ownerPublicKey, 'base64')) as number[];
      this.logger.debug('Creating smart wallet transaction');
      const createSmartWalletTxn = await this.lazorkitProgram.createSmartWalletTxn(
        pubkey,
        null,
        payer, 
        credentialId
      );
      
      await this.paymaster.signAndSend(createSmartWalletTxn);
      this.logger.debug('Smart wallet successfully created', { address: smartWallet });
      return smartWallet;
    }
  }
  async getMessage(): Promise<string> {
    const smartWallet = localStorage.getItem('SMART_WALLET_ADDRESS');
    if (!smartWallet) {
      this.logger.error('Smart wallet address not found in local storage');
      throw new Error('Smart wallet address not found');
    }
    return (await this.lazorkitProgram.getMessage(smartWallet)).toString('base64').replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');;
  }
}