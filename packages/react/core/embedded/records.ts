/**
 * What Embedded mode keeps on this device besides the connected wallet's
 * record, under `lazorkit:embedded:<rpId>:`. Nothing here is a secret.
 *
 * - `known`: the credential ids of this app's passkeys seen on this device (at
 *   most 10, newest last), for `excludeCredentials`: an authenticator that
 *   already holds one refuses to create a second. Kept across `disconnect`.
 * - `pending:<credentialId>`: a passkey created here whose wallet has not
 *   landed yet: its public key and the seed it was created with. A later
 *   sign-in with it then creates the wallet with no second prompt, at the seed
 *   its `userHandle` names. Deleted once the wallet is created; kept across
 *   `disconnect`.
 *
 * `forgetEmbeddedDevice(rpId)` deletes both.
 */
import { EMBEDDED_PREFIX, syncStorage } from '../storage';
import { fromB64Url, toB64, toB64Url, fromB64 } from './webauthn';

const MAX_KNOWN = 10;

const knownKey = (rpId: string) => `${EMBEDDED_PREFIX}${rpId}:known`;
const pendingKey = (rpId: string, credentialId: Uint8Array) => `${EMBEDDED_PREFIX}${rpId}:pending:${toB64Url(credentialId)}`;

/** The credential ids of this app's passkeys known on this device. */
export function knownCredentials(rpId: string): Uint8Array[] {
    try {
        const raw = syncStorage.getItem(knownKey(rpId));
        const ids = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').map(fromB64Url) : [];
    } catch {
        return [];
    }
}

/** Remember a credential id of this app's on this device. */
export function rememberCredential(rpId: string, credentialId: Uint8Array): void {
    const id = toB64Url(credentialId);
    const ids = knownCredentials(rpId)
        .map(toB64Url)
        .filter((known) => known !== id);
    ids.push(id);
    syncStorage.setItem(knownKey(rpId), JSON.stringify(ids.slice(-MAX_KNOWN)));
}

/** A passkey created here whose wallet has not landed yet. */
export interface PendingCreation {
    /** 33-byte compressed P-256 key, from the attestation. */
    publicKey: Uint8Array;
    /** The seed it was created with (`user.id`): its wallet is at `findWallet(seed)`. */
    seed: Uint8Array;
    name: string;
    createdAt: string;
}

export function savePending(rpId: string, credentialId: Uint8Array, pending: PendingCreation): void {
    syncStorage.setItem(
        pendingKey(rpId, credentialId),
        JSON.stringify({ publicKey: toB64(pending.publicKey), seed: toB64(pending.seed), name: pending.name, createdAt: pending.createdAt }),
    );
}

export function loadPending(rpId: string, credentialId: Uint8Array): PendingCreation | null {
    try {
        const raw = syncStorage.getItem(pendingKey(rpId, credentialId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { publicKey?: unknown; seed?: unknown; name?: unknown; createdAt?: unknown };
        if (typeof parsed.publicKey !== 'string' || typeof parsed.seed !== 'string') return null;
        const publicKey = fromB64(parsed.publicKey);
        const seed = fromB64(parsed.seed);
        if (publicKey.length !== 33 || seed.length !== 32) return null;
        return {
            publicKey,
            seed,
            name: typeof parsed.name === 'string' ? parsed.name : '',
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
        };
    } catch {
        return null;
    }
}

export function deletePending(rpId: string, credentialId: Uint8Array): void {
    syncStorage.removeItem(pendingKey(rpId, credentialId));
}

/**
 * Forget the credential ids and pending creations Embedded mode keeps on this
 * device for `rpId` (not the connected wallet: `disconnect()` forgets that).
 * Passkeys and wallets stay; "Continue with passkey" finds them again.
 */
export function forgetEmbeddedDevice(rpId: string): void {
    if (typeof localStorage === 'undefined') return;
    const pending = `${EMBEDDED_PREFIX}${rpId}:pending:`;
    try {
        const keys: string[] = [knownKey(rpId)];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(pending)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
    } catch {
        // Storage blocked: nothing was kept either.
    }
}
