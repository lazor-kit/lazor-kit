import * as anchor from '@coral-xyz/anchor';
import LazorkitIdl from '../anchor/idl/lazorkit.json';
import { Lazorkit } from '../anchor/types/lazorkit';
import {
  byteArrayEquals,
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
import bs58 from 'bs58';
import { buildExecuteMessage, buildCreateChunkMessage } from '../messages';
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
    if (
      params.policyInstruction !== null &&
      params.policyInstruction !== undefined
    ) {
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
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertValidTransactionInstruction(
      params.cpiInstruction,
      'params.cpiInstruction'
    );
    assertPositiveBN(params.timestamp, 'params.timestamp');

    if (params.policyInstruction !== null) {
      assertValidTransactionInstruction(
        params.policyInstruction,
        'params.policyInstruction'
      );
    }
  }

  /**
   * Validates CreateChunkParams
   */
  private validateCreateChunkParams(params: types.CreateChunkParams): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertValidCredentialHash(params.credentialHash, 'params.credentialHash');
    assertValidTransactionInstructionArray(
      params.cpiInstructions,
      'params.cpiInstructions'
    );
    assertPositiveBN(params.timestamp, 'params.timestamp');

    if (params.policyInstruction !== null) {
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

  /**
   * Validates CloseChunkParams
   */
  private validateCloseChunkParams(params: types.CloseChunkParams): void {
    assertDefined(params, 'params');
    assertValidPublicKey(params.payer, 'params.payer');
    assertValidPublicKey(params.smartWallet, 'params.smartWallet');
    assertPositiveBN(params.nonce, 'params.nonce');
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
   * Finds a smart wallet by passkey public key
   * Searches through all WalletState accounts to find one containing the specified passkey
   *
   * @param passkeyPublicKey - Passkey public key (33 bytes)
   * @returns Smart wallet information or null if not found
   * @throws {ValidationError} if passkeyPublicKey is invalid
   */
  async getSmartWalletByPasskey(
    passkeyPublicKey: types.PasskeyPublicKey | number[]
  ): Promise<{
    smartWallet: PublicKey | null;
    walletState: PublicKey | null;
    deviceSlot: { passkeyPubkey: number[]; credentialHash: number[] } | null;
  }> {
    assertValidPasskeyPublicKey(passkeyPublicKey, 'passkeyPublicKey');
    // Get the discriminator for WalletState accounts
    const discriminator = LazorkitIdl.accounts?.find(
      (a: any) => a.name === 'WalletState'
    )?.discriminator;

    if (!discriminator) {
      throw new ValidationError(
        'WalletState discriminator not found in IDL',
        'passkeyPublicKey'
      );
    }

    // Get all WalletState accounts
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(discriminator) } }],
    });

    // Search through each WalletState account
    for (const account of accounts) {
      try {
        // Deserialize the WalletState account data
        const walletStateData = this.program.coder.accounts.decode(
          'WalletState',
          account.account.data
        );

        // Check if any device contains the target passkey
        for (const device of walletStateData.devices) {
          if (byteArrayEquals(device.passkeyPubkey, passkeyPublicKey)) {
            // Found the matching device, return the smart wallet
            const smartWallet = this.getSmartWalletPubkey(
              walletStateData.walletId
            );
            return {
              smartWallet,
              walletState: account.pubkey,
              deviceSlot: {
                passkeyPubkey: device.passkeyPubkey,
                credentialHash: device.credentialHash,
              },
            };
          }
        }
      } catch (error) {
        // Skip accounts that can't be deserialized (might be corrupted or different type)
        continue;
      }
    }

    // No matching wallet found
    return {
      smartWallet: null,
      walletState: null,
      deviceSlot: null,
    };
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
    credentialHash: types.CredentialHash | number[],
  ) {
    assertValidCredentialHash(credentialHash, 'credentialHash');

    const discriminator = LazorkitIdl.accounts?.find(
      (a: any) => a.name === 'WalletDevice'
    )?.discriminator;

    if (!discriminator) {
      throw new ValidationError(
        'WalletDevice discriminator not found in IDL',
        'credentialHash'
      );
    }

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
        { memcmp: { offset: 8 + 33, bytes: bs58.encode(credentialHash) } },
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
      };
    }

    // Safety net return
    return null;
  }


  // ============================================================================
  // Low-Level Instruction Builders
  // ============================================================================

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

    const { data: walletStateData } = await this.fetchWalletStateContext(
      smartWallet
    );
    const latestNonce = walletStateData.lastNonce.sub(new anchor.BN(1));
    const { chunk, data: chunkData } = await this.fetchChunkContext(
      smartWallet,
      latestNonce
    );

    // Prepare CPI data and split indices
    const instructionDataList = cpiInstructions.map((ix) =>
      Buffer.from(ix.data)
    );
    const splitIndex = calculateSplitIndex(cpiInstructions);
    const allAccountMetas = collectCpiAccountMetas(cpiInstructions, cpiSigners);

    return await this.program.methods
      .executeChunk(instructionDataList, Buffer.from(splitIndex))
      .accountsPartial({
        payer,
        smartWallet,
        walletState: this.getWalletStatePubkey(smartWallet),
        chunk,
        sessionRefund: chunkData.rentRefundAddress,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(allAccountMetas)
      .instruction();
  }

  /**
   * Builds the close chunk instruction
   *
   * @param payer - Payer account public key
   * @param smartWallet - Smart wallet PDA address
   * @param nonce - Nonce of the chunk to close
   * @returns Transaction instruction
   * @throws {ValidationError} if parameters are invalid
   */
  async buildCloseChunkIns(
    payer: PublicKey,
    smartWallet: PublicKey,
    nonce: BN
  ): Promise<TransactionInstruction> {
    assertValidPublicKey(payer, 'payer');
    assertValidPublicKey(smartWallet, 'smartWallet');
    assertPositiveBN(nonce, 'nonce');

    const { chunk, data: chunkData } = await this.fetchChunkContext(
      smartWallet,
      nonce
    );

    return await this.program.methods
      .closeChunk()
      .accountsPartial({
        payer,
        smartWallet,
        walletState: this.getWalletStatePubkey(smartWallet),
        chunk,
        sessionRefund: chunkData.rentRefundAddress,
      })
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

  /**
   * Closes a deferred transaction (no authentication needed)
   *
   * @param params - Close chunk parameters
   * @param options - Transaction builder options
   * @returns Transaction
   * @throws {ValidationError} if parameters are invalid
   */
  async closeChunkTxn(
    params: types.CloseChunkParams,
    options: types.TransactionBuilderOptions = {}
  ): Promise<Transaction | VersionedTransaction> {
    this.validateCloseChunkParams(params);

    const instruction = await this.buildCloseChunkIns(
      params.payer,
      params.smartWallet,
      params.nonce
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
    const { action, smartWallet, passkeyPublicKey, credentialHash, timestamp } = params;

    switch (action.type) {
      case types.SmartWalletAction.Execute: {
        const {
          policyInstruction: policyIns,
          cpiInstruction,
          cpiSigners,
        } = action.args as types.ArgsByAction[types.SmartWalletAction.Execute];

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

        message = buildExecuteMessage(
          smartWallet,
          smartWalletConfig.lastNonce,
          timestamp,
          policyInstruction,
          cpiInstruction,
          [...(cpiSigners ?? []), params.payer]
        );
        break;
      }
      case types.SmartWalletAction.CreateChunk: {
        const { policyInstruction, cpiInstructions, cpiSigners } =
          action.args as types.ArgsByAction[types.SmartWalletAction.CreateChunk];

        const smartWalletConfig = await this.getWalletStateData(smartWallet);
        if (!policyInstruction) {
          const policySigner = this.getWalletDevicePubkey(
            smartWallet,
            credentialHash
          )
          const defaultPolicyInstruction = await this.defaultPolicyProgram.buildCheckPolicyIx({
            walletId: smartWalletConfig.walletId,
            passkeyPublicKey: passkeyPublicKey,
            policySigner,
            smartWallet,
            credentialHash: credentialHash,
            policyData: smartWalletConfig.policyData,
          });
          message = buildCreateChunkMessage(
            smartWallet,
            smartWalletConfig.lastNonce,
            timestamp,
            defaultPolicyInstruction,
            cpiInstructions,
            [...(cpiSigners ?? []), params.payer]
          );
        } else {
          message = buildCreateChunkMessage(
            smartWallet,
            smartWalletConfig.lastNonce,
            timestamp,
            policyInstruction,
            cpiInstructions,
            [...(cpiSigners ?? []), params.payer]
          );
        }
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
