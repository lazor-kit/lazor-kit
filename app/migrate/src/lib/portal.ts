import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2';
import { DialogManager, getCredentialHash } from '@lazorkit/wallet';

import { config } from './config';

export interface Passkey {
  /** Raw credential id, base64 — what the portal needs to sign again. */
  credentialId: string;
  /** SHA-256 of the credential id: what the authority account stores. */
  credentialIdHash: Uint8Array;
  /** Compressed secp256r1 public key, 33 bytes. */
  compressedPubkey: Uint8Array;
}

/**
 * The portal is the only place that can produce this signature.
 *
 * A wallet's authority stores the SHA-256 of the relying-party id it was
 * created under, and the program checks it on every passkey signature. Wallets
 * made through `@lazorkit/wallet` were created under the portal's rp id, so
 * their owner's assertion has to come from the portal's origin — this page
 * cannot call `navigator.credentials.get()` itself and produce anything the
 * program will accept.
 */
function dialog(): DialogManager {
  return new DialogManager({
    portalUrl: config.portalUrl,
    rpcUrl: config.rpcUrl,
    paymasterUrl: config.paymasterUrl,
  });
}

/** The rp id the on-chain authority was created under. */
export const portalRpId = (): string => new URL(config.portalUrl).hostname;

export async function connectPasskey(): Promise<Passkey> {
  const manager = dialog();
  try {
    const result = await manager.openConnect();
    return {
      credentialId: result.credentialId,
      credentialIdHash: getCredentialHash(result.credentialId),
      compressedPubkey: new Uint8Array(Buffer.from(result.publicKey, 'base64')),
    };
  } finally {
    manager.destroy();
  }
}

/** WebAuthn response in the shape the SDK's `finalize` expects. */
export interface WebAuthnResponse {
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJsonHash: Uint8Array;
  clientDataJson: Uint8Array;
}

export async function signChallenge(
  challenge: Uint8Array,
  credentialId: string,
  displayTransactionBase64: string,
): Promise<WebAuthnResponse> {
  const manager = dialog();
  try {
    const result = await manager.openSign(
      toBase64Url(challenge),
      displayTransactionBase64,
      credentialId,
      config.rpcUrl.includes('mainnet') ? 'mainnet' : 'devnet',
    );
    const clientDataJson = new Uint8Array(Buffer.from(result.clientDataJsonBase64, 'base64'));
    return {
      signature: new Uint8Array(Buffer.from(result.signature, 'base64')),
      authenticatorData: new Uint8Array(Buffer.from(result.authenticatorDataBase64, 'base64')),
      clientDataJsonHash: sha256(clientDataJson),
      clientDataJson,
    };
  } finally {
    manager.destroy();
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
