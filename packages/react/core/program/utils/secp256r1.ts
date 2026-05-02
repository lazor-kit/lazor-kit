import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import { PROGRAM_ID } from '../constants';

/**
 * Generates WebAuthn authenticator data for a given RP ID.
 *
 * Format: rpIdHash(32) + flags(1) + counter(4) = 37 bytes
 * - Flags: 0x01 (User Present)
 * - Counter: 0 (LazorKit uses its own odometer counter, not WebAuthn counter)
 */
export function generateAuthenticatorData(rpId: string): Uint8Array {
  const rpIdHash = createHash('sha256').update(rpId).digest();
  const data = new Uint8Array(37);
  data.set(rpIdHash, 0);
  data[32] = 0x01; // User Present flag
  // Counter bytes (33-36) stay 0
  return data;
}

/**
 * Callback interface for Secp256r1 (passkey/WebAuthn) signing.
 * The SDK never touches private keys.
 *
 * Secp256r1 authorities are **passkeys only** — real browser authenticators
 * producing raw clientDataJSON. Programmatic/bot signing should use
 * Ed25519 authorities instead.
 *
 * The sign() method receives a SHA-256 challenge and must:
 * 1. Call `navigator.credentials.get({ challenge, ... })` or the platform equivalent
 * 2. Return the raw WebAuthn response — signature, authenticatorData, and the
 *    raw clientDataJSON bytes (the on-chain program validates `challenge` and
 *    `type` fields directly from these bytes)
 */
export interface Secp256r1Signer {
  /** Compressed public key (33 bytes) */
  publicKeyBytes: Uint8Array;
  /** SHA256 of the credential ID (32 bytes) — used as PDA seed */
  credentialIdHash: Uint8Array;
  /** RP ID string (e.g. "lazorkit.app") */
  rpId: string;
  /**
   * Signs the SHA-256 challenge with the passkey.
   * MUST return the raw `clientDataJson` bytes — the SDK no longer supports
   * the on-chain-reconstructed (Mode 0) flow.
   */
  sign(challenge: Uint8Array): Promise<{
    /** 64-byte raw ECDSA signature (r || s), low-S normalized */
    signature: Uint8Array;
    /** WebAuthn authenticator data bytes */
    authenticatorData: Uint8Array;
    /** SHA256 of the clientDataJSON */
    clientDataJsonHash: Uint8Array;
    /** Raw clientDataJSON bytes from the authenticator */
    clientDataJson: Uint8Array;
  }>;
}

/**
 * Reads the current odometer counter from an on-chain authority account.
 * The counter is a u32 LE at offset 8 of the AuthorityAccountHeader.
 */
export async function readAuthorityCounter(
  connection: Connection,
  authorityPda: PublicKey,
): Promise<number> {
  const info = await connection.getAccountInfo(authorityPda);
  if (!info) throw new Error(`Authority account not found: ${authorityPda.toBase58()}`);
  if (info.data.length < 12) throw new Error('Authority account data too short');
  const view = new DataView(info.data.buffer, info.data.byteOffset);
  return view.getUint32(8, true); // offset 8, little-endian, u32
}

/**
 * Reads the compressed Secp256r1 public key (33 bytes) from an on-chain
 * authority account. Layout:
 *   [header(48)] [credential_id_hash(32)] [compressed_pubkey(33)] ...
 *
 * Throws if the account doesn't exist, isn't an Authority, or isn't a Secp256r1
 * authority.
 */
export async function readAuthorityPubkey(
  connection: Connection,
  authorityPda: PublicKey,
): Promise<Uint8Array> {
  const info = await connection.getAccountInfo(authorityPda);
  if (!info) throw new Error(`Authority account not found: ${authorityPda.toBase58()}`);
  // Header is 48 bytes, credential_id_hash is 32 bytes, pubkey is 33 bytes.
  // Min size = 48 + 32 + 33 = 113 bytes for a Secp256r1 authority.
  if (info.data.length < 113) throw new Error('Authority account too small for Secp256r1');
  // Byte 0 is the account discriminator: Authority = 2.
  if (info.data[0] !== 2) throw new Error('Not an Authority account');
  // Byte 1 is the authority_type: Secp256r1 = 1.
  if (info.data[1] !== 1) throw new Error('Authority is not Secp256r1');
  // Pubkey at offset 48 + 32 = 80, length 33.
  return new Uint8Array(info.data.slice(80, 80 + 33));
}

