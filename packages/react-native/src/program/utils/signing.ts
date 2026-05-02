import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildAuthPayload,
  buildAuthPayloadPrefix,
  buildSecp256r1Challenge,
  type Secp256r1Signer,
} from './secp256r1';
import { AUTH_TYPE_SECP256R1 } from './instructions';
import { concatBytes } from './bytes';

// ─── Two-phase Secp256r1 signing flow ───────────────────────────────
//
// Real browser WebAuthn flows are async (popups, redirects, cross-page).
// The SDK splits signing into two phases:
//
//   1. prepare  → computes the challenge (send this to the authenticator page)
//   2. finalize → takes the WebAuthn response, builds authPayload + precompile ix
//
// Secp256r1 authorities are passkeys-only. For programmatic/bot signing
// (tests, backends), use Ed25519 authorities instead.

/** Output of prepareSecp256r1 — everything needed to call the authenticator. */
export interface PreparedSecp256r1 {
  /** The SHA-256 challenge to pass to `navigator.credentials.get()` */
  challenge: Uint8Array;
  /** Signing params preserved for the finalize step */
  _internal: {
    slot: bigint;
    counter: number;
    sysvarIxIndex: number;
    publicKeyBytes: Uint8Array;
  };
}

/** Raw WebAuthn authenticator response — what the browser gives back. */
export interface WebAuthnResponse {
  /** 64-byte raw ECDSA signature (r || s), low-S normalized */
  signature: Uint8Array;
  /** Authenticator data bytes from the WebAuthn response */
  authenticatorData: Uint8Array;
  /** SHA256 of the clientDataJSON */
  clientDataJsonHash: Uint8Array;
  /** Raw clientDataJSON bytes from the authenticator */
  clientDataJson: Uint8Array;
}

/**
 * Phase 1: Prepare the challenge for a real browser authenticator (Mode 1).
 *
 * Computes the SHA-256 challenge that must be passed to `navigator.credentials.get()`.
 * After the user signs with their passkey, call `finalizeSecp256r1()` with the response.
 */
export function prepareSecp256r1(params: {
  discriminator: Uint8Array;
  signedPayload: Uint8Array;
  sysvarIxIndex: number;
  slot: bigint;
  counter: number;
  payer: PublicKey;
  programId: PublicKey;
  publicKeyBytes: Uint8Array;
}): PreparedSecp256r1 {
  const challengePrefix = buildAuthPayloadPrefix({
    slot: params.slot,
    counter: params.counter,
    sysvarIxIndex: params.sysvarIxIndex,
  });

  const challenge = buildSecp256r1Challenge({
    discriminator: params.discriminator,
    authPayload: challengePrefix,
    signedPayload: params.signedPayload,
    slot: params.slot,
    payer: params.payer,
    counter: params.counter,
    programId: params.programId,
  });

  return {
    challenge,
    _internal: {
      slot: params.slot,
      counter: params.counter,
      sysvarIxIndex: params.sysvarIxIndex,
      publicKeyBytes: params.publicKeyBytes,
    },
  };
}

/**
 * Phase 2: Finalize the signing flow after the user authenticates (Mode 1).
 *
 * Takes the raw WebAuthn response from the browser and produces the
 * auth payload + precompile instruction for the transaction.
 */
export function finalizeSecp256r1(
  prepared: PreparedSecp256r1,
  response: WebAuthnResponse,
): {
  authPayload: Uint8Array;
  precompileIx: TransactionInstruction;
} {
  const { slot, counter, sysvarIxIndex, publicKeyBytes } = prepared._internal;

  const authPayload = buildAuthPayload({
    slot,
    counter,
    sysvarIxIndex,
    authenticatorData: response.authenticatorData,
    clientDataJson: response.clientDataJson,
  });

  const precompileMessage = concatBytes([
    response.authenticatorData,
    response.clientDataJsonHash,
  ]);
  const precompileIx = buildSecp256r1PrecompileIx(
    publicKeyBytes,
    precompileMessage,
    response.signature,
  );

  return { authPayload, precompileIx };
}

// ─── Single-call convenience ────────────────────────────────────────

/**
 * Full Secp256r1 signing in a single call. Wraps prepare + signer callback
 * + finalize. Use this only for programmatic flows (tests, in-process
 * signers). Real browser flows should call `prepareSecp256r1()` +
 * `finalizeSecp256r1()` directly because authentication is asynchronous.
 */
export async function signWithSecp256r1(params: {
  signer: Secp256r1Signer;
  discriminator: Uint8Array;
  signedPayload: Uint8Array;
  sysvarIxIndex: number;
  slot: bigint;
  counter: number;
  payer: PublicKey;
  programId: PublicKey;
}): Promise<{
  authPayload: Uint8Array;
  precompileIx: TransactionInstruction;
}> {
  const prepared = prepareSecp256r1({
    discriminator: params.discriminator,
    signedPayload: params.signedPayload,
    sysvarIxIndex: params.sysvarIxIndex,
    slot: params.slot,
    counter: params.counter,
    payer: params.payer,
    programId: params.programId,
    publicKeyBytes: params.signer.publicKeyBytes,
  });

  const response = await params.signer.sign(prepared.challenge);
  return finalizeSecp256r1(prepared, response);
}

