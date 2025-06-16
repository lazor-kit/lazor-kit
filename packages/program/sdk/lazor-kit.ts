import * as anchor from '@coral-xyz/anchor';
import IDL from '../target/idl/lazorkit.json';
import { Lazorkit } from '../target/types/lazorkit';
import * as constants from './constants';
import { createSecp256r1Instruction, hashSeeds } from './utils';
import * as types from './types';
import { sha256 } from 'js-sha256';

export class LazorKitProgram {
  readonly connection: anchor.web3.Connection;
  readonly Idl: anchor.Idl = IDL as Lazorkit;

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
  }

  get program(): anchor.Program<Lazorkit> {
    return new anchor.Program(this.Idl, { connection: this.connection });
  }

  get programId(): anchor.web3.PublicKey {
    return this.program.programId;
  }

  get smartWalletSeq(): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_SEQ_SEED],
      this.programId
    )[0];
  }

  get smartWalletSeqData(): Promise<types.SmartWalletSeq> {
    return this.program.account.smartWalletSeq.fetch(this.smartWalletSeq);
  }

  async getLastestSmartWallet(): Promise<anchor.web3.PublicKey> {
    const seqData = await this.program.account.smartWalletSeq.fetch(
      this.smartWalletSeq
    );
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_SEED, seqData.seq.toArrayLike(Buffer, 'le', 8)],
      this.programId
    )[0];
  }

  async getSmartWalletConfigData(
    smartWallet: anchor.web3.PublicKey
  ): Promise<types.SmartWalletConfig> {
    return this.program.account.smartWalletConfig.fetch(
      this.smartWalletConfig(smartWallet)
    );
  }

  smartWalletAuthenticator(
    passkey: number[],
    smartWallet: anchor.web3.PublicKey
  ): [anchor.web3.PublicKey, number] {
    const hash = hashSeeds(passkey, smartWallet);
    return anchor.web3.PublicKey.findProgramAddressSync([hash], this.programId);
  }

  async getSmartWalletAuthenticatorData(
    smartWalletAuthenticator: anchor.web3.PublicKey
  ): Promise<types.SmartWalletAuthenticator> {
    return this.program.account.smartWalletAuthenticator.fetch(
      smartWalletAuthenticator
    );
  }

  smartWalletConfig(smartWallet: anchor.web3.PublicKey): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_CONFIG_SEED, smartWallet.toBuffer()],
      this.programId
    )[0];
  }

  get whitelistRulePrograms(): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.WHITELIST_RULE_PROGRAMS_SEED],
      this.programId
    )[0];
  }

  get config(): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.CONFIG_SEED],
      this.programId
    )[0];
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
        signer: payer,
        whitelistRulePrograms: this.whitelistRulePrograms,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    return new anchor.web3.Transaction().add(ix);
  }

  async createSmartWalletTxn(
    passkeyPubkey: number[],
    ruleIns: anchor.web3.TransactionInstruction,
    payer: anchor.web3.PublicKey
  ): Promise<anchor.web3.Transaction> {
    const configData = await this.program.account.config.fetch(this.config);
    const smartWallet = await this.getLastestSmartWallet();
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(
      passkeyPubkey,
      smartWallet
    );

    const remainingAccounts = ruleIns.keys.map((account) => ({
      pubkey: account.pubkey,
      isSigner: account.pubkey.equals(payer),
      isWritable: account.isWritable,
    }));

    const createSmartWalletIx = await this.program.methods
      .createSmartWallet(passkeyPubkey, ruleIns.data)
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
    ruleIns: anchor.web3.TransactionInstruction,
    cpiIns: anchor.web3.TransactionInstruction = null,
    payer: anchor.web3.PublicKey,
    smartWallet: anchor.web3.PublicKey,
    executeAction: anchor.IdlTypes<Lazorkit>['action'] = types.ExecuteAction
      .ExecuteCpi,
    createNewAuthenticator: number[] = null,
    verifyInstructionIndex: number = 0
  ): Promise<anchor.web3.Transaction> {
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(
      passkeyPubkey,
      smartWallet
    );

    const ruleData: types.CpiData = {
      data: ruleIns.data,
      startIndex: 0,
      length: ruleIns.keys.length,
    };

    let cpiData: types.CpiData | null = null;

    const remainingAccounts: anchor.web3.AccountMeta[] = [];

    if (cpiIns) {
      cpiData = {
        data: cpiIns.data,
        startIndex: 0,
        length: cpiIns.keys.length,
      };

      remainingAccounts.push(
        ...cpiIns.keys.map((key) => ({
          pubkey: key.pubkey,
          isWritable: key.isWritable,
          isSigner: key.pubkey.equals(payer),
        }))
      );

      ruleData.startIndex = cpiIns.keys.length;
    }

    remainingAccounts.push(
      ...ruleIns.keys.map((key) => ({
        pubkey: key.pubkey,
        isWritable: key.isWritable,
        isSigner: key.pubkey.equals(payer),
      }))
    );

    const message = Buffer.concat([
      authenticatorDataRaw,
      Buffer.from(sha256.arrayBuffer(clientDataJsonRaw)),
    ]);

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
        authenticatorProgram: ruleIns.programId,
        ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        cpiProgram: cpiIns ? cpiIns.programId : anchor.web3.PublicKey.default,
        newSmartWalletAuthenticator: newSmartWalletAuthenticator,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    return new anchor.web3.Transaction()
      .add(verifySignatureIx)
      .add(executeInstructionIx);
  }
}
