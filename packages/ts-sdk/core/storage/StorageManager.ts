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
  /** Wallet PDA (internal authority account — use vaultPda for user-facing address) */
  readonly smartWallet: string;
  /** Vault PDA — the actual SOL-holding account users should fund */
  readonly vaultPda?: string;
  readonly walletDevice: string;
  readonly accountName?: string;
}

import { PaymasterConfig } from '../paymaster/paymaster';

export interface WalletConfig {
  readonly portalUrl: string;
  readonly paymasterConfig: PaymasterConfig;
  readonly rpcUrl?: string;
}

/**
 * Web storage implementation using localStorage
 */
export const storage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(name);
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(name, value);
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(name);
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
    await storage.setItem(STORAGE_KEYS.WALLET, JSON.stringify(wallet));
    await storage.setItem(STORAGE_KEYS.CREDENTIAL_ID, wallet.credentialId);
    await storage.setItem(STORAGE_KEYS.SMART_WALLET_ADDRESS, wallet.smartWallet);
    await storage.setItem(STORAGE_KEYS.PUBLIC_KEY, Buffer.from(wallet.passkeyPubkey).toString('base64'));
  }

  static async getWallet(): Promise<WalletInfo | null> {
    const walletData = await storage.getItem(STORAGE_KEYS.WALLET);
    if (!walletData) return null;
    return JSON.parse(walletData) as WalletInfo;
  }

  static async saveConfig(config: WalletConfig): Promise<void> {
    await storage.setItem('lazorkit-config', JSON.stringify(config));
  }

  static async getConfig(): Promise<WalletConfig | null> {
    const configData = await storage.getItem('lazorkit-config');
    if (!configData) return null;
    return JSON.parse(configData) as WalletConfig;
  }

  static async clearWallet(): Promise<void> {
    await storage.removeItem(STORAGE_KEYS.WALLET);
    await storage.removeItem(STORAGE_KEYS.CREDENTIAL_ID);
    await storage.removeItem(STORAGE_KEYS.SMART_WALLET_ADDRESS);
    await storage.removeItem(STORAGE_KEYS.PUBLIC_KEY);
    await storage.removeItem('CREDENTIALS_TIMESTAMP');
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
