import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';

// Constants from the Rust code
const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;
const SIGNATURE_OFFSETS_START = 2;
const DATA_START = SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START;
const SIGNATURE_SERIALIZED_SIZE: number = 64;
const COMPRESSED_PUBKEY_SERIALIZED_SIZE = 33;

const SECP256R1_NATIVE_PROGRAM = new anchor.web3.PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
);

type Secp256r1SignatureOffsets = {
  signature_offset: number;
  signature_instruction_index: number;
  public_key_offset: number;
  public_key_instruction_index: number;
  message_data_offset: number;
  message_data_size: number;
  message_instruction_index: number;
};

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

export function buildSecp256r1VerifyIx(
  message: Uint8Array,
  pubkey: number[],
  signature: Buffer<ArrayBuffer>
): anchor.web3.TransactionInstruction {
  // Verify lengths - matching Rust validation
  if (
    pubkey.length !== COMPRESSED_PUBKEY_SERIALIZED_SIZE ||
    signature.length !== SIGNATURE_SERIALIZED_SIZE
  ) {
    throw new Error('Invalid key or signature length');
  }

  // Calculate total size - matching Rust capacity calculation
  const totalSize =
    DATA_START +
    SIGNATURE_SERIALIZED_SIZE +
    COMPRESSED_PUBKEY_SERIALIZED_SIZE +
    message.length;

  const instructionData = new Uint8Array(totalSize);

  // Calculate offsets - matching Rust offset calculation
  const numSignatures: number = 1;
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;

  // Write number of signatures - matching Rust: bytes_of(&[num_signatures, 0])
  instructionData.set(bytesOf([numSignatures, 0]), 0);

  // Create and write offsets - matching Rust Secp256r1SignatureOffsets
  const offsets: Secp256r1SignatureOffsets = {
    signature_offset: signatureOffset,
    signature_instruction_index: 0xffff, // u16::MAX
    public_key_offset: publicKeyOffset,
    public_key_instruction_index: 0xffff, // u16::MAX
    message_data_offset: messageDataOffset,
    message_data_size: message.length,
    message_instruction_index: 0xffff, // u16::MAX
  };

  // Write all components - matching Rust extend_from_slice order
  instructionData.set(bytesOf(offsets), SIGNATURE_OFFSETS_START);
  instructionData.set(pubkey, publicKeyOffset);
  instructionData.set(signature, signatureOffset);
  instructionData.set(message, messageDataOffset);

  return new anchor.web3.TransactionInstruction({
    keys: [],
    programId: SECP256R1_NATIVE_PROGRAM,
    data: Buffer.from(instructionData),
  });
}
