// A virtual authenticator for a jsdom page: resident P-256 credentials made
// with node:crypto, behind `navigator.credentials.get` / `create`, with
// `PublicKeyCredential.getClientCapabilities` /
// `isConditionalMediationAvailable` (answered late while `state.capsGate` is
// pending) and `navigator.userActivation`. Every call is recorded with its
// options. What the next calls do can be scripted:
//
//   authenticator.next('cancel')                the sheet is closed (NotAllowedError)
//   authenticator.next({ error: 'SecurityError' }) / 'InvalidStateError' / 'NotSupportedError'
//   authenticator.next({ pick: 1 })             the user picks the second passkey
//   authenticator.next({ answerWith: credential }) another passkey answers a pinned get
//   authenticator.next({ rpIdHashOf: 'evil.test' }) a registration hashed under another rpId
//
// With nothing scripted, a get returns the first passkey that matches (or
// NotAllowedError when none does, at once for immediate mode), and a create
// makes one (InvalidStateError when `excludeCredentials` names one it holds).
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const ab = (bytes) => {
    const b = Buffer.from(bytes);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// ─── Minimal CBOR ───────────────────────────────────────────────────────────

function head(major, n) {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
    throw new Error('CBOR: length too large for this encoder');
}

export function cbor(value) {
    if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
    if (typeof value === 'string') {
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([head(3, bytes.length), bytes]);
    }
    if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
    if (value instanceof Map) {
        const parts = [head(5, value.size)];
        for (const [k, v] of value) parts.push(cbor(k), cbor(v));
        return Buffer.concat(parts);
    }
    throw new Error(`CBOR: cannot encode ${typeof value}`);
}

// ─── Keys ───────────────────────────────────────────────────────────────────

/** A P-256 passkey: its private key, compressed (33) and raw x / y. */
export function p256Key() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    return {
        privateKey,
        x,
        y,
        compressed: Buffer.concat([Buffer.from([2 + (y[31] & 1)]), x]),
        spki: publicKey.export({ format: 'der', type: 'spki' }),
    };
}

/**
 * A credential the authenticator holds. `userHandle`: 32 bytes for a passkey
 * this SDK made (the wallet's seed), anything else for another one.
 */
export function credential({ rpId, userHandle = randomBytes(16), rawId = randomBytes(16) } = {}) {
    return { rawId: Buffer.from(rawId), key: p256Key(), userHandle: userHandle ? Buffer.from(userHandle) : null, rpId, signCount: 0 };
}

function domError(name, message = name) {
    return new DOMException(message, name);
}

/**
 * Install the authenticator on `window` (and the globals the SDK reads).
 * `origin`: what clientDataJSON says.
 */
