/**
 * LazorkitProvider: configures the page's one wallet store from its props.
 *
 * `mode` is required, with no default (D1): `"embedded"` puts the passkey on
 * the app's own `rpId`; `"portal"` keeps 3.x's hosted portal and its wallets.
 * A static mistake in the props (no mode, a malformed rpId, Embedded on
 * mainnet with LazorKit's relayer) throws `LazorkitConfigError` while
 * rendering. Problems with the page itself (an IP address, plain http, no
 * WebAuthn) do not: they show as `availability` and as `connect()`'s error.
 *
 * The page's first configure runs while the provider renders, so the app's
 * first render (and its first effects) already see a restored wallet; later
 * prop changes apply in a layout effect, before paint. On the server nothing
 * is read; while hydrating, React compares against the store's server
 * snapshot (disconnected), so there is no mismatch. Render the provider above
 * anything that reads the wallet.
 */
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { PublicKey } from '@solana/web3.js';
import { versionOf } from '../core/program';
import { walletRecords } from '../core/storage';
import { useWalletStore } from './store';
import { migrateLegacyKeys } from '../core/keys';
import { configureStore, isConfigured } from '../core/client/configure';
import { type LazorkitClientConfig, type LazorkitOptions, resolveConfig } from '../core/client/validate';

export type { EmbeddedOptions, PortalOptions, LazorkitOptions } from '../core/client/validate';

/**
 * `mode="embedded"` with `rpId` and `appName`, or `mode="portal"`. No default
 * mode: a 3.x app adds `mode="portal"` to keep its users' wallets.
 */
export type LazorkitProviderProps = LazorkitOptions & { children: ReactNode };

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export const LazorkitProvider = (props: LazorkitProviderProps) => {
  const { children, ...options } = props;
  const o = options as Partial<LazorkitClientConfig> & Record<string, unknown>;

  // Recomputed only when a prop's value changes: an inline object or list
  // with the same content is the same config.
  const config = useMemo(
    () => resolveConfig(options as LazorkitClientConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      o.mode,
      o.rpId,
      o.appName,
      o.rpcUrl,
      o.cluster,
      o.portalUrl,
      o.confirm,
      o.keyStorage,
      o.onConfirmWallet,
      o.onEvent,
      o.session,
      JSON.stringify(o.paymasterConfig ?? null),
      JSON.stringify(o.v1PaymasterConfig ?? null),
      JSON.stringify(o.trustedAuthorities ?? null),
      JSON.stringify(o.watchMints ?? null),
    ],
  );

  // The first configure on the page runs in this render, before any child
  // renders: the first render of the app already shows a restored wallet,
  // and a child's first effect sees it. Nothing has subscribed to the store
  // yet, so no other component is updated mid-render. (While hydrating a
  // server render, the store's server snapshot, disconnected, is what
  // React compares against, so this cannot cause a hydration mismatch.)
  // Later changes of the props go through the layout effect.
  if (typeof window !== 'undefined' && !isConfigured()) configureStore(config);
  useIsomorphicLayoutEffect(() => {
    configureStore(config);
  }, [config]);

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
        await walletRecords().clearWallet();
        useWalletStore.setState({ wallet: null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet, connection]);

  // Session and authority keys an earlier release kept in localStorage as
  // plaintext: moved now, not only when the app next uses one.
  const keyStorage = config.keyStorage ?? 'auto';
  useEffect(() => {
    void migrateLegacyKeys(keyStorage);
  }, [keyStorage]);

  return <>{children}</>;
};
