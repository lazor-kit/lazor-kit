/**
 * Lazorkit Provider - Simplified (Mobile Adapter Pattern)
 * 
 * Minimal provider that initializes configuration
 * State management handled by store
 */

import { useEffect } from 'react';
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
