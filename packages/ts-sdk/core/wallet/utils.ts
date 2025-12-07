import { sha256 } from 'js-sha256';
import { DialogManager } from '../portal';
import { WalletConfig } from '../storage';
import { WalletState } from '../types';

/**
 * Creates a configured DialogManager instance
 */
export const createDialogManager = (config: WalletConfig): DialogManager => {
    return new DialogManager({
        portalUrl: config.portalUrl,
        rpcUrl: config.rpcUrl,
        paymasterUrl: config.paymasterUrl,
    });
};

/**
 * Computes the credential hash from a base64 credential ID
 */
export const getCredentialHash = (credentialIdBase64: string): number[] => {
    return Array.from(
        new Uint8Array(
            sha256.arrayBuffer(Buffer.from(credentialIdBase64, 'base64'))
        )
    );
};

/**
 * Standardized error handling for wallet actions
 */
export const handleActionError = (
    error: unknown,
    set: (state: Partial<WalletState>) => void,
    onFail?: (error: Error) => void
): never => {
    const err = error instanceof Error ? error : new Error(String(error));
    set({ error: err });
    onFail?.(err);
    throw err;
};

/**
 * Cleans up legacy local storage data
 */
export const cleanupLegacyStorage = (): void => {
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
export const getPasskeyPublicKey = (publicKeyBase64: string | undefined): number[] => {
    return publicKeyBase64
        ? Array.from(Buffer.from(publicKeyBase64, 'base64'))
        : [];
};
