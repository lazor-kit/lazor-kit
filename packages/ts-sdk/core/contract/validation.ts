import * as anchor from '@coral-xyz/anchor';
import {
  PASSKEY_PUBLIC_KEY_SIZE,
  CREDENTIAL_HASH_SIZE,
  SIGNATURE_SIZE,
} from './constants';

// ============================================================================
// Validation Error Types
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Validates that a value is not null or undefined
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertDefined<T>(
  value: T | null | undefined,
  fieldName: string
): asserts value is T {
  // Use both strict equality and typeof check for maximum compatibility
  // In some edge cases (React Native, different execution contexts), 
  // value === undefined might not work as expected
  if (value === null || value === undefined || typeof value === 'undefined') {
    const actualType = value === null ? 'null' : 'undefined';
    throw new ValidationError(
      `${fieldName} is required but was ${actualType}`,
      fieldName
    );
  }
}

/**
 * Validates that a PublicKey is valid
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertValidPublicKey(
  value: anchor.web3.PublicKey | string | null | undefined,
  fieldName: string
): asserts value is anchor.web3.PublicKey {
  assertDefined(value, fieldName);

  try {
    if (typeof value === 'string') {
      // Validate string format first
      if (value.trim().length === 0) {
        throw new ValidationError(
          `${fieldName} cannot be an empty string`,
          fieldName
        );
      }
      new anchor.web3.PublicKey(value);
    } else {
      // Check if it's a PublicKey instance
      // Use both instanceof and duck typing for maximum compatibility
      // In React Native or when modules are loaded multiple times, 
      // instanceof might fail, so we also check for required properties
      const isPublicKeyInstance = 
        value instanceof anchor.web3.PublicKey ||
        (value && 
         typeof value === 'object' && 
         'toBase58' in value && 
         typeof (value as any).toBase58 === 'function' &&
         'toBytes' in value &&
         typeof (value as any).toBytes === 'function');
      
      if (!isPublicKeyInstance) {
        throw new ValidationError(
          `${fieldName} must be a PublicKey instance or valid base58 string`,
          fieldName
        );
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      `${fieldName} is not a valid PublicKey: ${
        error instanceof Error ? error.message : 'Invalid format'
      }`,
      fieldName
    );
  }
}

/**
 * Validates that a byte array has the exact required length
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertByteArrayLength(
  value: number[] | Uint8Array | null | undefined,
  expectedLength: number,
  fieldName: string
): asserts value is number[] {
  assertDefined(value, fieldName);

  // Handle different array-like types
  let array: number[];
  if (Array.isArray(value)) {
    array = value;
  } else if (value instanceof Uint8Array) {
    array = Array.from(value);
  } else if (value && typeof value === 'object' && typeof (value as any).length === 'number') {
    array = Array.from(value as ArrayLike<number>);
  } else {
    throw new ValidationError(
      `${fieldName} must be an array or Uint8Array`,
      fieldName
    );
  }

  if (array.length !== expectedLength) {
    throw new ValidationError(
      `${fieldName} must be exactly ${expectedLength} bytes, got ${array.length}`,
      fieldName
    );
  }

  // Validate all values are valid bytes (0-255)
  for (let i = 0; i < array.length; i++) {
    const byte = array[i];
    if (
      typeof byte !== 'number' ||
      !Number.isFinite(byte) ||
      !Number.isInteger(byte) ||
      byte < 0 ||
      byte > 255
    ) {
      throw new ValidationError(
        `${fieldName}[${i}] must be a valid byte (0-255), got ${typeof byte === 'number' ? byte : typeof byte}`,
        fieldName
      );
    }
  }
}

/**
 * Validates that a byte array is not empty
 */
export function assertNonEmptyByteArray(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string
): asserts value is number[] {
  assertDefined(value, fieldName);

  const array = Array.isArray(value) ? value : Array.from(value);
  if (array.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }
}

/**
 * Validates a passkey public key (33 bytes)
 * Returns the validated value as a number array
 */
export function assertValidPasskeyPublicKey(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'passkeyPublicKey'
): asserts value is number[] {
  assertByteArrayLength(value, PASSKEY_PUBLIC_KEY_SIZE, fieldName);
}

/**
 * Validates and converts a passkey public key to a number array
 * Throws ValidationError if invalid
 */