// ─── Data payload builders ──────────────────────────────────────────

/**
 * AddAuthority data payload:
 * [type(1)][role(1)][padding(6)][credential(32)][secp256r1Pubkey?(33)][rpIdLen?(1)][rpId?(N)]
 */
export function buildDataPayloadForAdd(
  newType: number,
  newRole: number,
  credentialOrPubkey: Uint8Array,
  secp256r1Pubkey?: Uint8Array,
  rpId?: string,
): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([newType, newRole]),
    new Uint8Array(6), // padding
    credentialOrPubkey,
  ];
  if (newType === AUTH_TYPE_SECP256R1 && secp256r1Pubkey) {
    parts.push(secp256r1Pubkey);
    if (rpId) {
      const rpIdBytes = Buffer.from(rpId, 'utf-8');
      parts.push(new Uint8Array([rpIdBytes.length]));
      parts.push(new Uint8Array(rpIdBytes));
    }
  }
  return concatBytes(parts);
}

/**
 * TransferOwnership data payload: [auth_type(1)][full_auth_data]
 */
export function buildDataPayloadForTransfer(
  newType: number,
  credentialOrPubkey: Uint8Array,
  secp256r1Pubkey?: Uint8Array,
  rpId?: string,
): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([newType]),
    credentialOrPubkey,
  ];
  if (newType === AUTH_TYPE_SECP256R1 && secp256r1Pubkey) {
    parts.push(secp256r1Pubkey);
    if (rpId) {
      const rpIdBytes = Buffer.from(rpId, 'utf-8');
      parts.push(new Uint8Array([rpIdBytes.length]));
      parts.push(new Uint8Array(rpIdBytes));
    }
  }
  return concatBytes(parts);
}

/**
 * CreateSession data payload: [session_key(32)][expires_at(8)][actions_len(2)][actions(N)]
 */
export function buildDataPayloadForSession(
  sessionKey: Uint8Array,
  expiresAt: bigint,
  actionsBuffer?: Uint8Array,
): Uint8Array {
  const actionsLen = actionsBuffer?.length ?? 0;
  const buf = new Uint8Array(42 + actionsLen);
  buf.set(sessionKey, 0);
  const expiresAtBuf = Buffer.alloc(8);
  expiresAtBuf.writeBigInt64LE(expiresAt);
  buf.set(new Uint8Array(expiresAtBuf), 32);
  buf[40] = actionsLen & 0xff;
  buf[41] = (actionsLen >> 8) & 0xff;
  if (actionsBuffer && actionsLen > 0) {
    buf.set(actionsBuffer, 42);
  }
  return buf;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** @deprecated Use `concatBytes` from `./bytes` instead. Kept as alias for back-compat. */
export const concatParts = concatBytes;

/**
 * Builds the Secp256r1 precompile verify instruction.
 * Program: Secp256r1SigVerify111111111111111111111111111
 */
export function buildSecp256r1PrecompileIx(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): TransactionInstruction {
  // Validate sizes before constructing the precompile header — the layout below
  // is fixed-offset and silent bad-size bugs are hard to diagnose on-chain.
  if (signature.length !== 64) {
    throw new Error(
      `Secp256r1 signature must be 64 bytes (raw r||s), got ${signature.length}`,
    );
  }
  if (publicKey.length !== 33) {
    throw new Error(
      `Secp256r1 public key must be 33 bytes (compressed), got ${publicKey.length}`,
    );
  }
  if (message.length > 0xffff) {
    throw new Error(
      `Precompile message length must fit in u16 (got ${message.length})`,
    );
  }

  const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');

  const HEADER_SIZE = 16;
  const sigOffset = HEADER_SIZE;
  const pubkeyOffset = sigOffset + 64;
  const msgOffset = pubkeyOffset + 33 + 1; // 1-byte alignment padding

  const data = Buffer.alloc(HEADER_SIZE + 64 + 33 + 1 + message.length);
  let off = 0;

  data.writeUInt8(1, off); off += 1;
  data.writeUInt8(0, off); off += 1;
  data.writeUInt16LE(sigOffset, off); off += 2;
  data.writeUInt16LE(0xFFFF, off); off += 2;
  data.writeUInt16LE(pubkeyOffset, off); off += 2;
  data.writeUInt16LE(0xFFFF, off); off += 2;
  data.writeUInt16LE(msgOffset, off); off += 2;
  data.writeUInt16LE(message.length, off); off += 2;
  data.writeUInt16LE(0xFFFF, off); off += 2;

  Buffer.from(signature).copy(data, sigOffset);
  Buffer.from(publicKey).copy(data, pubkeyOffset);
  Buffer.from(message).copy(data, msgOffset);

  return new TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data,
  });
}
