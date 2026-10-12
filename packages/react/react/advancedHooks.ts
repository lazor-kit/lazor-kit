/**
 * The Advanced tier's action hooks (`@lazorkit/wallet/hooks`): sessions,
 * Ed25519 authorities and deferred execution, with the same names and
 * parameters as `useWallet()`'s, which warn that they move here. These are
 * the same store actions, without the warning.
 */
import { useMemo } from 'react';
import { useWalletStore } from './store';
import type { WalletHookInterface } from './useWallet';

/** `createSession`, `revokeSession` and `signAndSendWithSession`, as `useWallet()` has them. */
export type SessionsHook = Pick<WalletHookInterface, 'createSession' | 'revokeSession' | 'signAndSendWithSession'>;
/** `addAuthority`, `removeAuthority` and `signAndSendWithAuthority`, as `useWallet()` has them. */
export type AuthoritiesHook = Pick<WalletHookInterface, 'addAuthority' | 'removeAuthority' | 'signAndSendWithAuthority'>;
/** `authorizeAndExecute`, `authorizeDeferred` and `executeDeferred`, as `useWallet()` has them. */
export type DeferredHook = Pick<WalletHookInterface, 'authorizeAndExecute' | 'authorizeDeferred' | 'executeDeferred'>;

/**
 * Session keys: `createSession` (one passkey approval; the portal shows the
 * limits and when it ends), `signAndSendWithSession` (no prompt, while the
 * session's wallet is connected) and `revokeSession`.
 */
export function useSessions(): SessionsHook {
    const createSession = useWalletStore((state) => state.createSession);
    const revokeSession = useWalletStore((state) => state.revokeSession);
    const signAndSendWithSession = useWalletStore((state) => state.signAndSendWithSession);
    return useMemo<SessionsHook>(
        () => ({
            createSession: (payload) => createSession(payload),
            revokeSession: (payload) => revokeSession(payload),
            signAndSendWithSession: (payload) => signAndSendWithSession(payload),
        }),
        [createSession, revokeSession, signAndSendWithSession],
    );
}

/** Ed25519 authorities the SDK generates and keeps: add one, remove one, send with it. */
export function useAuthorities(): AuthoritiesHook {
    const addAuthority = useWalletStore((state) => state.addAuthority);
    const removeAuthority = useWalletStore((state) => state.removeAuthority);
    const signAndSendWithAuthority = useWalletStore((state) => state.signAndSendWithAuthority);
    return useMemo<AuthoritiesHook>(
        () => ({
            addAuthority: (payload) => addAuthority(payload),
            removeAuthority: (target, options) => removeAuthority(target, options),
            signAndSendWithAuthority: (payload) => signAndSendWithAuthority(payload),
        }),
        [addAuthority, removeAuthority, signAndSendWithAuthority],
    );
}

/** Deferred execution: authorize (TX1, the passkey) and execute (TX2, no passkey), together or apart. */
export function useDeferred(): DeferredHook {
    const authorizeAndExecute = useWalletStore((state) => state.authorizeAndExecute);
    const authorizeDeferred = useWalletStore((state) => state.authorizeDeferred);
    const executeDeferred = useWalletStore((state) => state.executeDeferred);
    return useMemo<DeferredHook>(
        () => ({
            authorizeAndExecute: (payload) => authorizeAndExecute(payload),
            authorizeDeferred: (payload) => authorizeDeferred(payload),
            executeDeferred: (payload) => executeDeferred(payload),
        }),
        [authorizeAndExecute, authorizeDeferred, executeDeferred],
    );
}
