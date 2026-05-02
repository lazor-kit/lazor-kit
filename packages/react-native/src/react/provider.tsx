/**
 * LazorKit Wallet Mobile Adapter - React Provider
 */

import { Connection } from '@solana/web3.js';
import React, { useEffect, useMemo } from 'react';
import { useWalletStore } from './store';
import { logger } from '../core/logger';
import { LazorKitProviderProps } from '../types';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { DEFAULTS } from '../config';

global.Buffer = Buffer;

// Ensure subarray returns a Buffer (not a plain Uint8Array) so downstream
// Solana libs that call Buffer-only methods on the result don't blow up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Buffer.prototype as any).subarray = function subarray(begin: number | undefined, end: number | undefined) {
  try {
    const result = Uint8Array.prototype.subarray.apply(this, [begin, end]);
    Object.setPrototypeOf(result, Buffer.prototype);
    return result;
  } catch (error) {
    logger.error('Buffer subarray polyfill failed:', error, { begin, end });
    throw error;
  }
};

export const LazorKitProvider = ({
  rpcUrl = DEFAULTS.RPC_ENDPOINT,
  portalUrl = DEFAULTS.PORTAL_URL,
  configPaymaster = {
    paymasterUrl: DEFAULTS.PAYMASTER_URL,
  },
  rpId = DEFAULTS.RP_ID,
  isDebug = false,
  children,
}: LazorKitProviderProps): React.JSX.Element => {
  const { setConnection, setConfig } = useWalletStore();

  useEffect(() => {
    logger.setDebugMode(isDebug);
  }, [isDebug]);

  const effectiveRpcUrl = rpcUrl || DEFAULTS.RPC_ENDPOINT;
  const effectivePortalUrl = portalUrl || DEFAULTS.PORTAL_URL;
  const effectivePaymasterUrl = configPaymaster.paymasterUrl || DEFAULTS.PAYMASTER_URL;
  const effectiveRpId = rpId || DEFAULTS.RP_ID;

  const connection = useMemo(() => {
    try {
      return new Connection(effectiveRpcUrl, 'confirmed');
    } catch (error) {
      logger.error('Failed to create Solana connection:', error, { rpcUrl: effectiveRpcUrl });
      return new Connection(DEFAULTS.RPC_ENDPOINT, 'confirmed');
    }
  }, [effectiveRpcUrl]);

  useEffect(() => {
    try {
      setConnection(connection);
      setConfig({
        portalUrl: effectivePortalUrl,
        configPaymaster: {
          paymasterUrl: effectivePaymasterUrl,
          apiKey: configPaymaster.apiKey,
        },
        rpcUrl: effectiveRpcUrl,
        rpId: effectiveRpId,
      });
    } catch (error) {
      logger.error('Failed to initialize wallet store:', error, {
        rpcUrl: effectiveRpcUrl,
        portalUrl: effectivePortalUrl,
        paymasterUrl: effectivePaymasterUrl,
        rpId: effectiveRpId,
        isDebug,
      });
    }
  }, [
    connection,
    effectivePortalUrl,
    effectivePaymasterUrl,
    configPaymaster.apiKey,
    effectiveRpcUrl,
    effectiveRpId,
    isDebug,
    setConnection,
    setConfig,
  ]);

  try {
    return <>{typeof children === 'string' ? <span>{children}</span> : children}</>;
  } catch (error) {
    logger.error('LazorKitProvider render error:', error);
    return <span>LazorKit Provider Error</span>;
  }
};
