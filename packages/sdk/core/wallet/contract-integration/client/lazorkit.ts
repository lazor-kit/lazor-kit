import { Program, BN } from '@coral-xyz/anchor';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  VersionedTransaction,
  AccountMeta,
} from '@solana/web3.js';
import LazorkitIdl from '../anchor/idl/lazorkit.json';
import { Lazorkit } from '../anchor/types/lazorkit';
import {
  deriveConfigPda,
  derivePolicyProgramRegistryPda,
  deriveSmartWalletPda,
  deriveSmartWalletDataPda,
  deriveWalletDevicePda,
  deriveTransactionSessionPda,
} from '../pda/lazorkit';
import { getRandomBytes, instructionToAccountMetas } from '../utils';
import * as types from '../types';
import { DefaultPolicyClient } from './defaultPolicy';
import bs58 from 'bs58';
import {
  buildInvokePolicyMessage,
  buildUpdatePolicyMessage,
  buildExecuteMessage,
} from '../messages';
import { Buffer } from 'buffer';
import {
  buildPasskeyVerificationInstruction,
  convertPasskeySignatureToInstructionArgs,
} from '../auth';
import {
  buildVersionedTransaction,
  buildLegacyTransaction,
  combineInstructionsWithAuth,
} from '../transaction';

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
  readonly connection: Connection;
  readonly program: Program<Lazorkit>;
  readonly programId: PublicKey;
  readonly defaultPolicyProgram: DefaultPolicyClient;

  constructor(connection: Connection) {
    this.connection = connection;
    this.program = new Program<Lazorkit>(LazorkitIdl as Lazorkit, {
      connection: connection,
    });
    this.defaultPolicyProgram = new DefaultPolicyClient(connection);
    this.programId = this.program.programId;
  }

  // ============================================================================
  // PDA Derivation Methods
  // ============================================================================

  /**
   * Derives the program configuration PDA
   */
  configPda(): PublicKey {
    return deriveConfigPda(this.programId);
  }

  /**
   * Derives the policy program registry PDA
   */
  policyProgramRegistryPda(): PublicKey {
    return derivePolicyProgramRegistryPda(this.programId);
  }

  /**
   * Derives a smart wallet PDA from wallet ID
   */
  smartWalletPda(walletId: BN): PublicKey {
    return deriveSmartWalletPda(this.programId, walletId);
  }

  /**
   * Derives the smart wallet data PDA for a given smart wallet
   */
  smartWalletDataPda(smartWallet: PublicKey): PublicKey {
    return deriveSmartWalletDataPda(this.programId, smartWallet);
  }

  /**
   * Derives a wallet device PDA for a given smart wallet and passkey
   */
  walletDevicePda(smartWallet: PublicKey, passkey: number[]): PublicKey {
    return deriveWalletDevicePda(this.programId, smartWallet, passkey)[0];
  }

  /**
   * Derives a transaction session PDA for a given smart wallet and nonce
   */
  transactionSessionPda(smartWallet: PublicKey, lastNonce: BN): PublicKey {
    return deriveTransactionSessionPda(this.programId, smartWallet, lastNonce);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generates a random wallet ID
   */
  generateWalletId(): BN {
    return new BN(getRandomBytes(8), 'le');
  }

  // ============================================================================
  // Account Data Fetching Methods
  // ============================================================================

  /**
   * Fetches program configuration data
   */
  async getConfigData() {
    return await this.program.account.config.fetch(this.configPda());
  }

  /**
   * Fetches smart wallet data for a given smart wallet
   */
  async getSmartWalletData(smartWallet: PublicKey) {
    const pda = this.smartWalletDataPda(smartWallet);
    return await this.program.account.smartWallet.fetch(pda);
  }

  /**
   * Fetches wallet device data for a given device
   */
  async getWalletDeviceData(walletDevice: PublicKey) {
    return await this.program.account.walletDevice.fetch(walletDevice);
  }

  /**
   * Finds a smart wallet by passkey public key
   */
  async getSmartWalletByPasskey(passkeyPubkey: number[]): Promise<{
    smartWallet: PublicKey | null;
    walletDevice: PublicKey | null;
  }> {
    const discriminator = LazorkitIdl.accounts.find(
      (a: any) => a.name === 'WalletDevice'
    )!.discriminator;

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      dataSlice: {
        offset: 8,
        length: 33,
      },
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
        { memcmp: { offset: 8, bytes: bs58.encode(passkeyPubkey) } },
      ],
    });

    if (accounts.length === 0) {
      return { walletDevice: null, smartWallet: null };
    }

    const walletDeviceData = await this.getWalletDeviceData(accounts[0].pubkey);

    return {
      walletDevice: accounts[0].pubkey,
      smartWallet: walletDeviceData.smartWallet,
    };
  }

  // ============================================================================
  // Low-Level Instruction Builders
  // ============================================================================

  /**
   * Builds the initialize program instruction
   */
  async buildInitializeInstruction(
    payer: PublicKey
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .initialize()
      .accountsPartial({
        signer: payer,
        config: this.configPda(),
        policyProgramRegistry: this.policyProgramRegistryPda(),
        defaultPolicyProgram: this.defaultPolicyProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Builds the create smart wallet instruction
   */
  async buildCreateSmartWalletInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    walletDevice: PublicKey,
    policyInstruction: TransactionInstruction,
    args: types.CreateSmartWalletArgs
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .createSmartWallet(args)
      .accountsPartial({
        payer,
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        policyProgramRegistry: this.policyProgramRegistryPda(),
        walletDevice,
        config: this.configPda(),
        defaultPolicyProgram: this.defaultPolicyProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        ...instructionToAccountMetas(policyInstruction, payer),
      ])
      .instruction();
  }

  /**
   * Builds the execute transaction instruction
   */
  async buildExecuteTransactionInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    args: types.ExecuteTransactionArgs,
    policyInstruction: TransactionInstruction,
    cpiInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .executeTransaction(args)
      .accountsPartial({
        payer,
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        walletDevice: this.walletDevicePda(smartWallet, args.passkeyPubkey),
        policyProgramRegistry: this.policyProgramRegistryPda(),
        policyProgram: policyInstruction.programId,
        cpiProgram: cpiInstruction.programId,
        config: this.configPda(),
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .remainingAccounts([
        ...instructionToAccountMetas(policyInstruction, payer),
        ...instructionToAccountMetas(cpiInstruction, payer),
      ])
      .instruction();
  }

  /**
   * Builds the invoke policy instruction
   */
  async buildInvokePolicyInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    args: types.InvokePolicyArgs,
    policyInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    const remaining: AccountMeta[] = [];

    if (args.newWalletDevice) {
      const newWalletDevice = this.walletDevicePda(
        smartWallet,
        args.newWalletDevice.passkeyPubkey
      );
      remaining.push({
        pubkey: newWalletDevice,
        isWritable: true,
        isSigner: false,
      });
    }

    remaining.push(...instructionToAccountMetas(policyInstruction, payer));

    return await this.program.methods
      .invokePolicy(args)
      .accountsPartial({
        payer,
        config: this.configPda(),
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        walletDevice: this.walletDevicePda(smartWallet, args.passkeyPubkey),
        policyProgram: policyInstruction.programId,
        policyProgramRegistry: this.policyProgramRegistryPda(),
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .instruction();
  }

  /**
   * Builds the update policy instruction
   */
  async buildUpdatePolicyInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    args: types.UpdatePolicyArgs,
    destroyPolicyInstruction: TransactionInstruction,
    initPolicyInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    const remaining: AccountMeta[] = [];

    if (args.newWalletDevice) {
      const newWalletDevice = this.walletDevicePda(
        smartWallet,
        args.newWalletDevice.passkeyPubkey
      );
      remaining.push({
        pubkey: newWalletDevice,
        isWritable: true,
        isSigner: false,
      });
    }

    remaining.push(
      ...instructionToAccountMetas(destroyPolicyInstruction, payer)
    );
    remaining.push(...instructionToAccountMetas(initPolicyInstruction, payer));

    return await this.program.methods
      .updatePolicy(args)
      .accountsPartial({
        payer,
        config: this.configPda(),
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        walletDevice: this.walletDevicePda(smartWallet, args.passkeyPubkey),
        oldPolicyProgram: destroyPolicyInstruction.programId,
        newPolicyProgram: initPolicyInstruction.programId,
        policyProgramRegistry: this.policyProgramRegistryPda(),
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .instruction();
  }

  /**
   * Builds the create transaction session instruction
   */
  async buildCreateTransactionSessionInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    args: types.CreateSessionArgs,
    policyInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .createTransactionSession(args)
      .accountsPartial({
        payer,
        config: this.configPda(),
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        walletDevice: this.walletDevicePda(smartWallet, args.passkeyPubkey),
        policyProgramRegistry: this.policyProgramRegistryPda(),
        policyProgram: policyInstruction.programId,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        ...instructionToAccountMetas(policyInstruction, payer),
      ])
      .instruction();
  }

  /**
   * Builds the execute session transaction instruction
   */
  async buildExecuteSessionTransactionInstruction(
    payer: PublicKey,
    smartWallet: PublicKey,
    cpiInstruction: TransactionInstruction
  ): Promise<TransactionInstruction> {
    const cfg = await this.getSmartWalletData(smartWallet);
    const transactionSession = this.transactionSessionPda(
      smartWallet,
      cfg.lastNonce
    );

    return await this.program.methods
      .executeSessionTransaction(cpiInstruction.data)
      .accountsPartial({
        payer,
        config: this.configPda(),
        smartWallet,
        smartWalletData: this.smartWalletDataPda(smartWallet),
        cpiProgram: cpiInstruction.programId,
        transactionSession,
        sessionRefund: payer,
      })
      .remainingAccounts([...instructionToAccountMetas(cpiInstruction, payer)])
      .instruction();
  }

  // ============================================================================
  // High-Level Transaction Builders (with Authentication)
  // ============================================================================

  /**
   * Creates a smart wallet with passkey authentication
   */
  async createSmartWalletTransaction(
    params: types.CreateSmartWalletParams
  ): Promise<{
    transaction: Transaction;
    smartWalletId: BN;
    smartWallet: PublicKey;
  }> {
    const smartWalletId = params.smartWalletId || this.generateWalletId();
    const smartWallet = this.smartWalletPda(smartWalletId);
    const walletDevice = this.walletDevicePda(
      smartWallet,
      params.passkeyPubkey
    );

    let policyInstruction = await this.defaultPolicyProgram.buildInitPolicyIx(
      params.payer,
      smartWallet,
      walletDevice
    );

    if (params.policyInstruction) {
      policyInstruction = params.policyInstruction;
    }

    const args = {
      passkeyPubkey: params.passkeyPubkey,
      credentialId: Buffer.from(params.credentialIdBase64, 'base64'),
      policyData: policyInstruction.data,
      walletId: smartWalletId,
      isPayForUser: params.isPayForUser === true,
    };

    const instruction = await this.buildCreateSmartWalletInstruction(
      params.payer,
      smartWallet,
      walletDevice,
      policyInstruction,
      args
    );

    const transaction = await buildLegacyTransaction(
      this.connection,
      params.payer,
      [instruction]
    );

    return {
      transaction,
      smartWalletId,
      smartWallet,
    };
  }

  /**
   * Executes a transaction with passkey authentication
   */
  async executeTransactionWithAuth(
    params: types.ExecuteTransactionParams
  ): Promise<VersionedTransaction> {
    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    let policyInstruction = await this.defaultPolicyProgram.buildCheckPolicyIx(
      this.walletDevicePda(
        params.smartWallet,
        params.passkeySignature.passkeyPubkey
      ),
      params.smartWallet
    );

    if (params.policyInstruction) {
      policyInstruction = params.policyInstruction;
    }

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const execInstruction = await this.buildExecuteTransactionInstruction(
      params.payer,
      params.smartWallet,
      {
        ...signatureArgs,
        verifyInstructionIndex: 0,
        policyData: policyInstruction.data,
        cpiData: params.cpiInstruction.data,
        splitIndex: policyInstruction.keys.length,
      },
      policyInstruction,
      params.cpiInstruction
    );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      execInstruction,
    ]);
    return buildVersionedTransaction(
      this.connection,
      params.payer,
      instructions
    );
  }

  /**
   * Invokes a policy with passkey authentication
   */
  async invokePolicyWithAuth(
    params: types.InvokePolicyParams
  ): Promise<VersionedTransaction> {
    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const invokeInstruction = await this.buildInvokePolicyInstruction(
      params.payer,
      params.smartWallet,
      {
        ...signatureArgs,
        newWalletDevice: params.newWalletDevice
          ? {
              passkeyPubkey: Array.from(params.newWalletDevice.passkeyPubkey),
              credentialId: Buffer.from(
                params.newWalletDevice.credentialIdBase64,
                'base64'
              ),
            }
          : null,
        policyData: params.policyInstruction.data,
        verifyInstructionIndex: 0,
      },
      params.policyInstruction
    );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      invokeInstruction,
    ]);
    return buildVersionedTransaction(
      this.connection,
      params.payer,
      instructions
    );
  }

  /**
   * Updates a policy with passkey authentication
   */
  async updatePolicyWithAuth(
    params: types.UpdatePolicyParams
  ): Promise<VersionedTransaction> {
    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const updateInstruction = await this.buildUpdatePolicyInstruction(
      params.payer,
      params.smartWallet,
      {
        ...signatureArgs,
        verifyInstructionIndex: 0,
        destroyPolicyData: params.destroyPolicyInstruction.data,
        initPolicyData: params.initPolicyInstruction.data,
        splitIndex:
          (params.newWalletDevice ? 1 : 0) +
          params.destroyPolicyInstruction.keys.length,
        newWalletDevice: params.newWalletDevice
          ? {
              passkeyPubkey: Array.from(params.newWalletDevice.passkeyPubkey),
              credentialId: Buffer.from(
                params.newWalletDevice.credentialIdBase64,
                'base64'
              ),
            }
          : null,
      },
      params.destroyPolicyInstruction,
      params.initPolicyInstruction
    );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      updateInstruction,
    ]);
    return buildVersionedTransaction(
      this.connection,
      params.payer,
      instructions
    );
  }

  /**
   * Creates a transaction session with passkey authentication
   */
  async createTransactionSessionWithAuth(
    params: types.CreateTransactionSessionParams
  ): Promise<VersionedTransaction> {
    const authInstruction = buildPasskeyVerificationInstruction(
      params.passkeySignature
    );

    let policyInstruction = await this.defaultPolicyProgram.buildCheckPolicyIx(
      this.walletDevicePda(
        params.smartWallet,
        params.passkeySignature.passkeyPubkey
      ),
      params.smartWallet
    );

    if (params.policyInstruction) {
      policyInstruction = params.policyInstruction;
    }

    const signatureArgs = convertPasskeySignatureToInstructionArgs(
      params.passkeySignature
    );

    const sessionInstruction =
      await this.buildCreateTransactionSessionInstruction(
        params.payer,
        params.smartWallet,
        {
          ...signatureArgs,
          expiresAt: new BN(params.expiresAt),
          policyData: policyInstruction.data,
          verifyInstructionIndex: 0,
        },
        policyInstruction
      );

    const instructions = combineInstructionsWithAuth(authInstruction, [
      sessionInstruction,
    ]);
    return buildVersionedTransaction(
      this.connection,
      params.payer,
      instructions
    );
  }

  /**
   * Executes a session transaction (no authentication needed)
   */
  async executeSessionTransaction(
    params: types.ExecuteSessionTransactionParams
  ): Promise<VersionedTransaction> {
    const instruction = await this.buildExecuteSessionTransactionInstruction(
      params.payer,
      params.smartWallet,
      params.cpiInstruction
    );

    return buildVersionedTransaction(this.connection, params.payer, [
      instruction,
    ]);
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
    passkeyPubkey: number[];
  }): Promise<Buffer> {
    let message: Buffer;
    const { action, payer, smartWallet, passkeyPubkey } = params;

    switch (action.type) {
      case types.SmartWalletAction.ExecuteTransaction: {
        const { policyInstruction: policyIns, cpiInstruction } =
          action.args as types.ArgsByAction[types.SmartWalletAction.ExecuteTransaction];

        let policyInstruction =
          await this.defaultPolicyProgram.buildCheckPolicyIx(
            this.walletDevicePda(smartWallet, passkeyPubkey),
            params.smartWallet
          );

        if (policyIns) {
          policyInstruction = policyIns;
        }

        const smartWalletData = await this.getSmartWalletData(smartWallet);

        message = buildExecuteMessage(
          payer,
          smartWalletData.lastNonce,
          new BN(Math.floor(Date.now() / 1000)),
          policyInstruction,
          cpiInstruction
        );
        break;
      }
      case types.SmartWalletAction.InvokePolicy: {
        const { policyInstruction } =
          action.args as types.ArgsByAction[types.SmartWalletAction.InvokePolicy];

        const smartWalletData = await this.getSmartWalletData(smartWallet);

        message = buildInvokePolicyMessage(
          payer,
          smartWalletData.lastNonce,
          new BN(Math.floor(Date.now() / 1000)),
          policyInstruction
        );
        break;
      }
      case types.SmartWalletAction.UpdatePolicy: {
        const { initPolicyIns, destroyPolicyIns } =
          action.args as types.ArgsByAction[types.SmartWalletAction.UpdatePolicy];

        const smartWalletData = await this.getSmartWalletData(smartWallet);

        message = buildUpdatePolicyMessage(
          payer,
          smartWalletData.lastNonce,
          new BN(Math.floor(Date.now() / 1000)),
          destroyPolicyIns,
          initPolicyIns
        );
        break;
      }

      default:
        throw new Error(`Unsupported SmartWalletAction: ${action.type}`);
    }

    return message;
  }

  // ============================================================================
  // Legacy Compatibility Methods (Deprecated)
  // ============================================================================

  /**
   * @deprecated Use createSmartWalletTransaction instead
   */
  async createSmartWalletTx(params: {
    payer: PublicKey;
    passkeyPubkey: number[];
    credentialIdBase64: string;
    policyInstruction?: TransactionInstruction | null;
    isPayForUser?: boolean;
    smartWalletId?: BN;
  }) {
    return this.createSmartWalletTransaction({
      payer: params.payer,
      passkeyPubkey: params.passkeyPubkey,
      credentialIdBase64: params.credentialIdBase64,
      policyInstruction: params.policyInstruction,
      isPayForUser: params.isPayForUser,
      smartWalletId: params.smartWalletId,
    });
  }

  /**
   * @deprecated Use buildAuthorizationMessage instead
   */
  async buildMessage(params: {
    action: types.SmartWalletActionArgs;
    payer: PublicKey;
    smartWallet: PublicKey;
    passkeyPubkey: number[];
  }): Promise<Buffer> {
    return this.buildAuthorizationMessage(params);
  }

  async getSmartWalletByCredentialId(credentialId: string): Promise<{
    smartWallet: PublicKey | null;
  }> {
    const discriminator = LazorkitIdl.accounts.find(
      (a: any) => a.name === 'WalletDevice'
    )!.discriminator;

    // Convert credential_id to base64 buffer
    const credentialIdBuffer = Buffer.from(credentialId, 'base64');

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      dataSlice: {
        offset: 8 + 33 + 32 + 4,
        length: credentialIdBuffer.length,
      },
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
        {
          memcmp: {
            offset: 8 + 33 + 32 + 4,
            bytes: bs58.encode(credentialIdBuffer),
          },
        },
      ],
    });

    if (accounts.length === 0) {
      return { smartWallet: null };
    }

    const smartWalletAuthenticatorData =
      await this.getWalletDeviceData(accounts[0].pubkey);

    return {
      smartWallet: smartWalletAuthenticatorData.smartWallet,
    };
  }

}
