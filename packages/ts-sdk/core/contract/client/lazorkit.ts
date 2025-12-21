import * as anchor from '@coral-xyz/anchor';
import LazorkitIdl from '../anchor/idl/lazorkit.json';
import { Lazorkit } from '../anchor/types/lazorkit';
import {
  credentialHashFromBase64,
  getRandomBytes,
  instructionToAccountMetas,
} from '../utils';
import * as types from '../types';
import { DefaultPolicyClient } from './defaultPolicy';
import { WalletPdaFactory } from './internal/walletPdas';
import { PolicyInstructionResolver } from './internal/policyResolver';
import {
  calculateCpiHash,
  calculateSplitIndex,
  collectCpiAccountMetas,
} from './internal/cpi';
import * as bs58 from 'bs58';
import { buildCreateChunkMessage } from '../messages';
import { Buffer } from 'buffer';
import {
  buildPasskeyVerificationInstruction,
  convertPasskeySignatureToInstructionArgs,
} from '../auth';
import {
  buildTransaction,
  combineInstructionsWithAuth,
  calculateVerifyInstructionIndex,
} from '../transaction';
import { EMPTY_PDA_RENT_EXEMPT_BALANCE } from '../constants';
import {
  assertValidPublicKey,
  assertValidPasskeyPublicKey,
  assertValidCredentialHash,
  assertPositiveBN,
  assertValidTransactionInstruction,
  assertDefined,
  ValidationError,
  assertValidBase64,
  assertPositiveInteger,
  assertValidPublicKeyArray,
  assertValidTransactionInstructionArray,
  assertValidPasskeySignature,
} from '../validation';

// Type aliases for convenience
type PublicKey = anchor.web3.PublicKey;
type TransactionInstruction = anchor.web3.TransactionInstruction;
type Transaction = anchor.web3.Transaction;
type VersionedTransaction = anchor.web3.VersionedTransaction;
type BN = anchor.BN;

global.Buffer = Buffer;

Buffer.prototype.subarray = function subarray(
  begin: number | undefined,
  end: number | undefined
) {
  const result = Uint8Array.prototype.subarray.apply(this, [begin, end]);
  Object.setPrototypeOf(result, Buffer.prototype); // Explicitly add the `Buffer` prototype (adds `readUIntLE`!)
  return result;
};

/**
 * Main client for interacting with the LazorKit smart wallet program
 *
 * This client provides both low-level instruction builders and high-level
 * transaction builders for common smart wallet operations.
 */
