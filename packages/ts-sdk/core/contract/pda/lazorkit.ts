import * as anchor from '@coral-xyz/anchor';
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
// Mirror on-chain seeds

export const SMART_WALLET_SEED = Buffer.from('smart_wallet');
export const SMART_WALLET_CONFIG_SEED = Buffer.from('wallet_state');
export const WALLET_DEVICE_SEED = Buffer.from('wallet_device');
export const CHUNK_SEED = Buffer.from('chunk');

export function deriveSmartWalletPda(
  programId: anchor.web3.PublicKey,
  walletId: anchor.BN
): anchor.web3.PublicKey {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [SMART_WALLET_SEED, walletId.toArrayLike(Buffer, 'le', 8)],
    programId
  )[0];
}

export function deriveSmartWalletConfigPda(
  programId: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [SMART_WALLET_CONFIG_SEED, smartWallet.toBuffer()],
    programId
  )[0];
}

function createWalletDeviceHash(
  smartWallet: anchor.web3.PublicKey,
  credentialHash: number[]
): Buffer {
  const rawBuffer = Buffer.concat([
    smartWallet.toBuffer(),
    Buffer.from(credentialHash),
  ]);
  const hash = sha256.arrayBuffer(rawBuffer);
  return Buffer.from(hash).subarray(0, 32);
}

export function deriveWalletDevicePda(
  programId: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey,
  credentialHash: number[]
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [WALLET_DEVICE_SEED, createWalletDeviceHash(smartWallet, credentialHash)],
    programId
  );
}

export function deriveChunkPda(
  programId: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey,
  lastNonce: anchor.BN
): anchor.web3.PublicKey {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [
      CHUNK_SEED,
      smartWallet.toBuffer(),
      lastNonce.toArrayLike(Buffer, 'le', 8),
    ],
    programId
  )[0];
}