export function validatePasskeyPublicKey(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'passkeyPublicKey'
): number[] {
  assertValidPasskeyPublicKey(value, fieldName);
  return Array.isArray(value) ? value : Array.from(value);
}

/**
 * Validates a credential hash (32 bytes)
 * Returns the validated value as a number array
 */
export function assertValidCredentialHash(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'credentialHash'
): asserts value is number[] {
  assertByteArrayLength(value, CREDENTIAL_HASH_SIZE, fieldName);
}

/**
 * Validates and converts a credential hash to a number array
 * Throws ValidationError if invalid
 */
export function validateCredentialHash(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'credentialHash'
): number[] {
  assertValidCredentialHash(value, fieldName);
  return Array.isArray(value) ? value : Array.from(value);
}

/**
 * Validates a signature (64 bytes)
 * Returns the validated value as a number array
 */
export function assertValidSignature(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'signature'
): asserts value is number[] {
  assertByteArrayLength(value, SIGNATURE_SIZE, fieldName);
}

/**
 * Validates and converts a signature to a number array
 * Throws ValidationError if invalid
 */
export function validateSignature(
  value: number[] | Uint8Array | null | undefined,
  fieldName: string = 'signature'
): number[] {
  assertValidSignature(value, fieldName);
  return Array.isArray(value) ? value : Array.from(value);
}

/**
 * Validates that a BN is positive
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertPositiveBN(
  value: anchor.BN | null | undefined,
  fieldName: string
): asserts value is anchor.BN {
  assertDefined(value, fieldName);
  
  // Check if it's a BN instance using both instanceof and duck typing
  // In React Native or when modules are loaded multiple times,
  // instanceof might fail, so we also check for required methods
  const isBNInstance = 
    value instanceof anchor.BN ||
    (value && 
     typeof value === 'object' && 
     'lt' in value && 
     typeof (value as any).lt === 'function' &&
     'toString' in value &&
     typeof (value as any).toString === 'function');
  
  if (!isBNInstance) {
    throw new ValidationError(
      `${fieldName} must be a BN instance`,
      fieldName
    );
  }
  
  if (value.lt(new anchor.BN(0))) {
    throw new ValidationError(
      `${fieldName} must be non-negative, got ${value.toString()}`,
      fieldName
    );
  }
}

/**
 * Validates that a number is positive
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertPositiveNumber(
  value: number | null | undefined,
  fieldName: string
): asserts value is number {
  assertDefined(value, fieldName);
  
  // Check for NaN and Infinity explicitly
  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new ValidationError(
      `${fieldName} must be a finite number (got ${Number.isNaN(value) ? 'NaN' : !Number.isFinite(value) ? (value === Infinity ? 'Infinity' : '-Infinity') : typeof value})`,
      fieldName
    );
  }
  
  if (value < 0) {
    throw new ValidationError(
      `${fieldName} must be non-negative, got ${value}`,
      fieldName
    );
  }
}

/**
 * Validates that a string is not empty
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertNonEmptyString(
  value: string | null | undefined,
  fieldName: string
): asserts value is string {
  assertDefined(value, fieldName);
  
  if (typeof value !== 'string') {
    throw new ValidationError(
      `${fieldName} must be a string (got ${typeof value})`,
      fieldName
    );
  }
  
  // Handle edge case where value might be a String object instead of primitive
  const stringValue = String(value);
  if (stringValue.trim().length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }
}

/**
 * Validates that an array is not empty
 * Accepts both mutable and readonly arrays
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertNonEmptyArray<T>(
  value: T[] | readonly T[] | null | undefined,
  fieldName: string
): asserts value is T[] | readonly T[] {
  assertDefined(value, fieldName);
  
  // Use Array.isArray for maximum compatibility
  // In some edge cases, checking constructor.name might fail
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an array (got ${typeof value}${value && typeof value === 'object' ? ` with constructor ${(value as any).constructor?.name || 'unknown'}` : ''})`,
      fieldName
    );
  }
  
  if (value.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }
}

/**
 * Validates a TransactionInstruction
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertValidTransactionInstruction(
  value: anchor.web3.TransactionInstruction | null | undefined,
  fieldName: string
): asserts value is anchor.web3.TransactionInstruction {
  assertDefined(value, fieldName);
  
  // Check if it's a TransactionInstruction using both instanceof and duck typing
  // In React Native or when modules are loaded multiple times,
  // instanceof might fail, so we also check for required properties
  const isTransactionInstruction = 
    value instanceof anchor.web3.TransactionInstruction ||
    (value && 
     typeof value === 'object' && 
     'programId' in value && 
     'keys' in value &&
     Array.isArray((value as any).keys) &&
     'data' in value);
  
  if (!isTransactionInstruction) {
    throw new ValidationError(
      `${fieldName} must be a TransactionInstruction instance`,
      fieldName
    );
  }
  
  assertValidPublicKey(value.programId, `${fieldName}.programId`);
  
  if (!value.keys || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new ValidationError(
      `${fieldName} must have at least one account key`,
      fieldName
    );
  }
}

/**
 * Converts a value to a number array, validating it's a valid byte array
 */
