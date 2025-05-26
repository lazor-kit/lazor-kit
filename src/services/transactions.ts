import { PublicKey, Keypair, TransactionInstruction, Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { createSmartWalletTransaction } from '../core/createSmartWallet';
import { getSmartWalletPdaByCreator } from '../core/getAddress';
import { createVerifyAndExecuteTransaction } from '../core/verifyAndExecute';

/**
 * Service for handling wallet operations
 */
export class TransactionsSmartWallet {
  private connection: Connection;
  private keypair: Keypair;
  
  /**
   * Creates a new TransactionsSmartWallet instance
   * @param connection Optional Solana connection to use. If not provided, a default connection will be created.
   */
  constructor(connection?: any) {
    this.keypair = Keypair.fromSecretKey(new Uint8Array([91, 139, 202, 42, 20, 31, 61, 11, 170, 237, 184, 147, 253, 10, 63, 240, 131, 46, 231, 211, 253, 181, 58, 104, 242, 192, 0, 143, 19, 252, 47, 158, 219, 165, 97, 103, 220, 26, 173, 243, 207, 52, 18, 44, 64, 84, 249, 104, 158, 221, 84, 61, 36, 240, 55, 20, 76, 59, 142, 34, 100, 132, 243, 236]));
    
    // Use provided connection or create a default one
    this.connection = connection || new Connection('https://api.mainnet-beta.solana.com');
  }

  /**
   * Utility function to delay execution
   */
  static delay(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Create a smart wallet transaction
   */
  async createSmartWallet(publicKeyBase64: string): Promise<void> {
    await createSmartWalletTransaction({
      secp256k1PubkeyBytes: Array.from(Buffer.from(publicKeyBase64, "base64")),
      connection: this.connection,
    });
    await TransactionsSmartWallet.delay(2);
  }

  /**
   * Get smart wallet PDA by creator
   */
  async getSmartWalletPda(publicKeyBase64: string): Promise<string> {
    return await getSmartWalletPdaByCreator(
      this.connection,
      Array.from(Buffer.from(publicKeyBase64, "base64"))
    );
  }

  /**
   * Sign and send a transaction
   */
  async signAndSendTransaction(
    instruction: TransactionInstruction,
    storedPublicKey: string,
    normalizedSignature: string,
    message: string,
    smartWalletPubkey: string
  ): Promise<string> {
    const txn = await createVerifyAndExecuteTransaction({
      arbitraryInstruction: instruction,
      pubkey: Buffer.from(storedPublicKey, "base64"),
      signature: Buffer.from(normalizedSignature, "base64"),
      message: Buffer.from(message, "base64"),
      connection: this.connection,
      payer: this.keypair.publicKey,
      smartWalletPda: new PublicKey(smartWalletPubkey),
    });

    txn.partialSign(this.keypair);
    return await this.connection.sendRawTransaction(txn.serialize(), {
      skipPreflight: true
    });
  }

  /**
   * Get the connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }
}
