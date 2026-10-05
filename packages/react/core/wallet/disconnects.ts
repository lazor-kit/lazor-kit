/**
 * The disconnects on this page, whichever way they came: the store's
 * `disconnect`, `LazorkitWalletAdapter.disconnect`, and the Wallet Standard
 * `standard:disconnect` (which calls the adapter's).
 *
 * - A session or authority send that loaded its kept key before a disconnect
 *   neither signs nor sends after it (see ./keyBinding): the key compares
 *   `disconnectMark()` with the one read when the send loaded it, right
 *   before it signs and right before each attempt to send.
 * - The adapter's disconnect disconnects the store too (core/client/store
 *   listens with `onAdapterDisconnect`), in either mode. A store left
 *   connected would let a kept key sign after the sign-out.
 *
 * Counted per copy of the package, as the store is one per copy.
 */

let disconnects = 0;
const adapterListeners = new Set<() => void>();

/** How many disconnects this page has seen. Read when a send loads its key. */
export function disconnectMark(): number {
    return disconnects;
}

/** Counts a disconnect of the store, which resets itself (see `disconnectAction`). */
export function noteDisconnect(): void {
    disconnects++;
}

/**
 * Counts a disconnect of the wallet-adapter (or the Wallet Standard wallet)
 * and runs the `onAdapterDisconnect` listeners: the store disconnects. A
 * listener that throws is logged, and the others still run.
 */
export function noteAdapterDisconnect(): void {
    disconnects++;
    for (const listener of [...adapterListeners]) {
        try {
            listener();
        } catch (error) {
            console.error('[LazorKit] An adapter disconnect listener threw:', error);
        }
    }
}

/** Runs `listener` on every adapter disconnect, until the returned function removes it. */
export function onAdapterDisconnect(listener: () => void): () => void {
    adapterListeners.add(listener);
    return () => {
        adapterListeners.delete(listener);
    };
}
