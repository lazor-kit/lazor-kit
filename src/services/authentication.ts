import { WalletState } from '../models/WalletState';
import { StorageService } from './storage';
import { TransactionsSmartWallet } from './transactions';
import { TransactionInstruction } from '@solana/web3.js';
import { Connection } from '@solana/web3.js';

const WALLET_BASE_URL = 'https://w3s.link/ipfs/bafybeibvvxqef5arqj4uy22zwl3hcyvrthyfrjzoeuzyfcbizjur4yt6by/';
const WALLET_CONNECT_ACTION = 'connect';
const WALLET_SIGN_ACTION = 'sign';

// Full URLs with actions
const WALLET_CONNECT_URL = `${WALLET_BASE_URL}?action=${WALLET_CONNECT_ACTION}`;

/**
 * Connection options for wallet authentication
 */
export interface ConnectionOptions {
  /** Optional custom popup width */
  width?: number;
  /** Optional custom popup height */
  height?: number;
  /** Optional connection timeout in milliseconds */
  timeout?: number;
}

/**
 * Signing options for wallet transactions
 */
export interface SigningOptions {
  /** Optional custom popup width */
  width?: number;
  /** Optional custom popup height */
  height?: number;
  /** Optional signing timeout in milliseconds */
  timeout?: number;
  /** Optional message to sign */
  message?: string;
}

/**
 * Service for handling wallet authentication
 */
export class AuthenticationService {
  private walletService: TransactionsSmartWallet;
  private stateUpdater: (state: Partial<WalletState>) => void;

  /**
   * Initialize the authentication service
   * @param stateUpdater Function to update wallet state
   * @param connection Optional Solana connection to use
   */
  constructor(stateUpdater: (state: Partial<WalletState>) => void, connection?: any) {
    this.walletService = new TransactionsSmartWallet(connection);
    this.stateUpdater = stateUpdater;
  }

  /**
   * Connect to wallet
   * @param options Optional connection configuration options
   */
  async connect(options?: ConnectionOptions): Promise<{ smartWalletPubkey: string }> {
    this.stateUpdater({ isLoading: true, error: null });

    try {
      const popupWidth = options?.width || 600;
      const popupHeight = options?.height || 400;
      const connectionTimeout = options?.timeout || 60000;
      
      const popup = window.open(
        WALLET_CONNECT_URL,
        'WalletAction',
        `width=${popupWidth},height=${popupHeight}`
      );

      return await new Promise((resolve, reject) => {
        const handleMessage = async (event: MessageEvent) => {
          if (event.data.type === 'WALLET_CONNECTED') {
            const { credentialId, publickey } = event.data.data;
            
            // Save credentials
            StorageService.saveWalletCredentials(credentialId, publickey);
            
            // Create smart wallet
            await this.walletService.createSmartWallet(publickey);
            
            // Get smart wallet pubkey
            const smartWalletPubkey = await this.walletService.getSmartWalletPda(publickey);
            
            // Update state
            this.stateUpdater({
              credentialId,
              publicKey: smartWalletPubkey,
              isConnected: true,
              isLoading: false,
              error: null,
              smartWalletAuthorityPubkey: smartWalletPubkey,
            });
            
            window.removeEventListener('message', handleMessage);
            resolve({ smartWalletPubkey });
          } else if (event.data.type === 'WALLET_ERROR') {
            window.removeEventListener('message', handleMessage);
            reject(new Error(event.data.error));
            if (popup) {
              popup.close();
            }
          }
        };

        window.addEventListener('message', handleMessage);

        const checkPopupClosed = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Connection timeout'));
        }, connectionTimeout);
      });
    } catch (error) {
      this.stateUpdater({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      });
      throw error;
    }
  }

  /**
   * Disconnect from wallet
   */
  disconnect(): void {
    StorageService.clearWalletCredentials();
    this.stateUpdater({
      credentialId: null,
      publicKey: null,
      isConnected: false,
      isLoading: false,
      error: null,
      smartWalletAuthorityPubkey: null,
    });
  }

  /**
   * Sign a message with the wallet
   * @param instruction The transaction instruction to sign
   * @param options Optional signing configuration options
   */
  async signMessage(instruction: TransactionInstruction, options?: SigningOptions): Promise<string> {
    try {
      const popupWidth = options?.width || 600;
      const popupHeight = options?.height || 400;
      const signingTimeout = options?.timeout || 60000;
      const message = options?.message || 'hello';
      
      const popup = window.open(
        `${WALLET_BASE_URL}?action=${WALLET_SIGN_ACTION}&message=${encodeURIComponent(message)}`,
        'WalletAction',
        `width=${popupWidth},height=${popupHeight}`
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }

      return new Promise<string>((resolve, reject) => {
        const handleMessage = async (event: MessageEvent) => {
          if (event.data.type === 'SIGNATURE_CREATED') {
            try {
              const storedPublicKey = StorageService.getPublicKey();
              if (!storedPublicKey) {
                throw new Error('Public key not found');
              }

              const smartWalletPubkey = await this.walletService.getSmartWalletPda(storedPublicKey);
              const { normalized, msg } = event.data.data;

              const txid = await this.walletService.signAndSendTransaction(
                instruction,
                storedPublicKey,
                normalized,
                msg,
                smartWalletPubkey
              );

              console.log('Transaction ID:', txid);
              resolve(txid);
            } catch (err) {
              reject(err);
            } finally {
              cleanup();
            }
          }
        };

        window.addEventListener('message', handleMessage);

        const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Popup closed unexpectedly'));
          }
        }, 500);

        const timeout = setTimeout(() => {
          clearInterval(checkPopupClosed);
          window.removeEventListener('message', handleMessage);
          reject(new Error('Signing timeout'));
        }, signingTimeout);

        const cleanup = () => {
          clearInterval(checkPopupClosed);
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
        };
      });
    } catch (error) {
      console.error('Error signing message:', error);
      throw error;
    }
  }
}
