import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
import * as types from './types';

export function instructionToAccountMetas(
  ix: anchor.web3.TransactionInstruction,
  signers?: readonly anchor.web3.PublicKey[]
): anchor.web3.AccountMeta[] {
  return ix.keys.map((k) => ({
    pubkey: k.pubkey,
    isWritable: k.isWritable,
    isSigner: signers
      ? signers.some((s) => s.toString() === k.pubkey.toString())
      : false,
  }));
}

export function getRandomBytes(len: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint8Array(len);
    globalThis.crypto.getRandomValues(arr);
    return arr;
  }
  try {
    // Node.js fallback
    const { randomBytes } = require('crypto');
    return randomBytes(len);
  } catch {
    throw new Error('No CSPRNG available');
  }
}

export function byteArrayEquals(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function credentialHashFromBase64(
  credentialIdBase64: string
): types.CredentialHash {
  const credentialId = Buffer.from(credentialIdBase64, 'base64');
  return Array.from(
    new Uint8Array(sha256.arrayBuffer(credentialId))
  ) as types.CredentialHash;
}

// Helper function to get blockchain timestamp
export async function getBlockchainTimestamp(
  connection: anchor.web3.Connection
): Promise<anchor.BN> {
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot);
  return new anchor.BN(blockTime || Math.floor(Date.now() / 1000));
}