export function toNumberArray(
  value: number[] | Uint8Array | Buffer
): number[] {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.from(value);
}

/**
 * Normalizes a PublicKey to a PublicKey instance
 * Validates the input and throws ValidationError if invalid
 */
export function normalizePublicKey(
  value: anchor.web3.PublicKey | string | null | undefined,
  fieldName: string = 'publicKey'
): anchor.web3.PublicKey {
  assertValidPublicKey(value, fieldName);
  if (typeof value === 'string') {
    return new anchor.web3.PublicKey(value);
  }
  return value;
}

/**
 * Validates that a value is a valid base64 string
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertValidBase64(
  value: string | null | undefined,
  fieldName: string
): asserts value is string {
  assertNonEmptyString(value, fieldName);
  
  // Basic base64 validation regex
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(value)) {
    throw new ValidationError(
      `${fieldName} is not a valid base64 string (invalid characters)`,
      fieldName
    );
  }
  
  // Try to decode to ensure it's valid
  // Handle both Node.js Buffer and browser/React Native environments
  try {
    // In browser/React Native, Buffer might be polyfilled
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      Buffer.from(value, 'base64');
    } else if (typeof atob !== 'undefined') {
      // Fallback to browser's atob for validation
      atob(value);
    } else {
      // If neither is available, we can't validate decoding
      // But we've already validated the format with regex
    }
  } catch (error) {
    throw new ValidationError(
      `${fieldName} is not a valid base64 string: ${
        error instanceof Error ? error.message : 'Invalid format'
      }`,
      fieldName
    );
  }
}

/**
 * Validates that a number is a positive integer
 * Works correctly in browser, Node.js, and React Native environments
 */
export function assertPositiveInteger(
  value: number | null | undefined,
  fieldName: string
): asserts value is number {
  assertDefined(value, fieldName);
  
  // Check for NaN and Infinity explicitly
  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new ValidationError(
      `${fieldName} must be a finite number (got ${Number.isNaN(value) ? 'NaN' : !Number.isFinite(value) ? (value === Infinity ? 'Infinity' : '-Infinity') : typeof value})`,
      fieldName
    );
  }
  
  if (!Number.isInteger(value)) {
    throw new ValidationError(
      `${fieldName} must be an integer, got ${value}`,
      fieldName
    );
  }
  
  if (value <= 0) {
    throw new ValidationError(
      `${fieldName} must be a positive integer, got ${value}`,
      fieldName
    );
  }
}

/**
 * Validates an array of PublicKeys
 */
export function assertValidPublicKeyArray(
  value: readonly anchor.web3.PublicKey[] | anchor.web3.PublicKey[] | null | undefined,
  fieldName: string
): asserts value is readonly anchor.web3.PublicKey[] | anchor.web3.PublicKey[] {
  assertNonEmptyArray(value, fieldName);
  value.forEach((pk, index) => {
    assertValidPublicKey(pk, `${fieldName}[${index}]`);
  });
}

/**
 * Validates an array of TransactionInstructions
 */
export function assertValidTransactionInstructionArray(
  value: readonly anchor.web3.TransactionInstruction[] | anchor.web3.TransactionInstruction[] | null | undefined,
  fieldName: string
): asserts value is readonly anchor.web3.TransactionInstruction[] | anchor.web3.TransactionInstruction[] {
  assertNonEmptyArray(value, fieldName);
  value.forEach((ix, index) => {
    assertValidTransactionInstruction(ix, `${fieldName}[${index}]`);
  });
}

/**
 * Converts a byte array-like value to a number array
 */
export function toNumberArraySafe(
  value: number[] | Uint8Array | readonly number[]
): number[] {
  return Array.isArray(value) ? [...value] : Array.from(value);
}

