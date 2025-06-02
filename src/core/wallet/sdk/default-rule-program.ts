import * as anchor from "@coral-xyz/anchor";
import { type DefaultRule } from "../types/default_rule";
import * as constants from "./constants";
import idl from "../idl/default_rule.json";


export class DefaultRuleProgram {
  private connection: anchor.web3.Connection;
  private Idl: anchor.Idl = idl as anchor.Idl;

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
  }

  get program(): anchor.Program<DefaultRule> {
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

  async initRuleIns(
    payer: anchor.web3.PublicKey,
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey
  ) {
    return await this.program.methods
      .initRule()
      .accountsPartial({
        payer,
        smartWallet,
        smartWalletAuthenticator,
        rule: this.rule(smartWallet),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
  }

  async checkRuleIns(
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey
  ) {
    return await this.program.methods
      .checkRule()
      .accountsPartial({
        rule: this.rule(smartWallet),
        smartWalletAuthenticator,
      })
      .instruction();
  }

  async destroyIns(
    smartWallet: anchor.web3.PublicKey,
    smartWalletAuthenticator: anchor.web3.PublicKey
  ) {
    return await this.program.methods
      .destroy()
      .accountsPartial({
        rule: this.rule(smartWallet),
        smartWalletAuthenticator,
        smartWallet,
      })
      .instruction();
  }
}

