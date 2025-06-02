// src/core/wallet/Paymaster.ts
import { 
  Transaction, 
  PublicKey, 
  Connection 
} from '@solana/web3.js';
import { Logger } from '../../utils/logger';

export class Paymaster {
  private endpoint: string;
  private connection: Connection;
  private logger = new Logger('Paymaster');

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.connection = new Connection(endpoint);
  }

  async getPayer(): Promise<PublicKey> {
    try {
      const response = await fetch(`${this.endpoint}/payer`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get payer: ${response.statusText}`);
      }

      const data = await response.json();
      return new PublicKey(data.publicKey);
    } catch (error) {
      this.logger.error('Failed to get payer', error);
      throw error;
    }
  }

  async getBlockhash(): Promise<string> {
    try {
      const response = await fetch(`${this.endpoint}/blockhash`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get blockhash: ${response.statusText}`);
      }

      const data = await response.json();
      return data.blockhash;
    } catch (error) {
      this.logger.error('Failed to get blockhash', error);
      throw error;
    }
  }

  async sign(transaction: Transaction): Promise<Transaction> {
    try {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const response = await fetch(`${this.endpoint}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transaction: serialized.toString('base64')
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign transaction: ${response.statusText}`);
      }

      const data = await response.json();
      return Transaction.from(Buffer.from(data.transaction, 'base64'));
    } catch (error) {
      this.logger.error('Failed to sign transaction', error);
      throw error;
    }
  }

  async signAndSend(transaction: Transaction): Promise<string> {
    try {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const response = await fetch(`${this.endpoint}/sign-and-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transaction: serialized.toString('base64')
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign and send transaction: ${response.statusText}`);
      }

      const data = await response.json();
      return data.txHash;
    } catch (error) {
      this.logger.error('Failed to sign and send transaction', error);
      throw error;
    }
  }
  
}