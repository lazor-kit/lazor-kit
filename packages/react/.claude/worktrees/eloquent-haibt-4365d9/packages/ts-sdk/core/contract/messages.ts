import * as anchor from '@coral-xyz/anchor';
import { sha256 } from 'js-sha256';
import { instructionToAccountMetas } from './utils';
import { Buffer } from 'buffer';

// Simplified IDL definition - all messages are now just 32-byte hashes
const createMessageIdl = (): any => ({
  version: '0.1.0',
  name: 'lazorkit_msgs',
  instructions: [],
  accounts: [],
  types: [
    {
      name: 'SimpleMessage',
      type: {
        kind: 'struct',
        fields: [{ name: 'dataHash', type: { array: ['u8', 32] } }],
      },
    },
  ],
});

// Lazy-loaded coder for better performance
let coder: anchor.BorshCoder | null = null;
const getCoder = (): anchor.BorshCoder => {
  if (!coder) {
    coder = new anchor.BorshCoder(createMessageIdl());
  }
  return coder;
};

// Optimized hash computation with better performance
const computeHash = (data: Uint8Array): Uint8Array => {
  return new Uint8Array(sha256.arrayBuffer(data));
};

// Optimized single instruction accounts hash computation
const computeSingleInsAccountsHash = (
  programId: anchor.web3.PublicKey,
  metas: anchor.web3.AccountMeta[],
  smartWallet: anchor.web3.PublicKey
): Uint8Array => {
  const h = sha256.create();
  h.update(programId.toBytes());

  for (const meta of metas) {
    h.update(meta.pubkey.toBytes());
    h.update(Uint8Array.from([meta.isSigner ? 1 : 0]));
    h.update(
      Uint8Array.from([
        meta.pubkey.toString() === smartWallet.toString() || meta.isWritable
          ? 1
          : 0,
      ])
    );
  }

  return new Uint8Array(h.arrayBuffer());
};

// Optimized multiple instructions accounts hash computation
const computeAllInsAccountsHash = (
  metas: anchor.web3.AccountMeta[],
  smartWallet: anchor.web3.PublicKey
): Uint8Array => {
  // Use Map for O(1) lookups instead of repeated array operations
  const pubkeyProperties = new Map<
    string,
    { isSigner: boolean; isWritable: boolean }
  >();

  // Single pass to collect properties
  for (const meta of metas) {
    const key = meta.pubkey.toString();
    const existing = pubkeyProperties.get(key);

    if (existing) {
      existing.isSigner = existing.isSigner || meta.isSigner;
      existing.isWritable = existing.isWritable || meta.isWritable;
    } else {
      pubkeyProperties.set(key, {
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      });
    }
  }

  // Create processed metas with optimized properties
  const processedMetas = metas.map((meta) => {
    const key = meta.pubkey.toString();
    const properties = pubkeyProperties.get(key)!;

    return {
      pubkey: meta.pubkey,
      isSigner: properties.isSigner,
      isWritable: properties.isWritable,
    };
  });

  const h = sha256.create();
  for (const meta of processedMetas) {
    h.update(meta.pubkey.toBytes());
    h.update(Uint8Array.from([meta.isSigner ? 1 : 0]));
    h.update(
      Uint8Array.from([
        meta.pubkey.toString() === smartWallet.toString() || meta.isWritable
          ? 1
          : 0,
      ])
    );
  }

  return new Uint8Array(h.arrayBuffer());
};

// Helper function to compute policy hashes
const computePolicyHashes = (
  policyIns: anchor.web3.TransactionInstruction,
  smartWallet: anchor.web3.PublicKey
): { policyDataHash: Uint8Array; policyAccountsHash: Uint8Array } => {
  const policyMetas = instructionToAccountMetas(policyIns);
  const policyAccountsHash = computeSingleInsAccountsHash(
    policyIns.programId,
    policyMetas,
    smartWallet
  );
  const policyDataHash = computeHash(policyIns.data);

  return { policyDataHash, policyAccountsHash };
};

// Helper function to compute CPI hashes for single instruction
const computeCpiHashes = (
  cpiIns: anchor.web3.TransactionInstruction,
  smartWallet: anchor.web3.PublicKey,
  signers?: readonly anchor.web3.PublicKey[]
): { cpiDataHash: Uint8Array; cpiAccountsHash: Uint8Array } => {
  const cpiMetas = instructionToAccountMetas(cpiIns, signers);
  const cpiAccountsHash = computeSingleInsAccountsHash(
    cpiIns.programId,
    cpiMetas,
    smartWallet
  );
  const cpiDataHash = computeHash(cpiIns.data);

  return { cpiDataHash, cpiAccountsHash };
};

