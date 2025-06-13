/**
 * Paymaster service for handling transaction fees and signing
 */
import { 
  Transaction, 
  PublicKey 
} from '@solana/web3.js';
import { Logger } from '../../utils/logger';
import { Buffer } from 'buffer';
export class Paymaster {
  private endpoint: string;
  private logger = new Logger('Paymaster');

  /**
   * Create a new Paymaster instance
   * @param endpoint URL of the paymaster service
   */
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  /**
   * Get the public key of the fee payer from the paymaster service
   * @returns Public key of the fee payer
   */
  async getPayer(): Promise<PublicKey> {
    try {
      const response = await fetch(`${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getConfig',
          params: [],
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get payer: ${response.statusText}`);
      }

      const data = await response.json();
      const payer = new PublicKey(data.result.fee_payer);
      return payer;
    } catch (error) {
      this.logger.error('Failed to get payer', error);
      throw error;
    }
  }

  /**
   * Get a recent blockhash from the paymaster service
   * @returns Recent blockhash as a string
   */
  async getBlockhash(): Promise<string> {
    try {
      const response = await fetch(`${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getBlockhash',
          id: 1,
          params: [],
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get blockhash: ${response.statusText}`);
      }

      const data = await response.json();
      return data.result.blockhash;
    } catch (error) {
      this.logger.error('Failed to get blockhash', error);
      throw error;
    }
  }

  /**
   * Sign a transaction using the paymaster service
   * @param transaction Transaction to sign
   * @returns Signed transaction
   */
  async sign(transaction: Transaction): Promise<Transaction> {
    try {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const response = await fetch(`${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'signTransaction',
          id: 1,
          params: [
            serialized.toString('base64')
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign transaction: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(data);
      console.log(data.result.signed_transaction);
      return Transaction.from(Buffer.from(data.result.signed_transaction, 'base64'));
    } catch (error) {
      this.logger.error('Failed to sign transaction', error);
      throw error;
    }
  }

  /**
   * Sign and send a transaction using the paymaster service
   * @param transaction Transaction to sign and send
   * @returns Transaction hash as a string
   */
  async signAndSend(transaction: Transaction): Promise<string> {
    try {
      const serialized = transaction.serialize({
        verifySignatures: false,
        requireAllSignatures: false
      });

      const response = await fetch(`${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'signAndSendTransaction',
          id: 1,
          params: [
            serialized.toString('base64')
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign and send transaction: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(data);
      return data.result.signature;
    } catch (error) {
      this.logger.error('Failed to sign and send transaction', error);
      throw error;
    }
  }
  
}