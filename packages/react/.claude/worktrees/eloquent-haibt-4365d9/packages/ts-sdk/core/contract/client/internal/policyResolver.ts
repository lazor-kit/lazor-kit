import * as anchor from '@coral-xyz/anchor';
import { DefaultPolicyClient } from '../defaultPolicy';
import { WalletPdaFactory } from './walletPdas';
import * as types from '../../types';

type PublicKey = anchor.web3.PublicKey;
type TransactionInstruction = anchor.web3.TransactionInstruction;
type BN = anchor.BN;

interface ExecutePolicyContext {
  provided: TransactionInstruction | null;
  smartWallet: PublicKey;
  credentialHash: types.CredentialHash;
  passkeyPublicKey: types.PasskeyPublicKey | number[];
  walletStateData: types.WalletState;
}

interface CreatePolicyContext {
  provided?: TransactionInstruction | null;
  smartWalletId: BN;
  smartWallet: PublicKey;
  walletState: PublicKey;
  passkeyPublicKey: types.PasskeyPublicKey | number[];
  credentialHash: types.CredentialHash;
}

/**
 * Resolves policy instructions by either returning a provided instruction or
 * lazily falling back to the default policy program.
 */
export class PolicyInstructionResolver {
  constructor(
    private readonly policyClient: DefaultPolicyClient,
    private readonly walletPdas: WalletPdaFactory
  ) {}

  async resolveForExecute({
    provided,
    smartWallet,
    credentialHash,
    passkeyPublicKey,
    walletStateData,
  }: ExecutePolicyContext): Promise<TransactionInstruction> {
    if (provided !== null) {
      return provided;
    }

    const policySigner = this.walletPdas.walletDevice(
      smartWallet,
      credentialHash
    );

    return this.policyClient.buildCheckPolicyIx({
      walletId: walletStateData.walletId,
      passkeyPublicKey,
      policySigner,
      smartWallet,
      credentialHash,
      policyData: walletStateData.policyData,
    });
  }

  async resolveForCreate({
    provided,
    smartWalletId,
    smartWallet,
    walletState,
    passkeyPublicKey,
    credentialHash,
  }: CreatePolicyContext): Promise<TransactionInstruction> {
    if (provided !== null && provided !== undefined) {
      return provided;
    }

    const policySigner = this.walletPdas.walletDevice(
      smartWallet,
      credentialHash
    );

    return this.policyClient.buildInitPolicyIx({
      walletId: smartWalletId,
      passkeyPublicKey,
      credentialHash,
      policySigner,
      smartWallet,
      walletState,
    });
  }
}

