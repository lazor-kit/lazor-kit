/**
 * Storage service for managing localStorage operations
 */
export class StorageService {
  private static readonly CREDENTIAL_ID_KEY = 'CREDENTIAL_ID';
  private static readonly PUBLIC_KEY_KEY = 'PUBLIC_KEY';

  /**
   * Save wallet credentials to localStorage
   */
  static saveWalletCredentials(credentialId: string, publicKey: string): void {
    localStorage.setItem(this.CREDENTIAL_ID_KEY, credentialId);
    localStorage.setItem(this.PUBLIC_KEY_KEY, publicKey);
  }

  /**
   * Clear wallet credentials from localStorage
   */
  static clearWalletCredentials(): void {
    localStorage.removeItem(this.CREDENTIAL_ID_KEY);
    localStorage.removeItem(this.PUBLIC_KEY_KEY);
  }

  /**
   * Get credential ID from localStorage
   */
  static getCredentialId(): string | null {
    return localStorage.getItem(this.CREDENTIAL_ID_KEY);
  }

  /**
   * Get public key from localStorage
   */
  static getPublicKey(): string | null {
    return localStorage.getItem(this.PUBLIC_KEY_KEY);
  }

  /**
   * Check if wallet is connected
   */
  static isWalletConnected(): boolean {
    return !!this.getCredentialId();
  }
}
