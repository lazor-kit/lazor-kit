/**
 * Storage Manager - Web Storage Abstraction Layer
 * 
 * Provides localStorage abstraction for web applications
 */
import { Buffer } from 'buffer';
import { STORAGE_KEYS } from '../../config';

export interface WalletInfo {
  readonly credentialId: string;
  readonly passkeyPubkey: number[];
  readonly expo: string;
  readonly platform: string;
  readonly smartWallet: string;
  readonly walletDevice: string;
  readonly accountName?: string;
}

export interface WalletConfig {
  readonly portalUrl: string;
  readonly paymasterUrl: string;
  readonly rpcUrl?: string;
}

/**
 * Web storage implementation using localStorage
 */
export const storage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = localStorage.getItem(name);
      return result;
    } catch (error) {
      console.error('Error reading from localStorage:', error, { key: name });
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.error('Error writing to localStorage:', error, {
        key: name,
        valueLength: value.length,
      });
    }
  },

  removeItem: async (name: string): Promise<void> => {
    try {
      localStorage.removeItem(name);
    } catch (error) {
      console.error('Error removing from localStorage:', error, { key: name });
    }
  },
};

/**
 * Storage Manager Class
 * Provides unified interface for credential storage
 */
export class StorageManager {
  /**
   * Save wallet information to storage
   */
  static async saveWallet(wallet: WalletInfo): Promise<void> {
    try {
      await storage.setItem(STORAGE_KEYS.WALLET, JSON.stringify(wallet));
      // Also save individual keys for compatibility
      await storage.setItem(STORAGE_KEYS.CREDENTIAL_ID, wallet.credentialId);
      await storage.setItem(STORAGE_KEYS.SMART_WALLET_ADDRESS, wallet.smartWallet);
      await storage.setItem(STORAGE_KEYS.PUBLIC_KEY, Buffer.from(wallet.passkeyPubkey).toString('base64'));
    } catch (error) {
      console.error('Failed to save wallet to storage:', error);
      throw error;
    }
  }

  /**
   * Get wallet information from storage
   */
  static async getWallet(): Promise<WalletInfo | null> {
    try {
      const walletData = await storage.getItem(STORAGE_KEYS.WALLET);
      if (!walletData) {
        return null;
      }
      return JSON.parse(walletData) as WalletInfo;
    } catch (error) {
      console.error('Failed to get wallet from storage:', error);
      return null;
    }
  }

  /**
   * Save wallet configuration to storage
   */
  static async saveConfig(config: WalletConfig): Promise<void> {
    try {
      await storage.setItem('lazorkit-config', JSON.stringify(config));
    } catch (error) {
      console.error('Failed to save config to storage:', error);
      throw error;
    }
  }

  /**
   * Get wallet configuration from storage
   */
  static async getConfig(): Promise<WalletConfig | null> {
    try {
      const configData = await storage.getItem('lazorkit-config');
      if (!configData) {
        return null;
      }
      return JSON.parse(configData) as WalletConfig;
    } catch (error) {
      console.error('Failed to get config from storage:', error);
      return null;
    }
  }

  /**
   * Clear all wallet data from storage
   */
  static async clearWallet(): Promise<void> {
    try {
      await storage.removeItem(STORAGE_KEYS.WALLET);
      await storage.removeItem(STORAGE_KEYS.CREDENTIAL_ID);
      await storage.removeItem(STORAGE_KEYS.SMART_WALLET_ADDRESS);
      await storage.removeItem(STORAGE_KEYS.PUBLIC_KEY);
      await storage.removeItem('CREDENTIALS_TIMESTAMP');
    } catch (error) {
      console.error('Failed to clear wallet from storage:', error);
      throw error;
    }
  }

  /**
   * Get item from storage (generic)
   */
  static async getItem(key: string): Promise<string | null> {
    return await storage.getItem(key);
  }

  /**
   * Set item in storage (generic)
   */
  static async setItem(key: string, value: string): Promise<void> {
    await storage.setItem(key, value);
  }

  /**
   * Remove item from storage (generic)
   */
  static async removeItem(key: string): Promise<void> {
    await storage.removeItem(key);
  }
}
