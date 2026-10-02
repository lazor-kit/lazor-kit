/**
 * The Advanced tier's React hooks (`@lazorkit/wallet/hooks`): the page's
 * client, and the fine-grained status a custom button needs.
 */
import { useSyncExternalStore } from 'react';
import { clientStateOf, getLazorkitClient, type LazorkitClient, type LazorkitClientState } from '../core/client/createClient';
import type { Step, WalletStatus } from '../core/embedded/types';
import { deriveStatus } from '../core/client/createClient';
import { walletStore } from '../core/client/store';
import { useWalletStore } from './store';

/** The page's wallet client (`createLazorkitClient`), the one the provider configures. */
export function useLazorkitClient(): LazorkitClient {
    return getLazorkitClient();
}

/**
 * @experimental `status`, and `step`: the phase of the connect or send that
 * is running (`null` when none is), for a button's label.
 */
export function useWalletStatus(): { status: WalletStatus; step: Step | null } {
    const wallet = useWalletStore((state) => state.wallet);
    const isConnecting = useWalletStore((state) => state.isConnecting);
    const isSigning = useWalletStore((state) => state.isSigning);
    const step = useWalletStore((state) => state.step);
    return { status: deriveStatus({ wallet, isConnecting, isSigning }), step };
}

let serverState: LazorkitClientState | null = null;
/**
 * What a server render saw: the store's initial state (disconnected), as
 * zustand's own hook uses. The provider restores a stored wallet before its
 * children hydrate, so the current state would not match the server's HTML.
 */
const getServerState = (): LazorkitClientState => (serverState ??= clientStateOf(walletStore.getInitialState()));

/** The client's state, as React state (re-renders on every change). */
export function useLazorkitState(): LazorkitClientState {
    const client = getLazorkitClient();
    return useSyncExternalStore(client.subscribe, client.getState, getServerState);
}
