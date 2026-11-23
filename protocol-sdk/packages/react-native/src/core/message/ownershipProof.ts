/**
 * LazorKit ownership-proof challenges, format v1.
 *
 * Connect asks the passkey to sign a fresh challenge to prove which wallets'
 * keys it holds. That challenge is domain-separated like a message's (see
 * ./signedMessage.ts), so no passkey challenge the SDK asks for can be read as
 * another kind:
 *
 *     tag       = UTF-8 "LazorKit ownership proof v1"   (27 bytes)
 *     challenge = tag || 32 random bytes               (59 bytes)
 *
 * A transaction challenge the LazorKit programs accept is a 32-byte hash, a
 * message challenge is 58 bytes and starts with its own tag, and an ownership
 * challenge is 59 bytes and starts with this one: no challenge of one kind can
 * equal one of another, whatever the bytes.
 *
 * `verifyOwnershipProof` (@lazorkit/sdk-legacy) checks a proof over exactly
 * the challenge it carries, of any length from 16 bytes, so it accepts these
 * unchanged.
 *
 * Keep this file the same in @lazorkit/wallet and
 * @lazorkit/wallet-mobile-adapter.
 */

import { Buffer } from 'buffer';
import { createOwnershipChallenge as randomBytes32 } from '@lazorkit/sdk-legacy';

/** The domain tag every LazorKit ownership-proof challenge starts with (format v1). */
export const OWNERSHIP_PROOF_DOMAIN = 'LazorKit ownership proof v1';

const TAG = new Uint8Array(Buffer.from(OWNERSHIP_PROOF_DOMAIN, 'utf8'));
const NONCE_LENGTH = 32;

type RandomSource = { getRandomValues?: (array: Uint8Array) => Uint8Array };

/**
 * 32 bytes from the platform's CSPRNG. `globalThis.crypto` is read at call
 * time: in React Native it exists only once react-native-get-random-values has
 * run, which may be after this module loaded. Where it is missing (Node 18),
 * @lazorkit/sdk-legacy's generator, which finds Node's own.
 */
function freshNonce(): Uint8Array {
    const source = (globalThis as { crypto?: RandomSource }).crypto;
    if (source && typeof source.getRandomValues === 'function') {
        return source.getRandomValues(new Uint8Array(NONCE_LENGTH));
    }
    const nonce = randomBytes32();
    if (nonce.length !== NONCE_LENGTH) throw new Error('No source of random bytes for an ownership challenge');
    return nonce;
}

/**
 * A fresh challenge for an ownership proof: `tag || 32 random bytes`, 59
 * bytes, where `tag` is `OWNERSHIP_PROOF_DOMAIN` in UTF-8. Sign it with the
 * passkey and check the assertion with `verifyOwnershipProof`. Generate one
 * for each proof and never reuse it.
 */
export function createOwnershipChallenge(): Uint8Array {
    const challenge = new Uint8Array(TAG.length + NONCE_LENGTH);
    challenge.set(TAG, 0);
    challenge.set(freshNonce(), TAG.length);
    return challenge;
}
