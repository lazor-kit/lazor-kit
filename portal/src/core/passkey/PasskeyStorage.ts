import { Logger } from '../utils';

interface StoredCredential {
  credentialId: string;
  publicKey: string;
  createdAt: number;
  lastUsedAt?: number;
}

export class PasskeyStorage {
  private readonly STORAGE_KEY = 'lazor_passkey_vault';
  private logger: Logger;
  
  constructor() {
    this.logger = new Logger('PasskeyStorage');
  }
  
  async getCredential(origin: string): Promise<StoredCredential | null> {
    try {
      const vault = this.loadVault();
      const credential = vault[origin];
      
      if (credential) {
        // Update last used
        credential.lastUsedAt = Date.now();
        vault[origin] = credential;
        this.saveVault(vault);
      }
      
      return credential || null;
      
    } catch (error) {
      this.logger.error('Failed to get credential:', error);
      return null;
    }
  }
  
  async saveCredential(origin: string, credential: Omit<StoredCredential, 'lastUsedAt'>): Promise<void> {
    try {
      const vault = this.loadVault();
      
      vault[origin] = {
        ...credential,
        lastUsedAt: Date.now()
      };
      
      this.saveVault(vault);
      this.logger.info('Credential saved for origin:', origin);
      
    } catch (error) {
      this.logger.error('Failed to save credential:', error);
      throw error;
    }
  }
  
  private loadVault(): Record<string, StoredCredential> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }
  
  private saveVault(vault: Record<string, StoredCredential>): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(vault));
  }
}