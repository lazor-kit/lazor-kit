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
  /**
   * The protocol this wallet lives on: 1 for a wallet made before LazorKit v2,
   * 2 since. Absent on wallets saved by earlier releases of this package, all
   * of which are v1.
   */
  readonly protocolVersion?: 1 | 2;
}

import { PaymasterConfig } from '../paymaster/paymaster';
import type { OnConfirmWallet } from '../wallet/confirmation';

export interface WalletConfig {
  readonly portalUrl: string;
  /** The paymaster for v2 wallets. */
  readonly paymasterConfig: PaymasterConfig;
  /**
   * The paymaster for wallets still on LazorKit v1 — the one the app used
   * before v2. Defaults to `paymasterConfig`. Keep them apart where you can: a
   * relayer that sponsors the full v1 program can have its fee payer pulled
   * into any v1 transaction's inner calls, so the v2 relayer should not.
   */
  readonly v1PaymasterConfig?: PaymasterConfig;
  readonly rpcUrl?: string;
  /**
   * Which cluster `rpcUrl` serves, when its URL does not say (an app's own
   * RPC proxy, most keyed provider URLs). Without it the cluster is read from
   * the URL — mainnet / devnet / localhost — and anything else is taken as
   * mainnet, as every release before v2 did.
   */
  readonly cluster?: 'mainnet' | 'devnet';
  /**
   * How `connect` asks the user to confirm a wallet it will not adopt on its
   * own — see `OnConfirmWallet`. Default `'builtin'`: the SDK's chooser.
   */
  readonly onConfirmWallet?: OnConfirmWallet;
  /**
   * Your own Ed25519 keys (base58) — a backend admin, session keys you issue.
   * An authority, session or token approval held by one of them does not stop
   * a wallet from being adopted. Passkeys cannot be listed.
   */
  readonly trustedAuthorities?: string[];
  /**
   * SPL Token mints your app receives (base58). A wallet whose vault token
   * account for one of them was handed to someone else is not adopted. wSOL,
   * USDC, USDT and devnet USDC are always checked.
   */
  readonly watchMints?: string[];
  /**
   * Where the SDK keeps the session key `createSession` generates and the
   * authority key `addAuthority` generates. `'auto'` (default): a
   * non-extractable WebCrypto key in IndexedDB (the seed sealed with AES-GCM
   * where the browser has no WebCrypto Ed25519, which any script on the page
   * can decrypt), this page's memory where there is no IndexedDB. `'memory'`:
   * this page only, nothing at rest; the key is gone on reload. Never in
   * localStorage. See the README, "Session and authority keys".
   */
  readonly keyStorage?: 'auto' | 'memory';
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
