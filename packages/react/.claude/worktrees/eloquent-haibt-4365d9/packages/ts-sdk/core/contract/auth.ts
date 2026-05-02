import * as anchor from '@coral-xyz/anchor';
import { buildSecp256r1VerifyIx } from './webauthn/secp256r1';
import { sha256 } from 'js-sha256';
import { PasskeySignature, Signature } from './types';
import {
  assertValidPasskeyPublicKey,
  assertValidSignature,
  assertValidBase64,
  toNumberArray,
} from './validation';

/**
 * Builds a Secp256r1 signature verification instruction for passkey authentication
 * 
 * @param passkeySignature - Validated passkey signature data
 * @returns Transaction instruction for signature verification
 * @throws {ValidationError} if passkeySignature is invalid
 */
export function buildPasskeyVerificationInstruction(
  passkeySignature: PasskeySignature
): anchor.web3.TransactionInstruction {
  // Validate all required fields
  assertValidPasskeyPublicKey(
    passkeySignature.passkeyPublicKey,
    'passkeySignature.passkeyPublicKey'
  );
  assertValidBase64(
    passkeySignature.signature64,
    'passkeySignature.signature64'
  );
  assertValidBase64(
    passkeySignature.clientDataJsonRaw64,
    'passkeySignature.clientDataJsonRaw64'
  );
  assertValidBase64(
    passkeySignature.authenticatorDataRaw64,
    'passkeySignature.authenticatorDataRaw64'
  );

  // Decode base64 strings (assertValidBase64 already validated them)
  const authenticatorDataRaw = Buffer.from(
    passkeySignature.authenticatorDataRaw64,
    'base64'
  );
  const clientDataJsonRaw = Buffer.from(
    passkeySignature.clientDataJsonRaw64,
    'base64'
  );
  const signature = Buffer.from(passkeySignature.signature64, 'base64');
  
  // Validate signature length
  assertValidSignature(
    toNumberArray(signature),
    'passkeySignature.signature64 (decoded)'
  );

  const message = Buffer.concat([
    authenticatorDataRaw,
    Buffer.from(sha256.arrayBuffer(clientDataJsonRaw)),
  ]);

  return buildSecp256r1VerifyIx(
    message,
    passkeySignature.passkeyPublicKey,
    signature
  );
}

/**
 * Converts passkey signature data to the format expected by smart contract instructions
 * 
 * @param passkeySignature - Validated passkey signature data
 * @returns Instruction arguments with validated byte arrays
 * @throws {ValidationError} if passkeySignature is invalid
 */
export function convertPasskeySignatureToInstructionArgs(
  passkeySignature: PasskeySignature
): {
  passkeyPublicKey: number[];
  signature: Signature;
  clientDataJsonRaw: Buffer;
  authenticatorDataRaw: Buffer;
} {
  // buildPasskeyVerificationInstruction already validates all fields
  // We just need to decode and return the values
  const signature = Buffer.from(passkeySignature.signature64, 'base64');
  assertValidSignature(
    toNumberArray(signature),
    'passkeySignature.signature64 (decoded)'
  );
  
  return {
    passkeyPublicKey: passkeySignature.passkeyPublicKey,
    signature: toNumberArray(signature) as Signature,
    clientDataJsonRaw: Buffer.from(
      passkeySignature.clientDataJsonRaw64,
      'base64'
    ),
    authenticatorDataRaw: Buffer.from(
      passkeySignature.authenticatorDataRaw64,
      'base64'
    ),
  };
}
