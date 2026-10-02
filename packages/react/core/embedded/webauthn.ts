/**
 * Embedded mode's passkey ceremonies: the app's page calls WebAuthn itself,
 * under the app's `rpId`. No portal, no iframe, no popup, no `postMessage`.
 *
 * - `discover`: the first `get()` of a connect, with no `allowCredentials`.
 *   Chrome's immediate mode (`uiMode: 'immediate'`, top level of the
 *   options) when the browser says it has it (`getClientCapabilities()
 *   .immediateGet`) and the call runs in a user gesture: then a user with no
 *   passkey here gets `NotAllowedError` at once instead of a sheet to close.
 *   After one immediate failure, every later call on the page is modal: an
 *   immediate get also fails when the passkey is only on a phone, and the user
 *   picks "another device" for that (`hints: ['hybrid']`).
 * - `assertPinned`: a `get()` with the one credential as `allowCredentials`,
 *   for a signature (`openSign`, `openSignMessage`) or a second proof. A
 *   reply from another credential is refused (`PasskeyMismatchError`).
 * - `createPasskey`: `create()` with `user.id` = the wallet's seed.
 * - `startConditional`: passkey autofill (conditional mediation).
 *
 * Every modal or immediate ceremony aborts a pending autofill first: a page
 * can hold one WebAuthn request at a time.
 */
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
import { p256 } from '@noble/curves/nist.js';
import { LazorkitConfigError, PasskeyMismatchError, PasskeyUnavailableError } from '../errors';
import type { WalletConfig } from '../storage';
import { ceremony } from './events';
import type { CeremonyKind } from './types';

// ─── Bytes ──────────────────────────────────────────────────────────────────

export const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const toB64Url = (bytes: Uint8Array): string =>
    toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
export const fromB64Url = (text: string): Uint8Array =>
    new Uint8Array(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
export const sha256Bytes = (data: Uint8Array): Uint8Array => new Uint8Array(sha256.arrayBuffer(data));
export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);
const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));
/** A copy with its own ArrayBuffer, as the WebAuthn typings want. */
const buffer = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
const bytesOf = (value: ArrayBuffer | ArrayBufferView): Uint8Array =>
    value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();

// ─── Signatures and keys ────────────────────────────────────────────────────

const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/**
 * An ES256 signature as the secp256r1 precompile takes it: 64 bytes r ‖ s
 * with a low S (the program refuses a high one). The browser returns DER;
 * 64 bytes r ‖ s is taken too.
 */
export function derToLowS(signature: Uint8Array): Uint8Array {
    const sig =
        signature.length === 64
            ? p256.Signature.fromBytes(signature, 'compact')
            : p256.Signature.fromBytes(signature, 'der');
    const s = sig.s > P256_N / 2n ? P256_N - sig.s : sig.s;
    return new p256.Signature(sig.r, s).toBytes('compact');
}

const compress = (x: Uint8Array, y: Uint8Array): Uint8Array => {
    const out = new Uint8Array(33);
    out[0] = 0x02 | (y[31] & 1);
    out.set(x, 1);
    return out;
};

/** Minimal CBOR: enough for an attestation object and a COSE key. */
function cbor(buf: Uint8Array, pos: number): [unknown, number] {
    const initial = buf[pos++];
    const major = initial >> 5;
    const info = initial & 31;
    let n: number;
    if (info < 24) n = info;
    else if (info === 24) n = buf[pos++];
    else if (info === 25) {
        n = (buf[pos] << 8) | buf[pos + 1];
        pos += 2;
    } else if (info === 26) {
        n = buf[pos] * 2 ** 24 + ((buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]);
        pos += 4;
    } else throw new Error(`CBOR: unsupported length encoding ${info}`);
    switch (major) {
        case 0:
            return [n, pos];
        case 1:
            return [-1 - n, pos];
        case 2:
            return [buf.slice(pos, pos + n), pos + n];
        case 3:
            return [Buffer.from(buf.slice(pos, pos + n)).toString('utf8'), pos + n];
        case 4: {
            const items: unknown[] = [];
            for (let i = 0; i < n; i++) {
                const [value, next] = cbor(buf, pos);
                items.push(value);
                pos = next;
            }
            return [items, pos];
        }
        case 5: {
            const map = new Map<unknown, unknown>();
            for (let i = 0; i < n; i++) {
                const [key, afterKey] = cbor(buf, pos);
                const [value, afterValue] = cbor(buf, afterKey);
                map.set(key, value);
                pos = afterValue;
            }
            return [map, pos];
        }
        default:
            throw new Error(`CBOR: unsupported major type ${major}`);
    }
}

