/**
 * Lazorkit Provider - Simplified (Mobile Adapter Pattern)
 * 
 * Minimal provider that initializes configuration
 * State management handled by store
 */

import { useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { versionOf } from '../core/program';
import { StorageManager } from '../core/storage';
import type { ReactNode } from 'react';
import { useWalletStore } from './store';
import { DEFAULTS } from '../config';
import { migrateLegacyKeys } from '../core/keys';

import { PaymasterConfig } from '../core/paymaster/paymaster';
import type { OnConfirmWallet } from '../core/wallet/confirmation';

export interface LazorkitProviderProps {
  children: ReactNode;
  rpcUrl?: string;
  portalUrl?: string;
  /** The paymaster for v2 wallets. */
  paymasterConfig?: PaymasterConfig;
  /**
   * The paymaster for users whose wallet is still on LazorKit v1 — the relayer
   * this app used before v2. Defaults to `paymasterConfig`.
   */
  v1PaymasterConfig?: PaymasterConfig;
  /** Which cluster `rpcUrl` serves, if its URL does not say. See WalletConfig. */
  cluster?: 'mainnet' | 'devnet';
  /**
   * How `connect` asks the user to confirm a wallet it will not adopt on its
   * own: `'builtin'` (default) shows the SDK's chooser, a function shows your
   * own UI, `'throw'` makes `connect` throw `WalletNeedsConfirmationError`.
   */
  onConfirmWallet?: OnConfirmWallet;
  /**
   * Your own Ed25519 keys (base58) — a backend admin, session keys you issue.
   * An authority, session or token approval held by one of them does not stop
   * a wallet from being adopted. Default none.
   */
  trustedAuthorities?: string[];
  /**
   * SPL Token mints your app receives (base58), checked on top of wSOL, USDC,
   * USDT and devnet USDC: a wallet whose vault account for one of them was
   * handed to someone else is not adopted. Default none.
   */
  watchMints?: string[];
  /**
   * Where the SDK keeps the session and authority keys it generates
   * (`createSession`, `addAuthority`). `'auto'` (default): a non-extractable
   * WebCrypto key in IndexedDB, which survives a reload and cannot be copied
   * out by a script. `'memory'`: this page only; the key is gone on reload.
   * Plaintext keys an earlier release left in localStorage are moved when the
   * provider mounts. See the README, "Session and authority keys".
   */
  keyStorage?: 'auto' | 'memory';
}

export const LazorkitProvider = (props: LazorkitProviderProps) => {
  const {
    children,
    rpcUrl = DEFAULTS.RPC_ENDPOINT,
    portalUrl = DEFAULTS.PORTAL_URL,
    paymasterConfig = { paymasterUrl: DEFAULTS.PAYMASTER_URL },
    v1PaymasterConfig,
    cluster,
    onConfirmWallet,
    trustedAuthorities,
    watchMints,
    keyStorage = 'auto',
  } = props;

  const { setConfig } = useWalletStore();
  const wallet = useWalletStore((state) => state.wallet);
  const connection = useWalletStore((state) => state.connection);

  // A persisted v1 wallet may have been migrated since the app last ran — on
  // the LazorKit migration page, say. Then it is closed and its address dead:
  // drop it, so the app stops showing it and the user reconnects to v2.
  useEffect(() => {
    if (!wallet || !connection || versionOf(wallet) !== 1) return;
    let cancelled = false;
    connection
      .getAccountInfo(new PublicKey(wallet.smartWallet))
      .then(async (info) => {
        if (cancelled || info) return;
        await StorageManager.clearWallet();
        useWalletStore.setState({ wallet: null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet, connection]);

  // Session and authority keys an earlier release kept in localStorage as
  // plaintext: moved now, not only when the app next uses one.
  useEffect(() => {
    void migrateLegacyKeys(keyStorage);
  }, [keyStorage]);

  useEffect(() => {
    // Initialize configuration in store
    setConfig({
      portalUrl,
      paymasterConfig,
      v1PaymasterConfig,
      rpcUrl,
      cluster,
      onConfirmWallet,
      trustedAuthorities,
      watchMints,
      keyStorage,
    });
  }, [
    rpcUrl,
    portalUrl,
    paymasterConfig,
    v1PaymasterConfig,
    cluster,
    onConfirmWallet,
    trustedAuthorities,
    watchMints,
    keyStorage,
    setConfig,
  ]);

  return <>{children}</>;
};
