// Deterministic test keys, blockhashes and randomness: nothing here is a
// secret, and every run of the vectors and of the differential test is
// reproducible from its labels or its seed.
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

/** A key label L is the ed25519 key whose 32-byte seed is sha256(KEY_PREFIX + L). */
export const KEY_PREFIX = 'lazorkit-txv1-vector:';

const sha256 = (text) => createHash('sha256').update(text).digest();
const keys = new Map();

export function testKey(label) {
  let key = keys.get(label);
  if (!key) {
    key = Keypair.fromSeed(sha256(KEY_PREFIX + label));
    keys.set(label, key);
  }
  return key;
}

export function testBlockhash(label) {
  return new PublicKey(sha256(`${KEY_PREFIX}blockhash:${label}`)).toBase58();
}

/** xoshiro128** seeded through splitmix32: a fixed sequence for a given 32-bit seed. */
export function seededRandom(seed) {
  let z = seed >>> 0;
  const splitmix32 = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const s = [splitmix32(), splitmix32(), splitmix32(), splitmix32()];
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  };
  return {
    /** A uniform u32. */
    u32: next,
    /** A uniform u64, as a bigint. */
    u64: () => (BigInt(next()) << 32n) | BigInt(next()),
    /** An integer in [0, n), n ≤ 2^32. */
    int: (n) => Math.floor((next() / 2 ** 32) * n),
    /** An integer in [min, max]. */
    range: (min, max) => min + Math.floor((next() / 2 ** 32) * (max - min + 1)),
    chance: (p) => next() / 2 ** 32 < p,
    bytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 4) {
        const v = next();
        for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = (v >>> (8 * j)) & 0xff;
      }
      return out;
    },
    pick(list) {
      return list[this.int(list.length)];
    },
  };
}
