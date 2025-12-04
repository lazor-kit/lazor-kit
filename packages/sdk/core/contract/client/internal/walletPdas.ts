import * as anchor from '@coral-xyz/anchor';
import {
  deriveSmartWalletPda,
  deriveSmartWalletConfigPda,
  deriveChunkPda,
  deriveWalletDevicePda,
} from '../../pda/lazorkit';
import * as types from '../../types';
import {
  assertValidCredentialHash,
  assertValidPublicKey,
  assertPositiveBN,
} from '../../validation';

type PublicKey = anchor.web3.PublicKey;
type BN = anchor.BN;

/**
 * Helper responsible for deriving PDA addresses tied to the LazorKit program.
 * Centralizing these derivations keeps the main client small and ensures
 * consistent validation for every caller.
 */
export class WalletPdaFactory {
  constructor(private readonly programId: PublicKey) {}

  smartWallet(walletId: BN): PublicKey {
    assertPositiveBN(walletId, 'walletId');
    return deriveSmartWalletPda(this.programId, walletId);
  }

  walletState(smartWallet: PublicKey): PublicKey {
    assertValidPublicKey(smartWallet, 'smartWallet');
    return deriveSmartWalletConfigPda(this.programId, smartWallet);
  }

  walletDevice(
    smartWallet: PublicKey,
    credentialHash: types.CredentialHash | number[]
  ): PublicKey {
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertValidCredentialHash(credentialHash, 'credentialHash');

    return deriveWalletDevicePda(
      this.programId,
      smartWallet,
      credentialHash
    )[0];
  }

  chunk(smartWallet: PublicKey, nonce: BN): PublicKey {
    assertValidPublicKey(smartWallet, 'smartWallet');
    return deriveChunkPda(this.programId, smartWallet, nonce);
  }
}

