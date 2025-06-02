// src/types/storage.types.ts
export interface StorageOptions {
  ttl?: number;
  compress?: boolean;
  encrypt?: boolean;
}

export interface StoredAccount {
  id: string;
  address: string;
  publicKey: string;
  createdAt: number;
  lastUsedAt: number;
  label?: string;
  origin: string;
  dialogUrl: string;
}

export interface StorageData {
  version: number;
  accounts: StoredAccount[];
  lastActiveAccountId: string | null;
  settings: {
    preferredMode?: 'iframe' | 'popup' | 'auto';
    theme?: 'light' | 'dark' | 'auto';
  };
}