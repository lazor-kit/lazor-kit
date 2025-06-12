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

export class SmartWallet {
  private ownerPublicKey: string;
  private paymaster: Paymaster;
  private lastestSmartWallet: PublicKey | null = null;
  private defaultRuleProgram: DefaultRuleProgram;
  private lazorkitProgram: LazorKitProgram;

  /**
   * Create a new SmartWallet instance
   * @param ownerPublicKey The owner's public key
   * @param paymaster The paymaster instance
   * @param connection The Solana connection
   */
  constructor(ownerPublicKey: string, paymaster: Paymaster, connection: Connection) {
    this.ownerPublicKey = ownerPublicKey;
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
   * @param signData The signature data from the authentication process
   * @returns The built transaction
   */
  async buildTransaction(
    instruction: TransactionInstruction,
    signData: SignResponse
  ): Promise<{ transaction: Transaction }> {
    const payer = await this.paymaster.getPayer();
    const blockhash = await this.paymaster.getBlockhash();
    const [smartWalletAuthenticator] = this.lazorkitProgram.smartWalletAuthenticator(
      Array.from(Buffer.from(this.ownerPublicKey, 'base64')),
      this.lastestSmartWallet!
    );
    
    // Get rule check instruction
    const checkRule = await this.defaultRuleProgram.checkRuleIns(
      this.lastestSmartWallet!,
      smartWalletAuthenticator
    );
    
    // Create execution transaction with authenticated instruction
    const executeTxn = await this.lazorkitProgram.executeInstructionTxn(
      Array.from(Buffer.from(this.ownerPublicKey, 'base64')),
      Buffer.from(signData.msg, 'base64'),
      Buffer.from(signData.normalized, 'base64'),
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
    // Get wallet address
    const smartWallet = await this.getAddress();
    
    // Get necessary components for transactions
    const payer = await this.paymaster.getPayer();
    const blockhash = await this.paymaster.getBlockhash();
    const pubkey = Array.from(Buffer.from(ownerPublicKey, 'base64'));
    // Create authenticator for the smart wallet
    const [smartWalletAuthenticator] = this.lazorkitProgram.smartWalletAuthenticator(
      pubkey, 
      new PublicKey(smartWallet)
    );
    
    // Step 1: Fund the smart wallet with a small amount of SOL
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new PublicKey(smartWallet),
      lamports: LAMPORTS_PER_SOL / 100, // 0.01 SOL
    });
    
    const depositSolTxn = new anchor.web3.Transaction().add(depositSolIns);
    depositSolTxn.recentBlockhash = blockhash;
    depositSolTxn.feePayer = payer;
    await this.paymaster.signAndSend(depositSolTxn);
    
    // Step 2: Initialize rule for the smart wallet
    const initRuleIns = await this.defaultRuleProgram.initRuleIns(
      payer,
      new PublicKey(smartWallet),
      smartWalletAuthenticator
    );
    
    // Step 3: Create the smart wallet using the rule instruction
    const createSmartWalletTxn = await this.lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer
    );
    
    await this.paymaster.signAndSend(createSmartWalletTxn);
    
    return smartWallet;
  }

}