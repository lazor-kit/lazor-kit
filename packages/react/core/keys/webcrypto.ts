/**
 * WebCrypto for the keys the SDK keeps (see ./vault): non-extractable Ed25519
 * keys, and AES-GCM for browsers that have no Ed25519 yet.
 *
 * Where this is available: Ed25519 in Chrome / Edge 137+, Firefox 129+,
 * Safari and iOS 17+ (WKWebView included), Android WebView 137+, Node 18.4+.
 * `crypto.subtle` itself only in a secure context (https, localhost).
 *
 * Signatures: Ed25519 is deterministic as RFC 8032 defines it, and Chromium
 * and Node sign so: a key signs exactly as web3.js's `Keypair` does with the
 * same seed. Safari signs with a random nonce: a different signature each
 * time, valid all the same. Nothing in the SDK compares signature bytes, and a session or authority
 * key never signs first (the paymaster's fee payer does), so the transaction
 * id does not depend on it.
 */
import { Buffer } from 'buffer';

const ED25519 = { name: 'Ed25519' } as const;
const AES_GCM = 'AES-GCM';

/** PKCS#8 for a raw 32-byte Ed25519 seed (RFC 8410): this prefix, then the seed. */
const PKCS8_ED25519_PREFIX = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/** `crypto.subtle`, or undefined outside a secure context (or where reading it throws). */
export function subtle(): SubtleCrypto | undefined {
    try {
        return globalThis.crypto?.subtle ?? undefined;
    } catch {
        return undefined;
    }
}

export interface Ed25519Key {
    /** The raw 32-byte public key: the Solana address. */
    readonly publicKey: Uint8Array;
    /** Non-extractable: it signs, and no script can read its secret. */
    readonly privateKey: CryptoKey;
}

let ed25519Support: Promise<boolean> | undefined;

/**
 * Whether this browser signs with non-extractable Ed25519 keys, once per page:
 * one key is generated and must sign a message its exported public key
 * verifies.
 */
export function supportsEd25519(): Promise<boolean> {
    ed25519Support ??= generateEd25519().then(
        (key) => key !== null,
        () => false,
    );
    return ed25519Support;
}

/**
 * A new non-extractable Ed25519 key, probed (see `signsAs`), or null where the
 * browser has none that works. WebKitGTK sometimes makes a key that does not
 * sign as its public key; such a key is thrown away and another made.
 */
export async function generateEd25519(): Promise<Ed25519Key | null> {
    const s = subtle();
    if (!s) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
        let pair: CryptoKeyPair;
        try {
            pair = (await s.generateKey(ED25519, false, ['sign', 'verify'])) as CryptoKeyPair;
        } catch {
            return null; // NotSupportedError: no Ed25519 here.
        }
        try {
            const publicKey = new Uint8Array(await s.exportKey('raw', pair.publicKey));
            if (publicKey.length === 32 && (await signsAs(pair.privateKey, publicKey))) {
                return { publicKey, privateKey: pair.privateKey };
            }
        } catch {
            // Try another key.
        }
    }
    return null;
}

/**
 * `seed`, a key the SDK generated before, as a non-extractable key; null where
 * that cannot be done, or the imported key does not sign as `publicKey`.
 * PKCS#8 first, then JWK, which some engines import where PKCS#8 fails.
 */
export async function importEd25519(seed: Uint8Array, publicKey: Uint8Array): Promise<CryptoKey | null> {
    const s = subtle();
    if (!s || seed.length !== 32 || publicKey.length !== 32) return null;
    const imports: Array<() => Promise<CryptoKey>> = [
        () => s.importKey('pkcs8', concat(PKCS8_ED25519_PREFIX, seed), ED25519, false, ['sign']),
        () =>
            s.importKey(
                'jwk',
                { kty: 'OKP', crv: 'Ed25519', d: base64Url(seed), x: base64Url(publicKey) },
                ED25519,
                false,
                ['sign'],
            ),
    ];
    for (const importKey of imports) {
        try {
            const privateKey = await importKey();
            if (await signsAs(privateKey, publicKey)) return privateKey;
        } catch {
            // The next format.
        }
    }
    return null;
}

/** An Ed25519 signature of `message` by a WebCrypto key. */
export async function signEd25519(privateKey: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
    const s = subtle();
    if (!s) throw new Error('WebCrypto is not available here');
    return new Uint8Array(await s.sign(ED25519, privateKey, copy(message)));
}

/** Whether `privateKey` signs as `publicKey`: one signature, verified against that public key. */
async function signsAs(privateKey: CryptoKey, publicKey: Uint8Array): Promise<boolean> {
    const s = subtle();
    if (!s) return false;
    try {
        const message = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const signature = await s.sign(ED25519, privateKey, message);
        const verifier = await s.importKey('raw', copy(publicKey), ED25519, true, ['verify']);
        return await s.verify(ED25519, verifier, signature, message);
    } catch {
        return false;
    }
}

// ─── AES-GCM, for a seed kept where Ed25519 is not available ────────────────

/** A sealed seed: AES-GCM ciphertext (with its tag) and the nonce. */
export interface Sealed {
    readonly iv: Uint8Array;
    readonly ct: Uint8Array;
}

/** A new non-extractable AES-GCM-256 key, or null without WebCrypto. */
export async function generateWrapKey(): Promise<CryptoKey | null> {
    const s = subtle();
    if (!s) return null;
    try {
        return await s.generateKey({ name: AES_GCM, length: 256 }, false, ['encrypt', 'decrypt']);
    } catch {
        return null;
    }
}

/** `plaintext` encrypted under `key`, bound to `context` (additional data). */
export async function seal(key: CryptoKey, plaintext: Uint8Array, context: string): Promise<Sealed> {
    const s = subtle();
    if (!s) throw new Error('WebCrypto is not available here');
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
        await s.encrypt({ name: AES_GCM, iv, additionalData: utf8(context) }, key, copy(plaintext)),
    );
    return { iv, ct };
}

/** The plaintext of `sealed`; throws when `key` or `context` is not the one it was sealed with. */
export async function unseal(key: CryptoKey, sealed: Sealed, context: string): Promise<Uint8Array> {
    const s = subtle();
    if (!s) throw new Error('WebCrypto is not available here');
    return new Uint8Array(
        await s.decrypt({ name: AES_GCM, iv: copy(sealed.iv), additionalData: utf8(context) }, key, copy(sealed.ct)),
    );
}

// ─── Bytes ──────────────────────────────────────────────────────────────────

/** A copy backed by its own ArrayBuffer, as WebCrypto takes it. */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return new Uint8Array(bytes);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function base64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}
