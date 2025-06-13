import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Lazorkit } from '../core/Lazorkit';
import { useLazorkitStore } from './store';

interface LazorkitProviderProps {
  children: ReactNode;
  rpcUrl: string;
  ipfsUrl?: string;
  paymasterUrl: string;
}

export const LazorkitProvider = (props: LazorkitProviderProps) => {
  const {
    children,
    rpcUrl,
    ipfsUrl = 'https://portal.lazor.sh',
    paymasterUrl
  } = props;
  const { setSdk, setAccount, setIsConnecting, setIsSigning, setError } = useLazorkitStore();

  useEffect(() => {
    const sdk = new Lazorkit({
      url: ipfsUrl,
      rpcUrl,
      paymasterUrl,
      mode: 'auto'
    });

    // Set up event listeners
    sdk.on('connect:start', () => setIsConnecting(true));
    sdk.on('connect:success', (account) => {
      setAccount(account);
      setIsConnecting(false);
      setError(null);
    });
    sdk.on('connect:error', (error) => {
      setError(error);
      setIsConnecting(false);
    });

    sdk.on('transaction:start', () => setIsSigning(true));
    sdk.on('transaction:success', () => {
      setIsSigning(false);
      setError(null);
    });
    sdk.on('transaction:error', (error) => {
      setError(error);
      setIsSigning(false);
    });

    setSdk(sdk);

    return () => {
      // Clean up event listeners
      sdk.removeAllListeners();
    };
  }, [rpcUrl, ipfsUrl, paymasterUrl]);

  return <>{children}</>;
};
