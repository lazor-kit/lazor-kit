/**
 * The React binding of the page's one wallet store (core/client/store): the
 * hook `useWalletStore(selector)`, with the store's own `getState`,
 * `setState`, `subscribe` and `persist` on it, as in 3.x.
 */
import { useStore, type UseBoundStore } from 'zustand';
import { walletStore } from '../core/client/store';
import type { WalletState } from '../core/types';

export const useWalletStore = Object.assign(
    (selector?: (state: WalletState) => unknown) => useStore(walletStore, selector as (state: WalletState) => unknown),
    walletStore,
) as UseBoundStore<typeof walletStore>;