/** The authenticator data of a registration: `getAuthenticatorData()`, else from the attestation object. */
export function attestationAuthData(response: {
    getAuthenticatorData?: () => ArrayBuffer;
    attestationObject: ArrayBuffer;
}): Uint8Array {
    if (typeof response.getAuthenticatorData === 'function') {
        const data = response.getAuthenticatorData();
        if (data && data.byteLength >= 37) return bytesOf(data);
    }
    const [attestation] = cbor(bytesOf(response.attestationObject), 0);
    const authData = (attestation as Map<unknown, unknown>).get('authData');
    if (!(authData instanceof Uint8Array)) throw new Error('The attestation has no authenticator data');
    return authData;
}

/**
 * The 33-byte compressed P-256 key of a passkey just registered: from the
 * COSE key in its authenticator data (what the authenticator attested), else
 * from `getPublicKey()`.
 */
export function publicKeyFromAttestation(response: {
    getPublicKey?: () => ArrayBuffer | null;
    getAuthenticatorData?: () => ArrayBuffer;
    attestationObject: ArrayBuffer;
}): Uint8Array {
    let authData: Uint8Array | undefined;
    try {
        authData = attestationAuthData(response);
    } catch {
        authData = undefined;
    }
    // Flags bit 6 (AT): attested credential data follows the 37-byte header.
    if (authData && authData.length > 55 && authData[32] & 0x40) {
        const idLength = (authData[53] << 8) | authData[54];
        const [cose] = cbor(authData, 55 + idLength);
        const key = cose as Map<number, unknown>;
        if (key.get(3) !== -7) throw new Error(`The passkey uses algorithm ${String(key.get(3))}, not ES256 (-7)`);
        const x = key.get(-2);
        const y = key.get(-3);
        if (x instanceof Uint8Array && y instanceof Uint8Array && x.length === 32 && y.length === 32) return compress(x, y);
    }
    const spki = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
    if (spki && spki.byteLength >= 65) {
        const point = bytesOf(spki).slice(-65);
        if (point[0] === 0x04) return compress(point.subarray(1, 33), point.subarray(33, 65));
    }
    throw new Error('The new passkey did not report a P-256 public key');
}

/** Whether authenticator data was made under `rpId`: its first 32 bytes are SHA-256(rpId). */
export function isUnderRpId(authenticatorData: Uint8Array, rpId: string): boolean {
    return authenticatorData.length >= 32 && bytesEqual(authenticatorData.subarray(0, 32), sha256Bytes(utf8(rpId)));
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export interface PasskeyCapabilities {
    /** `navigator.credentials` and `PublicKeyCredential` exist. */
    webauthn: boolean;
    /** Chrome's immediate mediation (`getClientCapabilities().immediateGet`). */
    immediateGet: boolean;
    /** Passkey autofill (`isConditionalMediationAvailable()`). */
    conditionalGet: boolean;
}

type PublicKeyCredentialStatics = {
    getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
    isConditionalMediationAvailable?: () => Promise<boolean>;
};

function credentialStatics(): PublicKeyCredentialStatics | undefined {
    const pkc = (globalThis as { PublicKeyCredential?: PublicKeyCredentialStatics }).PublicKeyCredential;
    return pkc ?? undefined;
}

export function hasWebAuthn(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.credentials?.get === 'function' &&
        typeof navigator.credentials?.create === 'function' &&
        credentialStatics() !== undefined
    );
}

