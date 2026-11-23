/**
 * Storage utility for managing credential data in local storage
 */

// Use the same keys as the reference implementation
const CREDENTIAL_ID_KEY = 'CREDENTIAL_ID';
const PUBLIC_KEY_KEY = 'PUBLIC_KEY';
const SMART_WALLET_KEY = 'SMART_WALLET_ADDRESS';

export interface StoredCredentials {
  credentialId?: string;
  publickey: string; // Match the case used in reference implementation
  smartWalletAddress: string;
  timestamp: number;
}

/**
 * Storage utility for managing credential data
 */
export class StorageUtil {
  /**
   * Save credentials to local storage
   * @param credentials The credentials to save
   */
  static saveCredentials(credentials: StoredCredentials): void {
    if (credentials.credentialId) {
      localStorage.setItem(CREDENTIAL_ID_KEY, credentials.credentialId);
    }
    localStorage.setItem(PUBLIC_KEY_KEY, credentials.publickey);
    localStorage.setItem(SMART_WALLET_KEY, credentials.smartWalletAddress);
    localStorage.setItem('CREDENTIALS_TIMESTAMP', credentials.timestamp.toString());
  }

  static getCredentials(): StoredCredentials | null {
    const credentialId = localStorage.getItem(CREDENTIAL_ID_KEY);
    const publickey = localStorage.getItem(PUBLIC_KEY_KEY);
    const smartWalletAddress = localStorage.getItem(SMART_WALLET_KEY);
    const timestamp = localStorage.getItem('CREDENTIALS_TIMESTAMP');

    if (!publickey || !smartWalletAddress) return null;

    return {
      credentialId: credentialId || undefined,
      publickey,
      smartWalletAddress,
      timestamp: timestamp ? parseInt(timestamp) : Date.now()
    };
  }

  static updateSmartWalletAddress(smartWalletAddress: string): void {
    localStorage.setItem(SMART_WALLET_KEY, smartWalletAddress);
  }

  static clearCredentials(): void {
    localStorage.removeItem(CREDENTIAL_ID_KEY);
    localStorage.removeItem(PUBLIC_KEY_KEY);
    localStorage.removeItem(SMART_WALLET_KEY);
    localStorage.removeItem('CREDENTIALS_TIMESTAMP');
  }

  static getItem(key: string): string | null {
    return localStorage.getItem(key);
  }

  static setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
}
