import * as anchor from "@coral-xyz/anchor";
import { TransferLimit } from "../target/types/transfer_limit";
import * as types from "./types";
import * as constants from "./constants";

export class TransferLimitProgram {
  private connection: anchor.web3.Connection;
  private Idl: anchor.Idl = require("../target/idl/transfer_limit.json");

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
  }

  get program(): anchor.Program<TransferLimit> {
    return new anchor.Program(this.Idl, {
      connection: this.connection,
    });
  }

  get programId(): anchor.web3.PublicKey {
    return this.program.programId;
  }

  rule(smartWallet: anchor.web3.PublicKey): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.RULE_SEED, smartWallet.toBuffer()],
      this.programId
    )[0];
  }

  get config(): anchor.web3.PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.CONFIG_SEED],
      this.programId
    )[0];
  }

  member(
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        constants.MEMBER_SEED,
        smartWallet.toBuffer(),
        smartWalletAuthenticator.toBuffer(),
      ],
      this.programId
    )[0];
  }

  ruleData(
    smartWallet: anchor.web3.PublicKey,
    tokenMint: anchor.web3.PublicKey = anchor.web3.PublicKey.default
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.RULE_DATA_SEED, smartWallet.toBuffer(), tokenMint.toBuffer()],
      this.programId
    )[0];
  }

  async initializeTxn(
    payer: anchor.web3.PublicKey,
    authority: anchor.web3.PublicKey
  ) {
    return new anchor.web3.Transaction().add(
      await this.program.methods
        .initialize(authority)
        .accounts({
          signer: payer,
        })
        .instruction()
    );
  }

  async initRuleIns(
    payer: anchor.web3.PublicKey,
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey,
    smartWalletConfig: anchor.web3.PublicKey,
    args: types.InitRuleArgs
  ) {
    return await this.program.methods
      .initRule(args)
      .accountsPartial({
        payer,
        smartWallet,
        smartWalletAuthenticator,
        member: this.member(smartWallet, smartWalletAuthenticator),
        ruleData: this.ruleData(smartWallet, args.token),
        smartWalletConfig,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
  }

  async addMemeberIns(
    payer: anchor.web3.PublicKey,
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey,
    newSmartWalletAuthenticator: anchor.web3.PublicKey,
    lazorkit: anchor.web3.PublicKey,
    new_passkey_pubkey: number[],
    bump: number
  ) {
    return await this.program.methods
      .addMember(new_passkey_pubkey, bump)
      .accountsPartial({
        payer,
        smartWalletAuthenticator,
        newSmartWalletAuthenticator,
        admin: this.member(smartWallet, smartWalletAuthenticator),
        member: this.member(smartWallet, newSmartWalletAuthenticator),
        lazorkit,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
  }

  async checkRuleIns(
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey,
    cpiIns: anchor.web3.TransactionInstruction,
    tokenMint: anchor.web3.PublicKey = anchor.web3.PublicKey.default
  ) {
    return await this.program.methods
      .checkRule(tokenMint, cpiIns.data, cpiIns.programId)
      .accountsPartial({
        smartWalletAuthenticator,
        ruleData: this.ruleData(smartWallet, tokenMint),
        member: this.member(smartWallet, smartWalletAuthenticator),
      })
      .instruction();
  }
}
