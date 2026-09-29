/**
 * LazorKit Wallet Mobile Adapter - React Provider
 */

import { registerCluster, versionOf } from '../program';
import { Connection, PublicKey } from '@solana/web3.js';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletStore } from './store';
import { BuiltinWalletChooser } from './WalletChooser';
import { logger } from '../core/logger';
import { ConfirmWalletHandler, ConfirmWalletRequest, LazorKitProviderProps } from '../types';
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
  v1ConfigPaymaster,
  cluster,
  rpId = DEFAULTS.RP_ID,
  onConfirmWallet = 'builtin',
  trustedAuthorities,
  watchMints,
  isDebug = false,
  children,
}: LazorKitProviderProps): React.JSX.Element => {
  const { setConnection, setConfig } = useWalletStore();
  const wallet = useWalletStore((state) => state.wallet);

  useEffect(() => {
    logger.setDebugMode(isDebug);
  }, [isDebug]);

  const effectiveRpcUrl = rpcUrl || DEFAULTS.RPC_ENDPOINT;
  const effectivePortalUrl = portalUrl || DEFAULTS.PORTAL_URL;
  const effectivePaymasterUrl = configPaymaster.paymasterUrl || DEFAULTS.PAYMASTER_URL;
  const effectiveRpId = rpId || DEFAULTS.RP_ID;

  // Primitive deps, so a v1 paymaster that arrives or changes after mount
  // still reaches the store (an object literal prop would not be compared).
  const v1PaymasterUrl = v1ConfigPaymaster?.paymasterUrl;
  const v1PaymasterApiKey = v1ConfigPaymaster?.apiKey;
  // The same for the key lists, which apps tend to pass as inline arrays: a
  // new array each render must not reset the config each render.
  const trustedKeysKey = (trustedAuthorities ?? []).join(',');
  const watchMintsKey = (watchMints ?? []).join(',');
  // And for a handler passed inline: the config holds one stable function
  // that calls whichever handler the app passed last.
  const handlerRef = useRef<ConfirmWalletHandler | null>(null);
  if (typeof onConfirmWallet === 'function') handlerRef.current = onConfirmWallet;
  const confirmMode = typeof onConfirmWallet === 'function' ? 'handler' : onConfirmWallet;
  const callHandler = useCallback(
    (request: ConfirmWalletRequest) => (handlerRef.current as ConfirmWalletHandler)(request),
    [],
  );

  const connection = useMemo(() => {
    registerCluster(effectiveRpcUrl, cluster);
    try {
      return new Connection(effectiveRpcUrl, 'confirmed');
    } catch (error) {
      logger.error('Failed to create Solana connection:', error, { rpcUrl: effectiveRpcUrl });
      return new Connection(DEFAULTS.RPC_ENDPOINT, 'confirmed');
    }
  }, [effectiveRpcUrl, cluster]);

  useEffect(() => {
    try {
      setConnection(connection);
      setConfig({
        portalUrl: effectivePortalUrl,
        configPaymaster: {
          paymasterUrl: effectivePaymasterUrl,
          apiKey: configPaymaster.apiKey,
        },
        v1ConfigPaymaster: v1PaymasterUrl
          ? { paymasterUrl: v1PaymasterUrl, apiKey: v1PaymasterApiKey }
          : undefined,
        rpcUrl: effectiveRpcUrl,
        cluster,
        rpId: effectiveRpId,
        onConfirmWallet: confirmMode === 'handler' ? callHandler : confirmMode,
        trustedAuthorities: trustedKeysKey ? trustedKeysKey.split(',') : [],
        watchMints: watchMintsKey ? watchMintsKey.split(',') : [],
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
    v1PaymasterUrl,
    v1PaymasterApiKey,
    cluster,
    effectiveRpcUrl,
    effectiveRpId,
    confirmMode,
    callHandler,
    trustedKeysKey,
    watchMintsKey,
    isDebug,
    setConnection,
    setConfig,
  ]);

  // A persisted v1 wallet may have been migrated since the app last ran — on
  // the LazorKit migration page, say. Then it is closed and its address dead:
  // drop it, so the app does not keep showing it, and the user reconnects.
  useEffect(() => {
    if (!wallet || versionOf(wallet) !== 1) return;
    let cancelled = false;
    connection
      .getAccountInfo(new PublicKey(wallet.walletPda))
      .then((info) => {
        if (!cancelled && !info) useWalletStore.setState({ wallet: null });
      })
      .catch((error) => logger.error('Could not check the persisted v1 wallet:', error));
    return () => {
      cancelled = true;
    };
  }, [connection, wallet]);

  try {
    return (
      <>
        {typeof children === 'string' ? <span>{children}</span> : children}
        <BuiltinWalletChooser />
      </>
    );
  } catch (error) {
    logger.error('LazorKitProvider render error:', error);
    return <span>LazorKit Provider Error</span>;
  }
};
