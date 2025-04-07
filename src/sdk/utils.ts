import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { SECP256R1_NATIVE_PROGRAM } from './constant';

// Constants from the Rust code
const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;
const SIGNATURE_OFFSETS_START = 2;
const DATA_START = SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START;
const SIGNATURE_SERIALIZED_SIZE: number = 64;
const COMPRESSED_PUBKEY_SERIALIZED_SIZE = 33;
const FIELD_SIZE = 32;

// Order of secp256r1 curve (same as in Rust code)
const SECP256R1_ORDER = new Uint8Array([
  0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9,
  0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
]);

// Half order of secp256r1 curve (same as in Rust code)
const SECP256R1_HALF_ORDER = new Uint8Array([
  0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x7f, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xde, 0x73, 0x7d, 0x56, 0xd3, 0x8b, 0xcf, 0x42, 0x79, 0xdc,
  0xe5, 0x61, 0x7e, 0x31, 0x92, 0xa8,
]);

interface Secp256r1SignatureOffsets {
  signature_offset: number;
  signature_instruction_index: number;
  public_key_offset: number;
  public_key_instruction_index: number;
  message_data_offset: number;
  message_data_size: number;
  message_instruction_index: number;
}

function bytesOf(data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  } else if (Array.isArray(data)) {
    return new Uint8Array(data);
  } else {
    // Convert object to buffer using DataView for consistent byte ordering
    const buffer = new ArrayBuffer(Object.values(data).length * 2);
    const view = new DataView(buffer);
    Object.values(data).forEach((value, index) => {
      view.setUint16(index * 2, value as number, true);
    });
    return new Uint8Array(buffer);
  }
}

// Compare two big numbers represented as Uint8Arrays
function isGreaterThan(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return a.length > b.length;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

// Subtract one big number from another (a - b), both represented as Uint8Arrays
function subtractBigNumbers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  let borrow = 0;

  for (let i = a.length - 1; i >= 0; i--) {
    let diff = a[i] - b[i] - borrow;
    if (diff < 0) {
      diff += 256;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result[i] = diff;
  }

  return result;
}

export function createSecp256r1Instruction(
  message: Uint8Array,
  pubkey: Buffer<ArrayBuffer>,
  signature: Buffer<ArrayBuffer>
): TransactionInstruction {
  try {
    // Ensure signature is the correct length
    if (signature.length !== SIGNATURE_SERIALIZED_SIZE) {
      // Extract r and s from the signature
      const r = signature.slice(0, FIELD_SIZE);
      const s = signature.slice(FIELD_SIZE, FIELD_SIZE * 2);

      // Pad r and s to correct length if needed
      const paddedR = Buffer.alloc(FIELD_SIZE, 0);
      const paddedS = Buffer.alloc(FIELD_SIZE, 0);
      r.copy(paddedR, FIELD_SIZE - r.length);
      s.copy(paddedS, FIELD_SIZE - s.length);

      // Check if s > half_order, if so, compute s = order - s
      if (isGreaterThan(paddedS, SECP256R1_HALF_ORDER)) {
        const newS = subtractBigNumbers(SECP256R1_ORDER, paddedS);
        signature = Buffer.concat([paddedR, Buffer.from(newS)]);
      } else {
        signature = Buffer.concat([paddedR, paddedS]);
      }
    }

    // Verify lengths
    if (
      pubkey.length !== COMPRESSED_PUBKEY_SERIALIZED_SIZE ||
      signature.length !== SIGNATURE_SERIALIZED_SIZE
    ) {
      throw new Error('Invalid key or signature length');
    }

    // Calculate total size and create instruction data
    const totalSize =
      DATA_START +
      SIGNATURE_SERIALIZED_SIZE +
      COMPRESSED_PUBKEY_SERIALIZED_SIZE +
      message.length;

    const instructionData = new Uint8Array(totalSize);

    // Calculate offsets
    const numSignatures: number = 1;
    const publicKeyOffset = DATA_START;
    const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
    const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;

    // Write number of signatures
    instructionData.set(bytesOf([numSignatures, 0]), 0);

    // Create and write offsets
    const offsets: Secp256r1SignatureOffsets = {
      signature_offset: signatureOffset,
      signature_instruction_index: 0xffff, // u16::MAX
      public_key_offset: publicKeyOffset,
      public_key_instruction_index: 0xffff,
      message_data_offset: messageDataOffset,
      message_data_size: message.length,
      message_instruction_index: 0xffff,
    };

    // Write all components
    instructionData.set(bytesOf(offsets), SIGNATURE_OFFSETS_START);
    instructionData.set(pubkey, publicKeyOffset);
    instructionData.set(signature, signatureOffset);
    instructionData.set(message, messageDataOffset);

    return new TransactionInstruction({
      keys: [],
      programId: SECP256R1_NATIVE_PROGRAM,
      data: Buffer.from(instructionData),
    });
  } catch (error) {
    throw new Error(`Failed to create secp256r1 instruction: ${error}`);
  }
}

export function getID(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