/**
 * Builds the auth_payload bytes for a Secp256r1 Execute (raw clientDataJSON).
 *
 * Layout:
 *   [slot(8)][counter(4)][sysvarIxIdx(1)][reserved(1)]
 *   [authDataLen(2 LE)][authenticatorData(M)]
 *   [cdjLen(2 LE)][clientDataJson(N)]
 */
export function buildAuthPayload(params: {
  slot: bigint;
  counter: number;
  sysvarIxIndex: number;
  authenticatorData: Uint8Array;
  clientDataJson: Uint8Array;
}): Uint8Array {
  const authDataLen = params.authenticatorData.length;
  const cdjLen = params.clientDataJson.length;
  // Length fields are u16 LE — guard the upper bound so a pathological
  // authenticator response can't silently wrap and produce a malformed payload.
  if (authDataLen > 0xffff) {
    throw new Error(`authenticatorData length must fit in u16 (got ${authDataLen})`);
  }
  if (cdjLen > 0xffff) {
    throw new Error(`clientDataJson length must fit in u16 (got ${cdjLen})`);
  }
  const totalLen = 8 + 4 + 1 + 1 + 2 + authDataLen + 2 + cdjLen;
  const buf = Buffer.alloc(totalLen);
  let offset = 0;

  buf.writeBigUInt64LE(params.slot, offset); offset += 8;
  buf.writeUInt32LE(params.counter, offset); offset += 4;
  buf.writeUInt8(params.sysvarIxIndex, offset); offset += 1;
  // Reserved byte (formerly Mode 1 flag — now always set for backwards-compatible
  // auth_payload_prefix layout).
  buf.writeUInt8(0x80, offset); offset += 1;
  buf.writeUInt16LE(authDataLen, offset); offset += 2;
  Buffer.from(params.authenticatorData).copy(buf, offset); offset += authDataLen;
  buf.writeUInt16LE(cdjLen, offset); offset += 2;
  Buffer.from(params.clientDataJson).copy(buf, offset);

  return new Uint8Array(buf);
}

/**
 * Builds the 14-byte fixed prefix of the auth_payload for challenge computation.
 * The challenge is computed BEFORE signing — at that point we don't yet have
 * authenticatorData/clientDataJSON, so only the deterministic prefix is hashed.
 */
export function buildAuthPayloadPrefix(params: {
  slot: bigint;
  counter: number;
  sysvarIxIndex: number;
}): Uint8Array {
  const buf = Buffer.alloc(14);
  buf.writeBigUInt64LE(params.slot, 0);
  buf.writeUInt32LE(params.counter, 8);
  buf.writeUInt8(params.sysvarIxIndex, 12);
  buf.writeUInt8(0x80, 13);
  return new Uint8Array(buf);
}

/**
 * Computes the SHA-256 challenge hash that must be signed by the passkey.
 *
 * Hash = SHA256(discriminator || auth_payload || signed_payload || payer || counter_le(4) || program_id)
 *
 * Note: slot is already encoded as the first 8 bytes of auth_payload, so it is NOT hashed again
 * here. The previous redundant `slot_le` field was removed to keep hash inputs non-repetitive.
 * This must exactly match the on-chain `sol_sha256` call in secp256r1/mod.rs.
 */
export function buildSecp256r1Challenge(params: {
  discriminator: Uint8Array;
  authPayload: Uint8Array;
  signedPayload: Uint8Array;
  slot: bigint;
  payer: PublicKey;
  counter: number;
  programId?: PublicKey;
}): Uint8Array {
  const pid = params.programId ?? PROGRAM_ID;
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32LE(params.counter);

  const hash = createHash('sha256');
  hash.update(params.discriminator);
  hash.update(params.authPayload);
  hash.update(params.signedPayload);
  hash.update(params.payer.toBuffer());
  hash.update(counterBuf);
  hash.update(pid.toBuffer());
  return new Uint8Array(hash.digest());
}