export class LazorkitClient {
  readonly connection: anchor.web3.Connection;
  readonly program: anchor.Program<Lazorkit>;
  readonly programId: anchor.web3.PublicKey;
  readonly defaultPolicyProgram: DefaultPolicyClient;
  private readonly walletPdas: WalletPdaFactory;
  private readonly policyResolver: PolicyInstructionResolver;

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
    this.program = new anchor.Program<Lazorkit>(LazorkitIdl as Lazorkit, {
      connection: connection,
    });
    this.programId = this.program.programId;
    this.defaultPolicyProgram = new DefaultPolicyClient(connection);
    this.walletPdas = new WalletPdaFactory(this.programId);
    this.policyResolver = new PolicyInstructionResolver(
      this.defaultPolicyProgram,
      this.walletPdas
    );
  }

  // ============================================================================
  // PDA Derivation Methods
  // ============================================================================

  /**
   * Derives a smart wallet PDA from wallet ID
   */
  getSmartWalletPubkey(walletId: BN): PublicKey {
    return this.walletPdas.smartWallet(walletId);
  }

  /**
   * Derives the smart wallet data PDA for a given smart wallet
   */
  getWalletStatePubkey(smartWallet: PublicKey): PublicKey {
    return this.walletPdas.walletState(smartWallet);
  }

  /**
   * Derives a wallet device PDA for a given smart wallet and passkey
   *
   * @param smartWallet - Smart wallet PDA address
   * @param credentialHash - Credential hash (32 bytes)
   * @returns Wallet device PDA address
   * @throws {ValidationError} if parameters are invalid
   */
  getWalletDevicePubkey(
    smartWallet: PublicKey,
    credentialHash: types.CredentialHash | number[]
  ): PublicKey {
    return this.walletPdas.walletDevice(smartWallet, credentialHash);
  }

  /**
   * Derives a transaction session PDA for a given smart wallet and nonce
   */
  getChunkPubkey(smartWallet: PublicKey, lastNonce: BN): PublicKey {
    return this.walletPdas.chunk(smartWallet, lastNonce);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generates a random wallet ID
   */
  generateWalletId(): BN {
    return new anchor.BN(getRandomBytes(8), 'le');
  }

  private async fetchWalletStateContext(smartWallet: PublicKey): Promise<{
    walletState: PublicKey;
    data: types.WalletState;
  }> {
    const walletState = this.getWalletStatePubkey(smartWallet);
    const data = (await this.program.account.walletState.fetch(
      walletState
    )) as types.WalletState;
    return { walletState, data };
  }

  private async fetchChunkContext(
    smartWallet: PublicKey,
    nonce: BN
  ): Promise<{ chunk: PublicKey; data: types.Chunk }> {
    const chunk = this.getChunkPubkey(smartWallet, nonce);
    const data = (await this.program.account.chunk.fetch(chunk)) as types.Chunk;
    return { chunk, data };
  }

  /**
   * Validates CreateSmartWalletParams
   */
  private validateCreateSmartWalletParams(
    params: types.CreateSmartWalletParams
  ): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPasskeyPublicKey(
      params.passkeyPublicKey,
      'params.passkeyPublicKey'
    );
    assertValidBase64(params.credentialIdBase64, 'params.credentialIdBase64');

    if (params.amount !== undefined) {
      assertPositiveBN(params.amount, 'params.amount');
    }
    if (params.smartWalletId !== undefined) {
      assertPositiveBN(params.smartWalletId, 'params.smartWalletId');
    }
    if (params.policyDataSize !== undefined) {
      assertPositiveInteger(params.policyDataSize, 'params.policyDataSize');
    }
    if (params.policyInstruction !== undefined) {
      assertValidTransactionInstruction(
        params.policyInstruction,
        'params.policyInstruction'
      );
    }
  }

  /**
   * Validates ExecuteParams
   */
  private validateExecuteParams(params: types.ExecuteParams): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidPasskeySignature(
      params.passkeySignature,
      'params.passkeySignature'
    );
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertValidTransactionInstruction(
      params.cpiInstruction,
      'params.cpiInstruction'
    );
    assertPositiveBN(params.timestamp, 'params.timestamp');

    if (params.policyInstruction !== undefined) {
      assertValidTransactionInstruction(
        params.policyInstruction,
        'params.policyInstruction'
      );
    }
    if (params.cpiSigners !== undefined) {
      assertValidPublicKeyArray(params.cpiSigners, 'params.cpiSigners');
    }
  }

  /**
   * Validates CreateChunkParams
   */
  private validateCreateChunkParams(params: types.CreateChunkParams): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidPasskeySignature(
      params.passkeySignature,
      'params.passkeySignature'
    );
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertValidTransactionInstructionArray(
      params.cpiInstructions,
      'params.cpiInstructions'
    );
    assertPositiveBN(params.timestamp, 'params.timestamp');

    if (params.policyInstruction !== undefined) {
      assertValidTransactionInstruction(
        params.policyInstruction,
        'params.policyInstruction'
      );
    }
    if (params.cpiSigners !== undefined) {
      assertValidPublicKeyArray(params.cpiSigners, 'params.cpiSigners');
    }
  }

  /**
   * Validates ExecuteChunkParams
   */
  private validateExecuteChunkParams(params: types.ExecuteChunkParams): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidTransactionInstructionArray(
      params.cpiInstructions,
      'params.cpiInstructions'
    );

    if (params.cpiSigners !== undefined) {
      assertValidPublicKeyArray(params.cpiSigners, 'params.cpiSigners');
    }
  }

  // ============================================================================
  // Account Data Fetching Methods
  // ============================================================================

  /**
   * Fetches smart wallet data for a given smart wallet
   */
  async getWalletStateData(smartWallet: PublicKey) {
    const { data } = await this.fetchWalletStateContext(smartWallet);
    return data;
  }

  /**
   * Fetches transaction session data for a given transaction session
   */
  async getChunkData(chunk: PublicKey) {
    return (await this.program.account.chunk.fetch(chunk)) as types.Chunk;
  }

  /**
   * Find smart wallet by credential hash
   * Searches through all WalletState accounts to find one containing the specified credential hash
   *
   * @param credentialHash - Credential hash (32 bytes)
   * @returns Smart wallet information or null if not found
   * @throws {ValidationError} if credentialHash is invalid
   */
  async getSmartWalletByCredentialHash(
    credentialHash: types.CredentialHash | number[]
  ) {
    assertValidCredentialHash(credentialHash, 'credentialHash');
    // Get the discriminator for WalletState accounts
    const discriminator = LazorkitIdl.accounts?.find(
      (a: any) => a.name === 'WalletDevice'
    )?.discriminator;

    if (!discriminator) {
      throw new ValidationError(
        'WalletDevice discriminator not found in IDL',
        'credentialHash'
      );
    }

    // Get wallet_device have this credential hash
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.default.encode(discriminator) } },
        {
          memcmp: { offset: 8 + 33, bytes: bs58.default.encode(credentialHash) },
        },
      ],
    });

    if (accounts.length === 0) {
      return null;
    }
    for (const account of accounts) {
      const walletDevice = await this.program.account.walletDevice.fetch(
        account.pubkey
      );
      return {
        smartWallet: walletDevice.smartWallet,
        walletState: this.getWalletStatePubkey(walletDevice.smartWallet),
        walletDevice: account.pubkey,
        passkeyPublicKey: walletDevice.passkeyPubkey,
      };
    }

    return null;
  }

  // ============================================================================
  // Low-Level Instruction Builders
  // =======================================c=====================================

  /**
   * Builds the create smart wallet instruction
   *
   * @param payer - Payer account public key
   * @param smartWallet - Smart wallet PDA address
   * @param policyInstruction - Policy initialization instruction
   * @param args - Create smart wallet arguments
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildCreateSmartWalletIns(
    payer: PublicKey,
    smartWallet: PublicKey,
    policyInstruction: TransactionInstruction,
    args: types.CreateSmartWalletArgs
  ): Promise<TransactionInstruction> {
    assertValidPublicKey(payer, 'payer');
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertValidTransactionInstruction(policyInstruction, 'policyInstruction');
    assertDefined(args, 'args');
    assertValidPasskeyPublicKey(args.passkeyPublicKey, 'args.passkeyPublicKey');
    assertValidCredentialHash(args.credentialHash, 'args.credentialHash');
    assertPositiveBN(args.walletId, 'args.walletId');
    assertPositiveBN(args.amount, 'args.amount');

    return await this.program.methods
      .createSmartWallet(args)
      .accountsPartial({
        payer,
        smartWallet,
        walletState: this.getWalletStatePubkey(smartWallet),
        walletDevice: this.getWalletDevicePubkey(
          smartWallet,
          args.credentialHash
        ),
        policyProgram: policyInstruction.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([...instructionToAccountMetas(policyInstruction)])
      .instruction();
  }

  /**
   * Builds the execute direct transaction instruction
   *
   * @param payer - Payer account public key
   * @param smartWallet - Smart wallet PDA address
   * @param walletDevice - Wallet device PDA address
   * @param args - Execute arguments
   * @param policyInstruction - Policy check instruction
   * @param cpiInstruction - CPI instruction to execute
   * @param cpiSigners - Optional signers for CPI instruction
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildExecuteIns(
    payer: PublicKey,
    smartWallet: PublicKey,
    walletDevice: PublicKey,
    args: types.ExecuteArgs,
    policyInstruction: TransactionInstruction,
    cpiInstruction: TransactionInstruction,
    cpiSigners?: readonly PublicKey[]
  ): Promise<TransactionInstruction> {
    assertValidPublicKey(payer, 'payer');
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertValidPublicKey(walletDevice, 'walletDevice');
    assertDefined(args, 'args');
    assertValidTransactionInstruction(policyInstruction, 'policyInstruction');
    assertValidTransactionInstruction(cpiInstruction, 'cpiInstruction');

    // Validate cpiSigners if provided
    if (cpiSigners !== undefined) {
      assertValidPublicKeyArray(cpiSigners, 'cpiSigners');
    }

    return await this.program.methods
      .execute(args)
      .accountsPartial({
        payer,
        smartWallet,
        walletState: this.getWalletStatePubkey(smartWallet),
        walletDevice,
        policyProgram: policyInstruction.programId,
        cpiProgram: cpiInstruction.programId,
        ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        ...instructionToAccountMetas(policyInstruction),
        ...instructionToAccountMetas(cpiInstruction, cpiSigners),
      ])
      .instruction();
  }

  /**
   * Builds the create deferred execution instruction
   *
   * @param payer - Payer account public key
   * @param smartWallet - Smart wallet PDA address
   * @param walletDevice - Wallet device PDA address
   * @param args - Create chunk arguments
   * @param policyInstruction - Policy check instruction
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildCreateChunkIns(
    payer: PublicKey,
    smartWallet: PublicKey,
    walletDevice: PublicKey,
    args: types.CreateChunkArgs,
    policyInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    assertValidPublicKey(payer, 'payer');
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertValidPublicKey(walletDevice, 'walletDevice');
    assertDefined(args, 'args');
    assertValidTransactionInstruction(policyInstruction, 'policyInstruction');

    const { walletState, data: walletStateData } =
      await this.fetchWalletStateContext(smartWallet);
    const chunkPda = this.getChunkPubkey(
      smartWallet,
      walletStateData.lastNonce
    );

    return await this.program.methods
      .createChunk(args)
      .accountsPartial({
        payer,
        smartWallet,
        walletState,
        walletDevice,
        policyProgram: policyInstruction.programId,
        chunk: chunkPda,
        ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([...instructionToAccountMetas(policyInstruction)])
      .instruction();
  }

  /**
   * Builds the execute deferred transaction instruction
   *
   * @param payer - Payer account public key
   * @param smartWallet - Smart wallet PDA address
   * @param cpiInstructions - CPI instructions to execute
   * @param cpiSigners - Optional signers for CPI instructions
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildExecuteChunkIns(
    payer: PublicKey,
    smartWallet: PublicKey,
    cpiInstructions: readonly TransactionInstruction[],
    cpiSigners?: readonly PublicKey[]
  ): Promise<TransactionInstruction> {
    assertValidPublicKey(payer, 'payer');
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertValidTransactionInstructionArray(cpiInstructions, 'cpiInstructions');

    // Validate cpiSigners if provided
    if (cpiSigners !== undefined) {
      assertValidPublicKeyArray(cpiSigners, 'cpiSigners');
    }

    const { data: walletStateData, walletState } =
      await this.fetchWalletStateContext(smartWallet);
    const { chunk, data: chunkData } = await this.fetchChunkContext(
      smartWallet,
      walletStateData.lastNonce
    );
    // Prepare CPI data and split indices
    const instructionDataList = cpiInstructions.map(
      (ix: TransactionInstruction) => Buffer.from(ix.data)
    );
    const splitIndex = calculateSplitIndex(cpiInstructions);
    const allAccountMetas = collectCpiAccountMetas(cpiInstructions, cpiSigners);

    return await this.program.methods
      .executeChunk(instructionDataList, Buffer.from(splitIndex))
      .accountsStrict({
        payer,
        smartWallet,
        walletState,
        chunk,
        sessionRefund: chunkData.rentRefundAddress,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(allAccountMetas)
      .instruction();
  }

  // ============================================================================
  // High-Level Transaction Builders (with Authentication)
  // ============================================================================

  /**
   * Creates a smart wallet with passkey authentication
   *
   * @param params - Create smart wallet parameters
   * @param options - Transaction builder options
   * @returns Transaction and wallet information
   * @throws {ValidationError} if parameters are invalid
   */
  async createSmartWalletTxn(
    params: types.CreateSmartWalletParams,
    options: types.TransactionBuilderOptions = {}
  ): Promise<{
    transaction: Transaction | VersionedTransaction;
    smartWalletId: BN;
    smartWallet: PublicKey;
  }> {
    this.validateCreateSmartWalletParams(params);

    const smartWalletId = params.smartWalletId ?? this.generateWalletId();
    const smartWallet = this.getSmartWalletPubkey(smartWalletId);
    const walletState = this.getWalletStatePubkey(smartWallet);
    const amount =
      params.amount ?? new anchor.BN(EMPTY_PDA_RENT_EXEMPT_BALANCE);
    const policyDataSize =
      params.policyDataSize ?? this.defaultPolicyProgram.getPolicyDataSize();
    const credentialHash = credentialHashFromBase64(params.credentialIdBase64);

    const policyInstruction = await this.policyResolver.resolveForCreate({
      provided: params.policyInstruction,
      smartWalletId,
      smartWallet,
      walletState,
      passkeyPublicKey: params.passkeyPublicKey,
      credentialHash,
    });

    const args = {
      passkeyPublicKey: params.passkeyPublicKey,
      credentialHash,
      initPolicyData: policyInstruction.data,
      walletId: smartWalletId,
      amount,
      policyDataSize,
    };

    const instruction = await this.buildCreateSmartWalletIns(
      params.payer,
      smartWallet,
      policyInstruction,
      args
    );

    const result = await buildTransaction(
      this.connection,
      params.payer,
      [instruction],
      options
    );
    const transaction = result.transaction;

    return {
      transaction,
      smartWalletId,
      smartWallet,
    };
  }

  /**
   * Executes a direct transaction with passkey authentication
   *
   * @param params - Execute parameters
   * @param options - Transaction builder options
   * @returns Transaction
   * @throws {ValidationError} if parameters are invalid
   */
  async executeTxn(
    params: types.ExecuteParams,
    options: types.TransactionBuilderOptions = {}
  ): Promise<Transaction | VersionedTransaction> {
    this.validateExecuteParams(params);

    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    const walletStateData = await this.getWalletStateData(params.smartWallet);
    const policySigner = this.getWalletDevicePubkey(
      params.smartWallet,
      params.credentialHash
    );
    const policyInstruction = await this.policyResolver.resolveForExecute({
      provided: params.policyInstruction,
      smartWallet: params.smartWallet,
      credentialHash: params.credentialHash,
      passkeyPublicKey: params.passkeySignature.passkeyPublicKey,
      walletStateData,
    });

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const execInstruction = await this.buildExecuteIns(
      params.payer,
      params.smartWallet,
      policySigner,
      {
        ...signatureArgs,
        verifyInstructionIndex: calculateVerifyInstructionIndex(
          options.computeUnitLimit
        ),
        splitIndex: policyInstruction.keys.length,
        policyData: policyInstruction.data,
        cpiData: params.cpiInstruction.data,
        timestamp: params.timestamp,
      },
      policyInstruction,
      params.cpiInstruction,
      [...(params.cpiSigners ?? []), params.payer]
    );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      execInstruction,
    ]);

    const result = await buildTransaction(
      this.connection,
      params.payer,
      instructions,
      options
    );

    return result.transaction;
  }

  /**
   * Creates a deferred execution with passkey authentication
   *
   * @param params - Create chunk parameters
   * @param options - Transaction builder options
   * @returns Transaction
   * @throws {ValidationError} if parameters are invalid
   */
  async createChunkTxn(
    params: types.CreateChunkParams,
    options: types.TransactionBuilderOptions = {}
  ): Promise<Transaction | VersionedTransaction> {
    this.validateCreateChunkParams(params);

    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    const walletStateData = await this.getWalletStateData(params.smartWallet);
    const walletDevice = this.getWalletDevicePubkey(
      params.smartWallet,
      params.credentialHash
    );

    const policyInstruction = await this.policyResolver.resolveForExecute({
      provided: params.policyInstruction,
      smartWallet: params.smartWallet,
      credentialHash: params.credentialHash,
      passkeyPublicKey: params.passkeySignature.passkeyPublicKey,
      walletStateData,
    });

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const cpiHash = calculateCpiHash(
      params.cpiInstructions,
      params.smartWallet,
      [...(params.cpiSigners ?? []), params.payer]
    );

    const createChunkInstruction = await this.buildCreateChunkIns(
      params.payer,
      params.smartWallet,
      walletDevice,
      {
        ...signatureArgs,
        policyData: policyInstruction.data,
        verifyInstructionIndex: calculateVerifyInstructionIndex(
          options.computeUnitLimit
        ),
        timestamp: params.timestamp,
        cpiHash: Array.from(cpiHash),
      },
      policyInstruction
    );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      createChunkInstruction,
    ]);

    const result = await buildTransaction(
      this.connection,
      params.payer,
      instructions,
      options
    );

    return result.transaction;
  }

  /**
   * Executes a deferred transaction (no authentication needed)
   *
   * @param params - Execute chunk parameters
   * @param options - Transaction builder options
   * @returns Transaction
   * @throws {ValidationError} if parameters are invalid
   */
  async executeChunkTxn(
    params: types.ExecuteChunkParams,
    options: types.TransactionBuilderOptions = {}
  ): Promise<Transaction | VersionedTransaction> {
    this.validateExecuteChunkParams(params);

    const instruction = await this.buildExecuteChunkIns(
      params.payer,
      params.smartWallet,
      params.cpiInstructions,
      params.cpiSigners
    );

    const result = await buildTransaction(
      this.connection,
      params.payer,
      [instruction],
      options
    );

    return result.transaction;
  }

  // ============================================================================
  // Message Building Methods
  // ============================================================================

  /**
   * Builds an authorization message for a smart wallet action
   */
  async buildAuthorizationMessage(params: {
    action: types.SmartWalletActionArgs;
    payer: PublicKey;
    smartWallet: PublicKey;
    passkeyPublicKey: number[];
    credentialHash: number[];
    timestamp: BN;
  }): Promise<Buffer> {
    let message: Buffer;
    const { action, smartWallet, passkeyPublicKey, timestamp } = params;

    switch (action.type) {
      case types.SmartWalletAction.CreateChunk: {
        const {
          policyInstruction: policyIns,
          cpiInstructions,
          cpiSigners,
        } = action.args as types.ArgsByAction[types.SmartWalletAction.CreateChunk];

        const walletStateData = await this.getWalletStateData(
          params.smartWallet
        );

        const policyInstruction = await this.policyResolver.resolveForExecute({
          provided: policyIns,
          smartWallet: params.smartWallet,
          credentialHash: params.credentialHash as types.CredentialHash,
          passkeyPublicKey,
          walletStateData,
        });

        const smartWalletConfig = await this.getWalletStateData(smartWallet);

        message = buildCreateChunkMessage(
          smartWallet,
          smartWalletConfig.lastNonce,
          timestamp,
          policyInstruction,
          cpiInstructions,
          [...(cpiSigners ?? []), params.payer]
        );
        break;
      }
      default:
        throw new ValidationError(
          `Unsupported SmartWalletAction: ${action.type}`,
          'action.type'
        );
    }

    return message;
  }
}
