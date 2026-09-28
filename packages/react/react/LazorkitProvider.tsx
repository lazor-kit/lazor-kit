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

import { PaymasterConfig } from '../core/paymaster/paymaster';

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
}

export const LazorkitProvider = (props: LazorkitProviderProps) => {
  const {
    children,
    rpcUrl = DEFAULTS.RPC_ENDPOINT,
    portalUrl = DEFAULTS.PORTAL_URL,
    paymasterConfig = { paymasterUrl: DEFAULTS.PAYMASTER_URL },
    v1PaymasterConfig,
    cluster,
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

  useEffect(() => {
    // Initialize configuration in store
    setConfig({
      portalUrl,
      paymasterConfig,
      v1PaymasterConfig,
      rpcUrl,
      cluster,
    });
  }, [rpcUrl, portalUrl, paymasterConfig, v1PaymasterConfig, cluster, setConfig]);

  return <>{children}</>;
};
