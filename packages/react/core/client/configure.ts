/**
 * Applies a config to the page's one store, synchronously: its mode's
 * storage namespace, the stored wallet (restored at once when valid), the
 * connection, and what this page can do with passkeys.
 *
 * Order matters (zustand's persist writes on every `setState`, under the
 * current name): first point the store at the namespace and set which stored
 * wallet is valid, then read it back, and only then set the config. So a
 * page that switches mode never writes one mode's state into the other's
 * key, and a stored config never replaces the app's props.
 */
import { StorageManager, embeddedWalletRecords, setWalletRecords, type WalletConfig } from '../storage';
import { registerCluster } from '../program';
import { emit } from '../embedded/events';
import { passkeyCapabilities } from '../embedded/webauthn';
import { abandonConnect } from '../wallet/actions';
import { pageAvailability } from './environment';
import { walletStore, storeNameFor } from './store';
import { acceptStoredWallet, programIdsFor, sameConfig } from './validate';

/** The namespace the store was last read from; `null` before the first configure. */
let hydratedName: string | null = null;
/** The config last applied. */
let applied: WalletConfig | null = null;

/** The config last applied, `null` before the first configure. */
export function currentConfig(): WalletConfig | null {
    return applied;
}

/** Whether configure has run on this page. */
export function isConfigured(): boolean {
    return applied !== null;
}

/**
 * Apply `config` (from `resolveConfig`) to the store. Synchronous: when it
 * returns, a valid stored wallet is in the state. Calling it again with an
 * equal config does nothing.
 */
export function configureStore(config: WalletConfig): void {
    registerCluster(config.rpcUrl, config.cluster);
    const name = storeNameFor(config);
    let restored = false;
    if (name !== hydratedName) {
        // Another mode or rpId: a connect running for the old one saves nothing.
        if (hydratedName !== null) abandonConnect();
        const programIds = programIdsFor(config);
        walletStore.persist.setOptions({
            name,
            merge: (persisted, current) => ({
                ...current,
                wallet: acceptStoredWallet((persisted as { wallet?: unknown } | undefined)?.wallet, config, programIds),
            }),
        });
        setWalletRecords(config.mode === 'embedded' ? embeddedWalletRecords(config.rpId!) : StorageManager);
        // Synchronous storage: the state holds the wallet when this returns.
        void walletStore.persist.rehydrate();
        hydratedName = name;
        restored = walletStore.getState().wallet !== null;
    }
    if (!applied || !sameConfig(applied, config)) walletStore.getState().setConfig(config);
    applied = config;

    if (typeof window !== 'undefined') {
        const { availability } = pageAvailability(config);
        if (walletStore.getState().availability !== availability) walletStore.setState({ availability });
        if (config.mode === 'embedded') void passkeyCapabilities();
    }
    if (restored && config.mode === 'embedded') emit(config, { type: 'connected', how: 'restored', signatures: [] });
}
