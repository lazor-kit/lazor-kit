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