let cachedCapabilities: PasskeyCapabilities | null = null;
let capabilitiesRead: Promise<PasskeyCapabilities> | null = null;

/** What this browser's WebAuthn can do. Read once per page; never throws. */
export function passkeyCapabilities(): Promise<PasskeyCapabilities> {
    if (!capabilitiesRead) {
        capabilitiesRead = (async () => {
            const statics = credentialStatics();
            const caps: PasskeyCapabilities = { webauthn: hasWebAuthn(), immediateGet: false, conditionalGet: false };
            if (!caps.webauthn || !statics) return (cachedCapabilities = caps);
            try {
                const reported = await statics.getClientCapabilities?.();
                caps.immediateGet = reported?.immediateGet === true;
                if (reported?.conditionalGet === true) caps.conditionalGet = true;
            } catch {
                // Not supported: no immediate mode.
            }
            if (!caps.conditionalGet) {
                try {
                    caps.conditionalGet = (await statics.isConditionalMediationAvailable?.()) === true;
                } catch {
                    caps.conditionalGet = false;
                }
            }
            return (cachedCapabilities = caps);
        })();
    }
    return capabilitiesRead;
}

/** The capabilities, if they have been read yet: a click handler never awaits them. */
export function knownCapabilities(): PasskeyCapabilities | null {
    return cachedCapabilities;
}

/** Forget what was read (tests load a new browser on the same page). */
export function resetCapabilities(): void {
    cachedCapabilities = null;
    capabilitiesRead = null;
    immediateFailed = false;
}

/** An immediate get failed on this page: from now on every get is modal. */
let immediateFailed = false;

// ─── Ceremonies ─────────────────────────────────────────────────────────────

/** An assertion, raw from the browser. */
export interface Assertion {
    rawId: Uint8Array;
    /** DER, as the browser returns it. */
    signature: Uint8Array;
    authenticatorData: Uint8Array;
    clientDataJson: Uint8Array;
    /** The credential's `user.id`: a wallet's 32-byte seed for passkeys this SDK creates. */
    userHandle: Uint8Array | null;
}

function toAssertion(credential: Credential | null): Assertion {
    if (!credential || credential.type !== 'public-key') throw new Error('No passkey was returned');
    const pk = credential as PublicKeyCredential;
    const response = pk.response as AuthenticatorAssertionResponse;
    return {
        rawId: bytesOf(pk.rawId),
        signature: bytesOf(response.signature),
        authenticatorData: bytesOf(response.authenticatorData),
        clientDataJson: bytesOf(response.clientDataJSON),
        userHandle: response.userHandle ? bytesOf(response.userHandle) : null,
    };
}

export const isDomError = (error: unknown, name: string): boolean =>
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;

/**
 * A ceremony's failure as the SDK reports it: the browser refusing this rpId
 * for this page is a configuration error; one that cannot run here at all is
 * `PasskeyUnavailableError`. `NotAllowedError`, `InvalidStateError` and
 * `AbortError` are passed on for the caller to read.
 */
export function ceremonyError(error: unknown, rpId: string): unknown {
    if (isDomError(error, 'SecurityError')) {
        return new LazorkitConfigError(
            'rp-id-refused',
            `The browser refused rpId "${rpId}" for this page (${typeof location === 'undefined' ? 'unknown origin' : location.origin}). ` +
                'rpId must be this page\'s host or a registrable parent of it, or list this origin in ' +
                `https://${rpId}/.well-known/webauthn (Related Origins).`,
            error,
        );
    }
    if (isDomError(error, 'NotSupportedError')) return new PasskeyUnavailableError(undefined, error);
    return error;
}

/** The autofill request this page holds, if any: every other ceremony aborts it first. */
let autofill: AbortController | null = null;

/** Abort a pending autofill and let the browser drop it before a modal request. */
export async function abortAutofill(): Promise<void> {
    if (!autofill) return;
    autofill.abort();
    autofill = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
}

type GetOptions = CredentialRequestOptions & { uiMode?: 'immediate' };

