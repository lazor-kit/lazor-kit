/**
 * LazorKit signed messages, format v1.
 *
 * A passkey signs a WebAuthn challenge, and the LazorKit programs approve a
 * transaction by the challenge in a passkey signature. So `signMessage` never
 * signs the app's bytes as the challenge: a message signature must not be
 * usable as anything else the passkey approves. Every LazorKit `signMessage`
 * (web store and hook, LazorkitWalletAdapter, the Wallet Standard
 * `solana:signMessage`, the mobile adapter) signs this challenge instead:
 *
 *     tag       = UTF-8 "LazorKit signed message v1"     (26 bytes)
 *     challenge = tag || SHA-256(tag || message)        (58 bytes)
 *
 * `message` is the UTF-8 bytes of a string, or the bytes given. Every
 * transaction challenge the LazorKit programs accept is a 32-byte hash, and
 * an ownership-proof challenge is 59 bytes with its own tag (see
 * ./ownershipProof.ts); a message challenge is 58 bytes and starts with this
 * tag, so it can never be one of them.
 *
 * Keep this file the same in @lazorkit/wallet and
 * @lazorkit/wallet-mobile-adapter.
 */

import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
import { p256 } from '@noble/curves/nist.js';

/** The domain tag every LazorKit message challenge starts with (format v1). */
export const SIGNED_MESSAGE_DOMAIN = 'LazorKit signed message v1';

/** A message to sign: a string (signed as its UTF-8 bytes) or bytes. */
export type SignedMessageInput = string | Uint8Array;

/**
 * What a LazorKit `signMessage` returns: the passkey's WebAuthn assertion over
 * `signedMessageChallenge(message)`.
 */
export interface SignMessageResult {
    /** The P-256 signature, 64 bytes (r || s, low-S), base64. */
    readonly signature: string;
    /** What the passkey signed: authenticatorData || SHA-256(clientDataJSON), base64. */
    readonly signedPayload: string;
    /** The WebAuthn clientDataJSON, base64. Its `challenge` is base64url(signedMessageChallenge(message)). */
    readonly clientDataJsonBase64: string;
    /** The WebAuthn authenticatorData, base64. */
    readonly authenticatorDataBase64: string;
}

export interface VerifySignedMessageParams {
    /** The message the app asked to sign: the same string, or the same bytes. */
    readonly message: SignedMessageInput;
    /** The P-256 signature: 64 bytes (r || s), or their base64. */
    readonly signature: string | Uint8Array;
    /** The WebAuthn clientDataJSON, base64. */
    readonly clientDataJsonBase64: string;
    /** The WebAuthn authenticatorData, base64. */
    readonly authenticatorDataBase64: string;
    /** If given, must equal authenticatorData || SHA-256(clientDataJSON) (base64). */
    readonly signedPayload?: string;
    /**
     * The passkey's P-256 public key: 33 bytes (compressed), 65 (uncompressed)
     * or 64 (x || y), as bytes, a number array or base64. To authenticate a
     * wallet, read it from that wallet's authority on chain, never from the
     * client (see `verifyWalletMessage`).
     */
    readonly publicKey: string | Uint8Array | ArrayLike<number>;
    /** If given, the authenticatorData's rpIdHash must be SHA-256 of this rpId (e.g. `portal.lazor.sh`). */
    readonly rpId?: string;
    /** If given, clientDataJSON's `origin` must equal it (e.g. `https://portal.lazor.sh`). */
    readonly origin?: string;
}

function utf8(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text, 'utf8'));
}

const TAG = utf8(SIGNED_MESSAGE_DOMAIN);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function sha256Bytes(data: Uint8Array): Uint8Array {
    return new Uint8Array(sha256.arrayBuffer(data));
}

function messageBytes(message: SignedMessageInput): Uint8Array {
    if (typeof message === 'string') return utf8(message);
    if (ArrayBuffer.isView(message)) {
        return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    }
    throw new TypeError('A message to sign must be a string or a Uint8Array');
}

/** URL-safe base64 with no padding: how clientDataJSON carries a challenge. */
export function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The WebAuthn challenge a LazorKit message signature is made over:
 * `tag || SHA-256(tag || message)`, 58 bytes, where `tag` is
 * `SIGNED_MESSAGE_DOMAIN` in UTF-8.
 */
