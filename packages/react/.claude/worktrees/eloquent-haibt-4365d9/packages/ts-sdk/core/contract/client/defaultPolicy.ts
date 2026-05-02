import * as anchor from '@coral-xyz/anchor';
import DefaultPolicyIdl from '../anchor/idl/default_policy.json';
import { DefaultPolicy } from '../anchor/types/default_policy';
import { derivePolicyPda } from '../pda/defaultPolicy';
import * as types from '../types';
import {
  assertValidPublicKey,
  assertValidPasskeyPublicKey,
  assertValidCredentialHash,
  assertPositiveBN,
  assertDefined,
  ValidationError,
  toNumberArraySafe,
} from '../validation';

/**
 * Parameters for building initialize policy instruction
 */
export interface BuildInitPolicyIxParams {
  /** Wallet ID (required, must be non-negative) */
  readonly walletId: anchor.BN;
  /** Passkey public key (33 bytes, required) */
  readonly passkeyPublicKey: types.PasskeyPublicKey | number[];
  /** Credential hash (32 bytes, required) */
  readonly credentialHash: types.CredentialHash | number[];
  /** Policy signer PDA address (required) */
  readonly policySigner: anchor.web3.PublicKey;
  /** Smart wallet PDA address (required) */
  readonly smartWallet: anchor.web3.PublicKey;
  /** Wallet state PDA address (required) */
  readonly walletState: anchor.web3.PublicKey;
}

/**
 * Parameters for building check policy instruction
 */
export interface BuildCheckPolicyIxParams {
  /** Wallet ID (required, must be non-negative) */
  readonly walletId: anchor.BN;
  /** Passkey public key (33 bytes, required) */
  readonly passkeyPublicKey: types.PasskeyPublicKey | number[];
  /** Policy signer PDA address (required) */
  readonly policySigner: anchor.web3.PublicKey;
  /** Smart wallet PDA address (required) */
  readonly smartWallet: anchor.web3.PublicKey;
  /** Credential hash (32 bytes, required) */
  readonly credentialHash: types.CredentialHash | number[];
  /** Policy data buffer (required, must be a Buffer instance) */
  readonly policyData: Buffer;
}

export class DefaultPolicyClient {
  readonly connection: anchor.web3.Connection;
  readonly program: anchor.Program<DefaultPolicy>;
  readonly programId: anchor.web3.PublicKey;

  constructor(connection: anchor.web3.Connection) {
    assertDefined(connection, 'connection');
    this.connection = connection;

    this.program = new anchor.Program<DefaultPolicy>(
      DefaultPolicyIdl as DefaultPolicy,
      {
        connection: connection,
      }
    );
    this.programId = this.program.programId;
  }

  /**
   * Gets the policy PDA for a given smart wallet
   *
   * @param smartWallet - Smart wallet PDA address
   * @returns Policy PDA address
   * @throws {ValidationError} if smartWallet is invalid
   */
  policyPda(smartWallet: anchor.web3.PublicKey): anchor.web3.PublicKey {
    assertValidPublicKey(smartWallet, 'smartWallet');
    return derivePolicyPda(this.programId, smartWallet);
  }

  /**
   * Gets the default policy data size in bytes
   *
   * @returns Policy data size in bytes
   */
  getPolicyDataSize(): number {
    return 1 + 32 + 4 + 33 + 32;
  }

  /**
   * Validates BuildInitPolicyIxParams
   */
  private validateInitPolicyParams(params: BuildInitPolicyIxParams): void {
    assertDefined(params, 'params');
    assertPositiveBN(params.walletId, 'params.walletId');
    assertValidPasskeyPublicKey(
      params.passkeyPublicKey,
      'params.passkeyPublicKey'
    );
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertValidPublicKey(params.policySigner, 'params.policySigner');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidPublicKey(params.walletState, 'params.walletState');
  }

  /**
   * Builds the initialize policy instruction
   *
   * @param params - Initialize policy parameters
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildInitPolicyIx(
    params: BuildInitPolicyIxParams
  ): Promise<anchor.web3.TransactionInstruction> {
    this.validateInitPolicyParams(params);

    return await this.program.methods
      .initPolicy(
        params.walletId,
        toNumberArraySafe(params.passkeyPublicKey),
        toNumberArraySafe(params.credentialHash)
      )
      .accountsPartial({
        smartWallet: params.smartWallet,
        walletState: params.walletState,
        policySigner: params.policySigner,
      })
      .instruction();
  }

  /**
   * Validates BuildCheckPolicyIxParams
   */
  private validateCheckPolicyParams(params: BuildCheckPolicyIxParams): void {
    assertDefined(params, 'params');
    assertPositiveBN(params.walletId, 'params.walletId');
    assertValidPasskeyPublicKey(
      params.passkeyPublicKey,
      'params.passkeyPublicKey'
    );
    assertValidPublicKey(params.policySigner, 'params.policySigner');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertDefined(params.policyData, 'params.policyData');
    if (!Buffer.isBuffer(params.policyData)) {
      throw new ValidationError(
        'params.policyData must be a Buffer instance',
        'params.policyData'
      );
    }
  }

  /**
   * Builds the check policy instruction
   *
   * @param params - Check policy parameters
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildCheckPolicyIx(
    params: BuildCheckPolicyIxParams
  ): Promise<anchor.web3.TransactionInstruction> {
    this.validateCheckPolicyParams(params);

    return await this.program.methods
      .checkPolicy(
        params.walletId,
        toNumberArraySafe(params.passkeyPublicKey),
        toNumberArraySafe(params.credentialHash),
        params.policyData
      )
      .accountsPartial({
        smartWallet: params.smartWallet,
        policySigner: params.policySigner,
      })
      .instruction();
  }
}
