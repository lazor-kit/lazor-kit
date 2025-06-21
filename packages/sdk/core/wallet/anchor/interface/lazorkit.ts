import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import * as constants from '../constants';
import IDL from '../idl/lazorkit.json';
import { Lazorkit } from '../types/lazorkit';
import * as types from '../types';
import { createSecp256r1Instruction, hashSeeds, instructionToAccountMetas } from '../utils';
import { DefaultRuleProgram } from './default_rule';
// Polyfill for structuredClone if not available (for React Native/Expo)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';

export class LazorKitProgram {
  /** Network connection used by all RPC / account queries */
  readonly connection: anchor.web3.Connection;

  /** Cached IDL to avoid repeated JSON parsing */
  readonly Idl: anchor.Idl = IDL as Lazorkit;

  /** Lazily-instantiated (and cached) Anchor `Program` wrapper */
  private _program?: anchor.Program<Lazorkit>;

  /** Frequently-used PDA caches (network-independent, so safe to memoise) */
  private _smartWalletSeq?: anchor.web3.PublicKey;
  private _whitelistRulePrograms?: anchor.web3.PublicKey;
  private _config?: anchor.web3.PublicKey;

  /** Embedded helper for the on-chain default rule program */
  readonly defaultRuleProgram: DefaultRuleProgram;

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
    this.defaultRuleProgram = new DefaultRuleProgram(connection);
  }

  get program(): anchor.Program<Lazorkit> {
    if (!this._program) {
      this._program = new anchor.Program(this.Idl, {
        connection: this.connection,
      });
    }
    return this._program;
  }

  get programId(): anchor.web3.PublicKey {
    return this.program.programId;
  }

  get smartWalletSeq(): anchor.web3.PublicKey {
    if (!this._smartWalletSeq) {
      this._smartWalletSeq = anchor.web3.PublicKey.findProgramAddressSync(
        [constants.SMART_WALLET_SEQ_SEED],
        this.programId
      )[0];
    }
    return this._smartWalletSeq;
  }

  get smartWalletSeqData(): Promise<types.SmartWalletSeq> {
    return this.program.account.smartWalletSeq.fetch(this.smartWalletSeq);
  }

  async getLastestSmartWallet(): Promise<anchor.web3.PublicKey> {
    const seqData = await this.program.account.smartWalletSeq.fetch(this.smartWalletSeq);
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_SEED, seqData.seq.toArrayLike(Buffer, 'le', 8)],
      this.programId
    )[0];
  }

  async getSmartWalletConfigData(
    smartWallet: anchor.web3.PublicKey
  ): Promise<types.SmartWalletConfig> {
    return this.program.account.smartWalletConfig.fetch(this.smartWalletConfig(smartWallet));
  }

  smartWalletAuthenticator(
    passkey: number[],
    smartWallet: anchor.web3.PublicKey
  ): [anchor.web3.PublicKey, number] {
    const hash = hashSeeds(passkey, smartWallet);
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_AUTHENTICATOR_SEED, smartWallet.toBuffer(), hash],
      this.programId
    );
  }

  async getSmartWalletAuthenticatorData(
    smartWalletAuthenticator: anchor.web3.PublicKey
  ): Promise<types.SmartWalletAuthenticator> {
    return this.program.account.smartWalletAuthenticator.fetch(smartWalletAuthenticator);
  }

  smartWalletConfig(smartWallet: anchor.web3.PublicKey): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_CONFIG_SEED, smartWallet.toBuffer()],
      this.programId
    )[0];
  }

  get whitelistRulePrograms(): anchor.web3.PublicKey {
    if (!this._whitelistRulePrograms) {
      this._whitelistRulePrograms = anchor.web3.PublicKey.findProgramAddressSync(
        [constants.WHITELIST_RULE_PROGRAMS_SEED],
        this.programId
      )[0];
    }
    return this._whitelistRulePrograms;
  }

  get config(): anchor.web3.PublicKey {
    if (!this._config) {
      this._config = anchor.web3.PublicKey.findProgramAddressSync(
        [constants.CONFIG_SEED],
        this.programId
      )[0];
    }
    return this._config;
  }

  async initializeTxn(
    payer: anchor.web3.PublicKey,
    defaultRuleProgram: anchor.web3.PublicKey
  ): Promise<anchor.web3.Transaction> {
    const ix = await this.program.methods
      .initialize()
      .accountsPartial({
        signer: payer,
        config: this.config,
        whitelistRulePrograms: this.whitelistRulePrograms,
        smartWalletSeq: this.smartWalletSeq,
        defaultRuleProgram,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: anchor.web3.BPF_LOADER_PROGRAM_ID,
          isWritable: false,
          isSigner: false,
        },
      ])
      .instruction();
    return new anchor.web3.Transaction().add(ix);
  }

  async upsertWhitelistRuleProgramsTxn(
    payer: anchor.web3.PublicKey,
    ruleProgram: anchor.web3.PublicKey
  ): Promise<anchor.web3.Transaction> {
    const ix = await this.program.methods
      .upsertWhitelistRulePrograms(ruleProgram)
      .accountsPartial({
        authority: payer,
        config: this._config ?? this.config,
        whitelistRulePrograms: this.whitelistRulePrograms,
      })
      .instruction();
    return new anchor.web3.Transaction().add(ix);
  }

  async createSmartWalletTxn(
    passkeyPubkey: number[],
    ruleIns: anchor.web3.TransactionInstruction | null,
    payer: anchor.web3.PublicKey,
    credentialId: string = ''
  ): Promise<anchor.web3.Transaction> {
    const configData = await this.program.account.config.fetch(this.config);
    const smartWallet = await this.getLastestSmartWallet();
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(passkeyPubkey, smartWallet);

    // If caller does not provide a rule instruction, default to initRule of DefaultRuleProgram
    const ruleInstruction =
      ruleIns ||
      (await this.defaultRuleProgram.initRuleIns(payer, smartWallet, smartWalletAuthenticator));

    const remainingAccounts = instructionToAccountMetas(ruleInstruction, payer);

    const createSmartWalletIx = await this.program.methods
      .createSmartWallet(passkeyPubkey, Buffer.from(credentialId, 'base64'), ruleInstruction.data)
      .accountsPartial({
        signer: payer,
        smartWalletSeq: this.smartWalletSeq,
        whitelistRulePrograms: this.whitelistRulePrograms,
        smartWallet,
        smartWalletConfig: this.smartWalletConfig(smartWallet),
        smartWalletAuthenticator,
        config: this.config,
        defaultRuleProgram: configData.defaultRuleProgram,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const tx = new anchor.web3.Transaction().add(createSmartWalletIx);
    tx.feePayer = payer;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return tx;
  }

  async executeInstructionTxn(
    passkeyPubkey: number[],
    clientDataJsonRaw: Buffer,
    authenticatorDataRaw: Buffer,
    signature: Buffer,
    payer: anchor.web3.PublicKey,
    smartWallet: anchor.web3.PublicKey,
    ruleIns: anchor.web3.TransactionInstruction | null = null,
    cpiIns: anchor.web3.TransactionInstruction | null = null,
    executeAction: anchor.IdlTypes<Lazorkit>['action'] = types.ExecuteAction.ExecuteCpi,
    createNewAuthenticator: number[] | null = null,
    verifyInstructionIndex: number = 1
  ): Promise<anchor.web3.Transaction> {
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(passkeyPubkey, smartWallet);

    const ruleInstruction =
      ruleIns ||
      (await this.defaultRuleProgram.checkRuleIns(smartWallet, smartWalletAuthenticator));

    const ruleData: types.CpiData = {
      data: ruleInstruction.data,
      startIndex: 0,
      length: ruleInstruction.keys.length,
    };

    let cpiData: types.CpiData | null = null;

    const remainingAccounts: anchor.web3.AccountMeta[] = [];

    if (cpiIns) {
      cpiData = {
        data: cpiIns.data,
        startIndex: 0,
        length: cpiIns.keys.length,
      };

      // The order matters: first CPI accounts, then rule accounts.
      remainingAccounts.push(...instructionToAccountMetas(cpiIns, payer));

      ruleData.startIndex = cpiIns.keys.length;
    }

    // Rule program accounts always follow.
    remainingAccounts.push(...instructionToAccountMetas(ruleInstruction, payer));

    const message = Buffer.concat([
      authenticatorDataRaw,
      Buffer.from(sha256.arrayBuffer(clientDataJsonRaw)),
    ]);
    console.log(message.toString('base64'));
    const verifySignatureIx = createSecp256r1Instruction(
      message, 
      Buffer.from(passkeyPubkey),
      signature
    );

    let newSmartWalletAuthenticator: anchor.web3.PublicKey | null = null;
    if (createNewAuthenticator) {
      [newSmartWalletAuthenticator] = this.smartWalletAuthenticator(
        createNewAuthenticator,
        smartWallet
      );
    }

    const executeInstructionIx = await this.program.methods
      .executeInstruction({
        passkeyPubkey,
        signature,
        clientDataJsonRaw,
        authenticatorDataRaw,
        verifyInstructionIndex,
        ruleData: ruleData,
        cpiData: cpiData,
        action: executeAction,
        createNewAuthenticator,
      })
      .accountsPartial({
        payer,
        config: this.config,
        smartWallet,
        smartWalletConfig: this.smartWalletConfig(smartWallet),
        smartWalletAuthenticator,
        whitelistRulePrograms: this.whitelistRulePrograms,
        authenticatorProgram: ruleInstruction.programId,
        ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        cpiProgram: cpiIns ? cpiIns.programId : anchor.web3.PublicKey.default,
        newSmartWalletAuthenticator: newSmartWalletAuthenticator,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const txn = new anchor.web3.Transaction()
      .add(
        anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
          units: 300_000,
        })
      )
      .add(verifySignatureIx)
      .add(executeInstructionIx);

    txn.feePayer = payer;
    txn.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return txn;
  }

  /**
   * Query the chain for the smart-wallet associated with a passkey.
   */
  async getSmartWalletByPasskey(passkeyPubkey: number[]): Promise<{
    smartWallet: anchor.web3.PublicKey | null;
    smartWalletAuthenticator: anchor.web3.PublicKey | null;
  }> {
    const discriminator = (IDL as any).accounts.find(
      (a: any) => a.name === 'SmartWalletAuthenticator'
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
      return { smartWalletAuthenticator: null, smartWallet: null };
    }

    const smartWalletAuthenticatorData = await this.getSmartWalletAuthenticatorData(
      accounts[0].pubkey
    );

    return {
      smartWalletAuthenticator: accounts[0].pubkey,
      smartWallet: smartWalletAuthenticatorData.smartWallet,
    };
  }

  /**
   * Build the serialized Message struct used for signing requests.
   */
  async getMessage(smartWallet: string): Promise<Buffer> {
    const smartWalletData = await this.getSmartWalletConfigData(
      new anchor.web3.PublicKey(smartWallet)
    );

    // Manually serialize the message struct with nonce (u64) and timestamp (i64)
    const buffer = Buffer.alloc(16); // 8 bytes for nonce + 8 bytes for timestamp

    // Write nonce as little-endian u64
    buffer.writeBigUInt64LE(BigInt(smartWalletData.lastNonce.toString()), 0);

    // Write timestamp as little-endian i64
    buffer.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 8);

    return buffer;
  }

   /**
   * Query the chain for the smart-wallet associated with a credential_id.
   */
  async getSmartWalletByCredentialId(credentialId: string): Promise<{
    smartWallet: anchor.web3.PublicKey | null;
    smartWalletAuthenticator: anchor.web3.PublicKey | null;
  }> {
    const discriminator = (IDL as any).accounts.find(
      (a: any) => a.name === 'SmartWalletAuthenticator'
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
      return { smartWalletAuthenticator: null, smartWallet: null };
    }

    const smartWalletAuthenticatorData =
      await this.getSmartWalletAuthenticatorData(accounts[0].pubkey);

    return {
      smartWalletAuthenticator: accounts[0].pubkey,
      smartWallet: smartWalletAuthenticatorData.smartWallet,
    };
  }
  
}
