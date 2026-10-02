import { sha256 } from 'js-sha256';
// The package, not the Node global: a browser app has no global `Buffer`
// unless it polyfills one.
import { Buffer } from 'buffer';
import {
    RETIRED_DEPLOYMENT_CODE,
    V1WalletMigratedError,
    V1WalletRetiredError,
    isRetiredDeploymentError,
    type ProtocolVersion,
} from '../program/protocol';
import { isNamedError } from '../program/errorShape';
import { StorageManager } from '../storage';
import { DialogManager } from '../portal';
import { WalletConfig } from '../storage';
import type { ActionCallbacks, WalletState } from '../types';

/**
 * Creates a configured DialogManager instance
 */
export const createDialogManager = (config: WalletConfig): DialogManager => {
    return new DialogManager({
        portalUrl: config.portalUrl,
        rpcUrl: config.rpcUrl,
        paymasterUrl: config.paymasterConfig.paymasterUrl,
    });
};

/**
 * WebAuthn RP ID for a given portal URL. WebAuthn spec requires an effective
 * domain (hostname only — no protocol, no port), which is what we derive here.
 * The returned value must match what the portal uses at credential registration
 * time, otherwise secp256r1 signature verification will reject the assertion.
 */
export const getPortalRpId = (portalUrl: string): string => {
    return new URL(portalUrl).hostname;
};

/**
 * Computes the credential hash from a base64 credential ID
 */
export const getCredentialHash = (credentialIdBase64: string): Uint8Array => {
    return new Uint8Array(
        sha256.arrayBuffer(Buffer.from(credentialIdBase64, 'base64'))
    );
};

/**
 * The error a wallet action reports. A v1 wallet after LazorKit v1 was
 * retired gets `V1WalletRetiredError`, which says what happened and what to
 * do, rather than a bare `custom program error: 0xfb2`; one that already is
 * that error is reported as it is.
 */
export const toActionError = (error: unknown, version?: ProtocolVersion): Error => {
    if (error instanceof V1WalletRetiredError || isNamedError(error, 'V1WalletRetiredError', RETIRED_DEPLOYMENT_CODE)) {
        return error as Error;
    }
    if (isRetiredDeploymentError(error, version)) return new V1WalletRetiredError(error);
    return error instanceof Error ? error : new Error(String(error));
};

/**
 * Standardized error handling for wallet actions: records the error in the
 * store and throws it. The action's `onFail` is called by the store, once the
 * action is over (see `reportOutcome`).
 */
export const handleActionError = (
    error: unknown,
    set: (state: Partial<WalletState>) => void,
    /** The protocol of the wallet the action ran for, when there was one. */
    version?: ProtocolVersion,
): never => {
    const err = toActionError(error, version);
    if (err instanceof V1WalletMigratedError) {
        // The stored wallet is gone from the chain; stop showing its address.
        void StorageManager.clearWallet();
        set({ wallet: null });
    }
    set({ error: err });
    throw err;
};

/**
 * Runs a store action and reports its outcome to `callbacks`: `onSuccess`
 * with what the promise resolves with, or `onFail` with the error it rejects
 * with, refusals included ("Already signing", no wallet). The callback runs
 * once the action is over, with `isSigning` / `isConnecting` already cleared,
 * and right before the returned promise settles. So a send started from
 * `onSuccess` runs, as one started on the line after `await` does.
 *
 * What a callback throws is the app's own bug: it is logged, and it changes
 * nothing. A transaction that landed is never reported as failed, `onFail` is
 * not called for it, and a throwing `onFail` does not replace the error.
 */
export async function reportOutcome<T>(
    callbacks: ActionCallbacks<T> | undefined,
    action: () => Promise<T>,
): Promise<T> {
    let result: T;
    try {
        result = await action();
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        notify(callbacks?.onFail, err);
        throw err;
    }
    notify(callbacks?.onSuccess, result);
    return result;
}

/** Calls an app's callback. What it throws is logged, and does not change the action's outcome. */
function notify<A>(callback: ((arg: A) => void) | undefined, arg: A): void {
    if (!callback) return;
    try {
        callback(arg);
    } catch (error) {
        console.error('[LazorKit] A wallet action callback threw:', error);
    }
}

/**
 * Cleans up legacy local storage data
 */
export const cleanupLegacyStorage = (): void => {
    if (typeof window === 'undefined') return;
    const oldZustandData = localStorage.getItem('lazorkit-wallet');
    if (oldZustandData) {
        try {
            const parsed = JSON.parse(oldZustandData);
            if (parsed.state && parsed.version !== undefined) {
                localStorage.removeItem('lazorkit-wallet');
            }
        } catch (e) {
            // Ignore parse errors
        }
    }
};

/**
 * Converts base64 public key to number array
 */
export const getPasskeyPublicKey = (publicKeyBase64: string | undefined): Uint8Array => {
    if (!publicKeyBase64) {
        return new Uint8Array(0); // Return empty Uint8Array instead of []
    }

    // Buffer.from returns a Buffer, which is a subclass of Uint8Array
    return new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));
};
