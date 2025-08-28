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

export interface LazorkitProviderProps {
  children: ReactNode;
  rpcUrl?: string;
  portalUrl?: string;
  paymasterUrl?: string;
}

export const LazorkitProvider = (props: LazorkitProviderProps) => {
  const {
    children,
    rpcUrl = DEFAULTS.RPC_ENDPOINT,
    portalUrl = DEFAULTS.PORTAL_URL,
    paymasterUrl = DEFAULTS.PAYMASTER_URL
  } = props;
  
  const { setConfig } = useWalletStore();

  useEffect(() => {
    // Initialize configuration in store
    setConfig({
      portalUrl,
      paymasterUrl,
      rpcUrl
    });
  }, [rpcUrl, portalUrl, paymasterUrl, setConfig]);

  return <>{children}</>;
};
