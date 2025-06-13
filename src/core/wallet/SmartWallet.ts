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
import { LazorKitProgram } from './sdk/lazor-kit';
import { DefaultRuleProgram } from './sdk/default-rule-program';
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Buffer } from 'buffer';
import { Logger } from '../../utils/logger';

export class SmartWallet {
  private paymaster: Paymaster;
  private lastestSmartWallet: PublicKey | null = null;
  private defaultRuleProgram: DefaultRuleProgram;
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
    this.defaultRuleProgram = new DefaultRuleProgram(connection);
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
    signResponse: SignResponse
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
    
    // Create authenticator for the smart wallet
    const [smartWalletAuthenticator] = this.lazorkitProgram.smartWalletAuthenticator(
      Array.from(Buffer.from(storedPublicKey, 'base64')) as number[],
      this.lastestSmartWallet!
    );
    
    // Get rule check instruction
    const checkRule = await this.defaultRuleProgram.checkRuleIns(
      this.lastestSmartWallet!,
      smartWalletAuthenticator
    );
    
    this.logger.debug('Check rule instruction created');
    console.log(storedPublicKey);
    console.log(msg);
    console.log(normalized);
    
    // Create execution transaction with authenticated instruction
    const executeTxn = await this.lazorkitProgram.executeInstructionTxn(
      Array.from(Buffer.from(storedPublicKey, 'base64')),
      Buffer.from(msg, 'base64'),
      Buffer.from(normalized, 'base64'),
      checkRule,
      instruction,
      payer,
      this.lastestSmartWallet!
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
  async createSmartWallet(ownerPublicKey: string): Promise<string> {
    if (!ownerPublicKey) {
      this.logger.error('Invalid owner public key provided to createSmartWallet');
      // Try to get public key from localStorage as fallback
      const storedPublicKey = localStorage.getItem('PUBLIC_KEY');
      if (!storedPublicKey) {
        throw new Error('Public key not found. Please reconnect your wallet.');
      }
      ownerPublicKey = storedPublicKey;
      this.logger.debug('Using public key from localStorage as fallback');
    }
    
    this.logger.debug('Creating smart wallet for owner', { keyLength: ownerPublicKey.length });
    
    // Get wallet address
    const smartWallet = await this.getAddress();
    this.logger.debug('Got smart wallet address', { address: smartWallet });
    
    // Store the smart wallet address in local storage for immediate access
    localStorage.setItem('SMART_WALLET_ADDRESS', smartWallet);
    
    // Get necessary components for transactions
    const payer = await this.paymaster.getPayer();
    const blockhash = await this.paymaster.getBlockhash();
    const pubkey = Array.from(Buffer.from(ownerPublicKey, 'base64')) as number[];
    
    // Create authenticator for the smart wallet
    const [smartWalletAuthenticator] = this.lazorkitProgram.smartWalletAuthenticator(
      pubkey, 
      new PublicKey(smartWallet)
    );
    this.logger.debug('Created smart wallet authenticator');
   
    // Step 1: Fund the smart wallet with a small amount of SOL
    this.logger.debug('Funding smart wallet with SOL');
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new PublicKey(smartWallet),
      lamports: LAMPORTS_PER_SOL / 100, // 0.01 SOL
    });
    
    const depositSolTxn = new anchor.web3.Transaction().add(depositSolIns);
    depositSolTxn.recentBlockhash = blockhash;
    depositSolTxn.feePayer = payer;
    await this.paymaster.signAndSend(depositSolTxn);
    this.logger.debug('Successfully funded smart wallet');
    
    // Step 2: Initialize rule for the smart wallet
    this.logger.debug('Initializing rule for smart wallet');
    const initRuleIns = await this.defaultRuleProgram.initRuleIns(
      payer,
      new PublicKey(smartWallet),
      smartWalletAuthenticator
    );
    
    // Step 3: Create the smart wallet using the rule instruction
    this.logger.debug('Creating smart wallet transaction');
    const createSmartWalletTxn = await this.lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer
    );
    
    await this.paymaster.signAndSend(createSmartWalletTxn);
    this.logger.debug('Smart wallet successfully created', { address: smartWallet });
    
    // Dispatch an event to notify that the smart wallet is ready
    const event = new CustomEvent('lazorkit:smart-wallet-ready', {
      detail: { address: smartWallet },
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(event);
    
    return smartWallet;
  }

}