// Helper function to compute CPI hashes for multiple instructions
export const computeMultipleCpiHashes = (
  cpiInstructions: readonly anchor.web3.TransactionInstruction[],
  smartWallet: anchor.web3.PublicKey,
  cpiSigners?: readonly anchor.web3.PublicKey[]
): { cpiDataHash: Uint8Array; cpiAccountsHash: Uint8Array } => {
  // Optimized serialization without unnecessary Buffer allocations
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(cpiInstructions.length, 0);

  const serializedData = Buffer.concat([
    lengthBuffer,
    ...cpiInstructions.map((ix) => {
      const data = Buffer.from(ix.data);
      const dataLengthBuffer = Buffer.alloc(4);
      dataLengthBuffer.writeUInt32LE(data.length, 0);
      return Buffer.concat([dataLengthBuffer, data]);
    }),
  ]);

  const cpiDataHash = computeHash(serializedData);

  const allMetas = cpiInstructions.flatMap((ix) => [
    { pubkey: ix.programId, isSigner: false, isWritable: false },
    ...instructionToAccountMetas(ix, cpiSigners),
  ]);

  const cpiAccountsHash = computeAllInsAccountsHash(allMetas, smartWallet);

  return { cpiDataHash, cpiAccountsHash };
};

// Helper function to encode message with proper error handling
const encodeMessage = <T>(messageType: string, data: T): Buffer => {
  try {
    const encoded = getCoder().types.encode(messageType, data);
    return Buffer.from(encoded);
  } catch (error) {
    throw new Error(
      `Failed to encode ${messageType}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
};

// Main message building functions with simplified 32-byte hash structure
export function buildExecuteMessage(
  smartWallet: anchor.web3.PublicKey,
  nonce: anchor.BN,
  timestamp: anchor.BN,
  policyIns: anchor.web3.TransactionInstruction,
  cpiIns: anchor.web3.TransactionInstruction,
  cpiSigners?: readonly anchor.web3.PublicKey[]
): Buffer {
  const policyHashes = computePolicyHashes(policyIns, smartWallet);
  const cpiHashes = computeCpiHashes(cpiIns, smartWallet, cpiSigners ?? []);

  // Create combined hash of policy hashes
  const policyCombined = new Uint8Array(64); // 32 + 32 bytes
  policyCombined.set(policyHashes.policyDataHash, 0);
  policyCombined.set(policyHashes.policyAccountsHash, 32);
  const policyHash = computeHash(policyCombined);

  // Create combined hash of CPI hashes
  const cpiCombined = new Uint8Array(64); // 32 + 32 bytes
  cpiCombined.set(cpiHashes.cpiDataHash, 0);
  cpiCombined.set(cpiHashes.cpiAccountsHash, 32);
  const cpiHash = computeHash(cpiCombined);

  // Create final hash: hash(nonce, timestamp, policyHash, cpiHash)
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(BigInt(nonce.toString()), 0);

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigInt64LE(BigInt(timestamp.toString()), 0);

  const finalData = Buffer.concat([
    nonceBuffer,
    timestampBuffer,
    Buffer.from(policyHash),
    Buffer.from(cpiHash),
  ]);

  const dataHash = computeHash(finalData);

  return encodeMessage('SimpleMessage', {
    dataHash: Array.from(dataHash),
  });
}

export function buildCreateChunkMessage(
  smartWallet: anchor.web3.PublicKey,
  nonce: anchor.BN,
  timestamp: anchor.BN,
  policyIns: anchor.web3.TransactionInstruction,
  cpiInstructions: readonly anchor.web3.TransactionInstruction[],
  cpiSigners?: readonly anchor.web3.PublicKey[]
): Buffer {
  const policyHashes = computePolicyHashes(policyIns, smartWallet);
  const cpiHashes = computeMultipleCpiHashes(
    cpiInstructions,
    smartWallet,
    cpiSigners
  );

  // Create combined hash of policy hashes
  const policyCombined = new Uint8Array(64); // 32 + 32 bytes
  policyCombined.set(policyHashes.policyDataHash, 0);
  policyCombined.set(policyHashes.policyAccountsHash, 32);
  const policyHash = computeHash(policyCombined);

  // Create combined hash of CPI hashes
  const cpiCombined = new Uint8Array(64); // 32 + 32 bytes
  cpiCombined.set(cpiHashes.cpiDataHash, 0);
  cpiCombined.set(cpiHashes.cpiAccountsHash, 32);

  const cpiHash = computeHash(cpiCombined);

  // Create final hash: hash(nonce, timestamp, policyHash, cpiHash)
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(BigInt(nonce.toString()), 0);

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigInt64LE(BigInt(timestamp.toString()), 0);

  const finalData = Buffer.concat([
    nonceBuffer,
    timestampBuffer,
    Buffer.from(policyHash),
    Buffer.from(cpiHash),
  ]);

  const dataHash = computeHash(finalData);

  return encodeMessage('SimpleMessage', {
    dataHash: Array.from(dataHash),
  });
}