async function get(options: GetOptions, rpId: string): Promise<Assertion> {
    if (!hasWebAuthn()) throw new PasskeyUnavailableError();
    try {
        return toAssertion(await navigator.credentials.get(options));
    } catch (error) {
        throw ceremonyError(error, rpId);
    }
}

const publicKeyGet = (rpId: string, challenge: Uint8Array, credentialId?: Uint8Array) => ({
    challenge: buffer(challenge),
    rpId,
    allowCredentials: credentialId ? [{ type: 'public-key' as const, id: buffer(credentialId) }] : [],
    userVerification: 'preferred' as const,
    timeout: 120_000,
});

/**
 * Step 1 of a connect: any passkey this rpId has, over `challenge`. `null`
 * when none came back (`NotAllowedError`: none here, or the sheet was closed;
 * the browser does not say which). Never creates one.
 */
export async function discover(
    config: WalletConfig,
    params: { rpId: string; challenge: Uint8Array; signal?: AbortSignal },
): Promise<Assertion | null> {
    await abortAutofill();
    const caps = knownCapabilities();
    const activation = (globalThis as { navigator?: { userActivation?: { isActive?: boolean } } }).navigator
        ?.userActivation?.isActive;
    // Immediate mode needs a user gesture: without one Chrome rejects it, and a
    // returning user would be offered to create a passkey.
    const immediate = caps?.immediateGet === true && !immediateFailed && activation === true;
    const kind: CeremonyKind = immediate ? 'get:immediate' : 'get';
    try {
        return await ceremony(config, kind, () =>
            get(
                {
                    publicKey: publicKeyGet(params.rpId, params.challenge),
                    signal: params.signal,
                    ...(immediate ? { uiMode: 'immediate' as const } : { mediation: 'optional' as const }),
                },
                params.rpId,
            ),
        );
    } catch (error) {
        if (isDomError(error, 'NotAllowedError')) {
            if (immediate) immediateFailed = true;
            return null;
        }
        throw error;
    }
}

/**
 * "Use a passkey on another device": a modal get that offers the phone or
 * security key first (`hints: ['hybrid']`), over a fresh challenge. Never
 * immediate. `null` when the sheet was closed.
 */
export async function discoverOnAnotherDevice(
    config: WalletConfig,
    params: { rpId: string; challenge: Uint8Array; signal?: AbortSignal },
): Promise<Assertion | null> {
    await abortAutofill();
    try {
        return await ceremony(config, 'get:hybrid', () =>
            get(
                {
                    mediation: 'optional',
                    signal: params.signal,
                    publicKey: { ...publicKeyGet(params.rpId, params.challenge), hints: ['hybrid'] } as PublicKeyCredentialRequestOptions,
                },
                params.rpId,
            ),
        );
    } catch (error) {
        if (isDomError(error, 'NotAllowedError')) return null;
        throw error;
    }
}

/**
 * One assertion from exactly this credential, over `challenge`. Throws
 * `PasskeyMismatchError` when another credential answered, and passes the
 * browser's `NotAllowedError` on (the sheet was closed).
 */
export async function assertPinned(
    config: WalletConfig,
    kind: CeremonyKind,
    params: { rpId: string; challenge: Uint8Array; credentialId: Uint8Array; signal?: AbortSignal },
): Promise<Assertion> {
    await abortAutofill();
    const assertion = await ceremony(config, kind, () =>
        get(
            {
                mediation: 'optional',
                signal: params.signal,
                publicKey: publicKeyGet(params.rpId, params.challenge, params.credentialId),
            },
            params.rpId,
        ),
    );
    if (!bytesEqual(assertion.rawId, params.credentialId)) throw new PasskeyMismatchError();
    return assertion;
}

export interface CreatedPasskey {
    rawId: Uint8Array;
    /** 33-byte compressed P-256 key. */
    publicKey: Uint8Array;
    authenticatorData: Uint8Array;
}

/**
 * Register a passkey under `rpId`. `userId` is the wallet's seed, so a later
 * sign-in finds the wallet from the passkey alone (`userHandle`). Only ES256;
 * a resident key; no attestation. `exclude`: this app's passkeys known on this
 * device, so an authenticator that holds one refuses (`InvalidStateError`).
 * Refuses a passkey whose authenticator data is not under `rpId`: a wallet
 * created for it could never sign.
 */
