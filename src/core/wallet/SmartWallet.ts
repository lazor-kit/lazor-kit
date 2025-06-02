// src/core/wallet/SmartWallet.ts
import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram 
} from '@solana/web3.js';
import { Paymaster } from './Paymaster';
import { SignResponse } from '../../types';
import { SMART_WALLET_PROGRAM_ID } from '../../constants/config';

export class SmartWallet {
  private ownerPublicKey: PublicKey;
  private paymaster: Paymaster;
  private walletAddress: PublicKey | null = null;

  constructor(ownerPublicKey: PublicKey, paymaster: Paymaster) {
    this.ownerPublicKey = ownerPublicKey;
    this.paymaster = paymaster;
  }

  async getAddress(): Promise<string> {
    if (!this.walletAddress) {
      // Derive smart wallet address from owner public key
      const [pda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('smart_wallet'),
          this.ownerPublicKey.toBuffer()
        ],
        new PublicKey(SMART_WALLET_PROGRAM_ID)
      );
      this.walletAddress = pda;
    }
    return this.walletAddress.toBase58();
  }

  async buildTransaction(
    instructions: TransactionInstruction[],
    signerPublicKey: string,
    signData: SignResponse
  ): Promise<{ transaction: Transaction; message: Buffer }> {
    const payer = await this.paymaster.getPayer();
    const blockhash = await this.paymaster.getBlockhash();

    // Create transaction
    const transaction = new Transaction();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;

    // Create smart wallet instruction
    const smartWalletIx = await this.createSmartWalletInstruction(
      signerPublicKey,
      signData,
      instructions
    );
    
    // Add smart wallet verification instruction first
    transaction.add(smartWalletIx);

    // Add user instructions
    instructions.forEach(ix => transaction.add(ix));

    return {
      transaction,
      message: transaction.serializeMessage()
    };
  }

  private async createSmartWalletInstruction(
    signerPublicKey: string,
    signData: SignResponse,
    instructions: TransactionInstruction[]
  ): Promise<TransactionInstruction> {
    if (!this.walletAddress) {
      await this.getAddress();
    }

    // Build instruction data
    const instructionData = this.encodeInstructionData(signData, instructions);

    return new TransactionInstruction({
      keys: [
        { 
          pubkey: new PublicKey(signerPublicKey), 
          isSigner: false, 
          isWritable: false 
        },
        { 
          pubkey: this.walletAddress!, 
          isSigner: false, 
          isWritable: true 
        },
        { 
          pubkey: SystemProgram.programId, 
          isSigner: false, 
          isWritable: false 
        }
      ],
      programId: new PublicKey(SMART_WALLET_PROGRAM_ID),
      data: instructionData
    });
  }

  private encodeInstructionData(
    signData: SignResponse,
    instructions: TransactionInstruction[]
  ): Buffer {
    // Encode passkey signature data and instructions
    // This is a simplified version - actual implementation would match your program
    const parts = [
      Buffer.from([0]), // Instruction discriminator
      Buffer.from(signData.authenticatorData, 'base64'),
      Buffer.from(signData.clientDataJSON, 'base64'),
      Buffer.from(signData.signature, 'base64'),
      Buffer.from([instructions.length]),
      // ... serialize instructions
    ];

    return Buffer.concat(parts);
  }
  
}