export function signedMessageChallenge(message: SignedMessageInput): Uint8Array {
    return concat(TAG, sha256Bytes(concat(TAG, messageBytes(message))));
}

/**
 * The text a portal may show for `message`: the string itself, or bytes that
 * are valid UTF-8; `undefined` for other bytes.
 */
export function signedMessageDisplayText(message: SignedMessageInput): string | undefined {
    if (typeof message === 'string') return message;
    if (typeof TextDecoder === 'undefined') return undefined;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(messageBytes(message));
    } catch {
        return undefined;
    }
}

type ClientData = { type?: unknown; challenge?: unknown; origin?: unknown };

function parseClientData(clientDataJsonBase64: string): ClientData | null {
    try {
        const parsed = JSON.parse(Buffer.from(clientDataJsonBase64, 'base64').toString('utf8'));
        return parsed !== null && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Whether `clientDataJsonBase64` is a `webauthn.get` over
 * `signedMessageChallenge(message)`. The SDK checks this on every reply before
 * handing a message signature to the app.
 */
export function isSignedMessageClientData(clientDataJsonBase64: string, message: SignedMessageInput): boolean {
    return isOverMessage(parseClientData(clientDataJsonBase64), message);
}

function isOverMessage(clientData: ClientData | null, message: SignedMessageInput): boolean {
    return (
        clientData !== null &&
        clientData.type === 'webauthn.get' &&
        typeof clientData.challenge === 'string' &&
        clientData.challenge === toBase64Url(signedMessageChallenge(message))
    );
}

function bytesOf(value: string | Uint8Array | ArrayLike<number>): Uint8Array {
    if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'base64'));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return Uint8Array.from(value);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * Checks a LazorKit message signature offline, in a browser, React Native or
 * Node: `true` only when the passkey with `publicKey` signed a `webauthn.get`
 * whose challenge is `signedMessageChallenge(message)`, with the user present.
 * A signature over any other challenge — the raw message bytes included — is
 * `false`. Never throws: malformed input is `false`.
 *
 * This proves that the key `publicKey` signed `message`, and nothing about
 * which wallet that key belongs to. To authenticate a wallet, take the key
 * from the chain, never from the client: the claimed wallet's Secp256r1
 * authority for the passkey's credential, which must still exist — or use
 * `verifyWalletMessage`, which reads it. A server that takes `publicKey` from
 * the request accepts anyone's passkey for any wallet they name. Pass `rpId`
 * and `origin` to pin the passkey's relying party and the page that asked for
 * it.
 */
export function verifySignedMessage(params: VerifySignedMessageParams): boolean {
    try {
        const clientData = parseClientData(params.clientDataJsonBase64);
        if (!clientData || !isOverMessage(clientData, params.message)) return false;
        if (params.origin !== undefined && clientData.origin !== params.origin) return false;

        const authenticatorData = new Uint8Array(Buffer.from(params.authenticatorDataBase64, 'base64'));
        // rpIdHash (32) || flags (1) || signCount (4); the user-present flag must be set.
        if (authenticatorData.length < 37 || (authenticatorData[32] & 0x01) === 0) return false;
        if (params.rpId !== undefined && !equalBytes(authenticatorData.subarray(0, 32), sha256Bytes(utf8(params.rpId)))) {
            return false;
        }

        const clientDataJson = new Uint8Array(Buffer.from(params.clientDataJsonBase64, 'base64'));
        const signed = concat(authenticatorData, sha256Bytes(clientDataJson));
        if (params.signedPayload !== undefined && !equalBytes(bytesOf(params.signedPayload), signed)) return false;

        const signature = bytesOf(params.signature);
        if (signature.length !== 64) return false;
        let publicKey = bytesOf(params.publicKey);
        if (publicKey.length === 64) publicKey = concat(Uint8Array.of(0x04), publicKey);

        return p256.verify(signature, sha256Bytes(signed), publicKey, { prehash: false, lowS: false, format: 'compact' });
    } catch {
        return false;
    }
}