export function installFakeWebAuthn(window, { origin } = {}) {
    const page = origin ?? window.location.origin;
    const state = {
        credentials: [],
        calls: [],
        script: [],
        caps: { immediateGet: false, conditionalGet: false },
        /** A promise the capability reads wait for: a browser that answers late. */
        capsGate: null,
        userActivation: true,
        /** A pending conditional get, answered by `pickAutofill`. */
        conditional: null,
    };

    function assertionFor(cred, challenge, rpId) {
        cred.signCount += 1;
        const clientDataJSON = Buffer.from(
            JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: page, crossOrigin: false }),
        );
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(cred.signCount);
        const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), counter]);
        const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), cred.key.privateKey); // DER
        return {
            type: 'public-key',
            id: b64url(cred.rawId),
            rawId: ab(cred.rawId),
            response: {
                clientDataJSON: ab(clientDataJSON),
                authenticatorData: ab(authenticatorData),
                signature: ab(signature),
                userHandle: cred.userHandle ? ab(cred.userHandle) : null,
            },
            getClientExtensionResults: () => ({}),
        };
    }

    async function get(options = {}) {
        const call = { kind: 'get', options };
        state.calls.push(call);
        const pk = options.publicKey;
        const challenge = Buffer.from(new Uint8Array(pk.challenge));
        const rpId = pk.rpId ?? window.location.hostname;
        if (options.mediation === 'conditional') {
            return new Promise((resolve, reject) => {
                const abort = () => reject(domError('AbortError'));
                if (options.signal?.aborted) return abort();
                options.signal?.addEventListener('abort', abort);
                state.conditional = {
                    pick: (n = 0) => {
                        state.conditional = null;
                        const matching = state.credentials.filter((c) => c.rpId === rpId);
                        resolve(assertionFor(matching[n], challenge, rpId));
                    },
                };
            });
        }
        if (options.signal?.aborted) throw domError('AbortError');
        const step = state.script.shift() ?? {};
        if (step === 'cancel') throw domError('NotAllowedError', 'The operation either timed out or was not allowed.');
        if (step.error) throw domError(step.error);
        const allowed = (pk.allowCredentials ?? []).map((c) => Buffer.from(new Uint8Array(c.id)));
        const candidates = state.credentials.filter(
            (c) => c.rpId === rpId && (allowed.length === 0 || allowed.some((id) => id.equals(c.rawId))),
        );
        if (step.answerWith) return assertionFor(step.answerWith, challenge, rpId);
        if (candidates.length === 0) throw domError('NotAllowedError', 'No passkey for this site.');
        return assertionFor(candidates[step.pick ?? 0], challenge, rpId);
    }

    async function create(options = {}) {
        const call = { kind: 'create', options };
        state.calls.push(call);
        if (options.signal?.aborted) throw domError('AbortError');
        const step = state.script.shift() ?? {};
        if (step === 'cancel') throw domError('NotAllowedError');
        if (step.error) throw domError(step.error);
        const pk = options.publicKey;
        const rpId = pk.rp.id;
        const excluded = (pk.excludeCredentials ?? []).map((c) => Buffer.from(new Uint8Array(c.id)));
        if (state.credentials.some((c) => c.rpId === rpId && excluded.some((id) => id.equals(c.rawId)))) {
            throw domError('InvalidStateError');
        }
        const cred = credential({ rpId, userHandle: Buffer.from(new Uint8Array(pk.user.id)) });
        cred.name = pk.user.name;
        state.credentials.push(cred);
        const cose = cbor(
            new Map([
                [1, 2],
                [3, -7],
                [-1, 1],
                [-2, new Uint8Array(cred.key.x)],
                [-3, new Uint8Array(cred.key.y)],
            ]),
        );
        const idLength = Buffer.from([cred.rawId.length >> 8, cred.rawId.length & 0xff]);
        const authData = Buffer.concat([
            sha256(step.rpIdHashOf ?? rpId),
            Buffer.from([0x45]),
            Buffer.alloc(4),
            Buffer.alloc(16),
            idLength,
            cred.rawId,
            cose,
        ]);
        const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
        const clientDataJSON = Buffer.from(
            JSON.stringify({ type: 'webauthn.create', challenge: b64url(new Uint8Array(pk.challenge)), origin: page }),
        );
        return {
            type: 'public-key',
            id: b64url(cred.rawId),
            rawId: ab(cred.rawId),
            response: {
                clientDataJSON: ab(clientDataJSON),
                attestationObject: ab(attestationObject),
                getPublicKey: () => ab(cred.key.spki),
                getAuthenticatorData: () => ab(authData),
            },
            getClientExtensionResults: () => ({}),
        };
    }

    Object.defineProperty(window.navigator, 'credentials', { value: { get, create }, configurable: true });
    Object.defineProperty(window.navigator, 'userActivation', {
        get: () => ({ isActive: state.userActivation, hasBeenActive: true }),
        configurable: true,
    });
    class PublicKeyCredential {}
    PublicKeyCredential.getClientCapabilities = async () => {
        await state.capsGate;
        return { ...state.caps };
    };
    PublicKeyCredential.isConditionalMediationAvailable = async () => {
        await state.capsGate;
        return state.caps.conditionalGet;
    };
    window.PublicKeyCredential = PublicKeyCredential;
    globalThis.PublicKeyCredential = PublicKeyCredential;

    return {
        state,
        /** Script what the next calls do, in order. */
        next: (...steps) => state.script.push(...steps),
        add: (cred) => state.credentials.push(cred),
        remove: (cred) => (state.credentials = state.credentials.filter((c) => c !== cred)),
        get calls() {
            return state.calls;
        },
        clear() {
            state.calls.length = 0;
            state.script.length = 0;
        },
        pickAutofill: (n) => state.conditional?.pick(n),
    };
}
