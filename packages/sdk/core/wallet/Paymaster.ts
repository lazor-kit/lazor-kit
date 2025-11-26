/**
 * Paymaster service for handling transaction fees and signing
 */
import { 
  Transaction, 
  PublicKey,
  VersionedTransaction
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
          method: 'getPayerSigner',
          params: [],
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get payer: ${response.statusText}`);
      }

      const data = await response.json();
      const payer = new PublicKey(data.result.signer_address);
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
  private async attemptSign(transaction: Transaction, attempt: number = 1): Promise<Transaction> {
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
      if (data.error) {
        throw new Error(data.error.message || 'Unknown paymaster error');
      }

      return Transaction.from(Buffer.from(data.result.signed_transaction, 'base64'));
    } catch (error) {
      this.logger.error(`Sign attempt ${attempt} failed:`, error);
      throw error;
    }
  }

  /**
   * Sign a transaction using the paymaster service with retries
   * @param transaction Transaction to sign
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param baseDelay Base delay between retries in ms (default: 1000)
   * @returns Signed transaction
   */
  async sign(transaction: Transaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<Transaction> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.attemptSign(transaction, attempt);
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error('All sign retry attempts failed', error);
          throw error;
        }
        
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.info(`Retrying sign in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Failed to sign transaction after all retries');
  }

  /**
   * Sign and send a transaction using the paymaster service
   * @param transaction Transaction to sign and send
   * @returns Transaction hash as a string
   */
  private async attemptSignAndSend(transaction: Transaction, attempt: number = 1): Promise<string> {
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
      if (data.error) {
        throw new Error(data.error.message || 'Unknown paymaster error');
      }
      
      return data.result.signature;
    } catch (error) {
      this.logger.error(`Attempt ${attempt} failed:`, error);
      throw error;
    }
  }

  /**
   * Sign and send a transaction with retries
   * @param transaction Transaction to sign and send
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param baseDelay Base delay between retries in ms (default: 1000)
   * @returns Transaction signature
   */
  async signAndSend(transaction: Transaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.attemptSignAndSend(transaction, attempt);
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error('All retry attempts failed', error);
          throw error;
        }
        
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.info(`Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Failed to sign and send transaction after all retries');
  }
  

    /**
   * Sign and send a transaction using the paymaster service
   * @param transaction Transaction to sign and send
   * @returns Transaction hash as a string
   */
    private async attemptSignAndSendVersionedTransaction(transaction: VersionedTransaction, attempt: number = 1): Promise<string> {
      try {
        const serialized = transaction.serialize();
  
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
              Buffer.from(serialized).toString('base64')
            ]
          })
        });
  
        if (!response.ok) {
          throw new Error(`Failed to sign and send transaction: ${response.statusText}`);
        }
  
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error.message || 'Unknown paymaster error');
        }
        
        return data.result.signature;
      } catch (error) {
        this.logger.error(`Attempt ${attempt} failed:`, error);
        throw error;
      }
    }
  
    /**
     * Sign and send a transaction with retries
     * @param transaction Transaction to sign and send
     * @param maxRetries Maximum number of retry attempts (default: 3)
     * @param baseDelay Base delay between retries in ms (default: 1000)
     * @returns Transaction signature
     */
    async signAndSendVersionedTransaction(transaction: VersionedTransaction, maxRetries: number = 3, baseDelay: number = 1000): Promise<string> {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await this.attemptSignAndSendVersionedTransaction(transaction, attempt);
        } catch (error) {
          if (attempt === maxRetries) {
            this.logger.error('All retry attempts failed', error);
            throw error;
          }
          
          // Calculate exponential backoff delay
          const delay = baseDelay * Math.pow(2, attempt - 1);
          this.logger.info(`Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw new Error('Failed to sign and send transaction after all retries');
    }
}