export async function createPasskey(
    config: WalletConfig,
    params: {
        rpId: string;
        rpName: string;
        userId: Uint8Array;
        name: string;
        exclude: Uint8Array[];
        signal?: AbortSignal;
    },
): Promise<CreatedPasskey> {
    if (!hasWebAuthn()) throw new PasskeyUnavailableError();
    await abortAutofill();
    return ceremony(config, 'create', async () => {
        let credential: PublicKeyCredential | null;
        try {
            credential = (await navigator.credentials.create({
                signal: params.signal,
                publicKey: {
                    rp: { id: params.rpId, name: params.rpName },
                    user: { id: buffer(params.userId), name: params.name, displayName: params.name },
                    challenge: buffer(randomBytes(32)),
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
                    excludeCredentials: params.exclude.map((id) => ({ type: 'public-key' as const, id: buffer(id) })),
                    attestation: 'none',
                    timeout: 120_000,
                },
            })) as PublicKeyCredential | null;
        } catch (error) {
            throw ceremonyError(error, params.rpId);
        }
        if (!credential) throw new Error('No passkey was created');
        const response = credential.response as AuthenticatorAttestationResponse;
        const authenticatorData = attestationAuthData(response);
        if (!isUnderRpId(authenticatorData, params.rpId)) {
            throw new LazorkitConfigError(
                'rp-id-refused',
                `The new passkey was made under another relying party than "${params.rpId}" (its authenticator data does ` +
                    'not hash to it), so a wallet for it could never sign. No wallet was created.',
            );
        }
        return { rawId: bytesOf(credential.rawId), publicKey: publicKeyFromAttestation(response), authenticatorData };
    });
}

/**
 * Passkey autofill: a conditional get that stays pending until the user picks
 * a passkey in an `autocomplete="username webauthn"` field, or `stop()`.
 * `null` when the browser is known to have no autofill. Before the browser
 * has said (a page that loads disconnected asks before it answers), the
 * handle is returned at once and the get starts when it does, unless `stop()`
 * or another ceremony came first. Reported as a `get:autofill` ceremony when
 * a passkey is picked.
 */
export function startConditional(
    config: WalletConfig,
    params: { rpId: string; challenge: Uint8Array; onAssertion: (assertion: Assertion) => void; onError?: (error: unknown) => void },
): { stop(): void } | null {
    const known = knownCapabilities();
    if (!hasWebAuthn() || known?.conditionalGet === false) return null;
    autofill?.abort();
    // Held from now on, even before the get starts: `abortAutofill` (every
    // other ceremony) and `stop()` cancel a start still waiting for the
    // capabilities too.
    const controller = new AbortController();
    autofill = controller;
    const begin = () => {
        if (controller.signal.aborted) return;
        navigator.credentials
            .get({
                mediation: 'conditional',
                signal: controller.signal,
                publicKey: { ...publicKeyGet(params.rpId, params.challenge), timeout: 600_000 },
            })
            .then(
                (credential) => {
                    if (controller.signal.aborted) return;
                    if (autofill === controller) autofill = null;
                    // Counted once picked: until then it shows nothing of its own.
                    void ceremony(config, 'get:autofill', async () => toAssertion(credential)).then(
                        params.onAssertion,
                        (error) => params.onError?.(error),
                    );
                },
                (error) => {
                    if (autofill === controller) autofill = null;
                    if (controller.signal.aborted || isDomError(error, 'AbortError')) return;
                    params.onError?.(ceremonyError(error, params.rpId));
                },
            );
    };
    if (known) {
        begin();
    } else {
        void passkeyCapabilities().then((caps) => {
            if (caps.conditionalGet) begin();
            else if (autofill === controller) autofill = null;
        });
    }
    return {
        stop() {
            controller.abort();
            if (autofill === controller) autofill = null;
        },
    };
}

export function randomBytes(size: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(size));
}
