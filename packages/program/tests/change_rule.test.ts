import * as anchor from "@coral-xyz/anchor";
import ECDSA from "ecdsa-secp256r1";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { LazorKitProgram } from "../sdk/lazor-kit";
import { DefaultRuleProgram } from "../sdk/default-rule-program";

import { ExecuteAction } from "../sdk/types";
import { TransferLimitProgram } from "../sdk/transfer_limit";
dotenv.config();

describe("Test smart wallet with transfer limit", () => {
  const connection = new anchor.web3.Connection(
    process.env.RPC_URL || "http://localhost:8899",
    "confirmed"
  );

  const lazorkitProgram = new LazorKitProgram(connection);

  const defaultRuleProgram = new DefaultRuleProgram(connection);

  const transferLimitProgram = new TransferLimitProgram(connection);

  const payer = anchor.web3.Keypair.fromSecretKey(
    bs58.decode(process.env.PRIVATE_KEY!)
  );

  before(async () => {
    const smartWalletSeqAccountInfo = await connection.getAccountInfo(
      lazorkitProgram.smartWalletSeq
    );

    if (smartWalletSeqAccountInfo === null) {
      const txn = await lazorkitProgram.initializeTxn(
        payer.publicKey,
        defaultRuleProgram.programId
      );

      await sendAndConfirmTransaction(connection, txn, [payer], {
        commitment: "confirmed",
      });
    }

    const defaultRuleConfigAccountInfo = await connection.getAccountInfo(
      defaultRuleProgram.config
    );

    if (defaultRuleConfigAccountInfo === null) {
      // create the default rule program
      const txn = await defaultRuleProgram.initializeTxn(
        payer.publicKey,
        lazorkitProgram.authority
      );

      await sendAndConfirmTransaction(connection, txn, [payer], {
        commitment: "confirmed",
      });
    }

    const transferLimitConfigAccountInfo = await connection.getAccountInfo(
      transferLimitProgram.config
    );

    if (transferLimitConfigAccountInfo === null) {
      // create the transfer limit program
      const txn = await transferLimitProgram.initializeTxn(
        payer.publicKey,
        lazorkitProgram.authority
      );

      await sendAndConfirmTransaction(connection, txn, [payer], {
        commitment: "confirmed",
      });
    }

    const whitelistRuleProgramData =
      await lazorkitProgram.program.account.whitelistRulePrograms.fetch(
        lazorkitProgram.whitelistRulePrograms
      );

    const listPrograms = whitelistRuleProgramData.list.map((programId) =>
      programId.toBase58()
    );

    // check if already have transfer limit program
    if (!listPrograms.includes(transferLimitProgram.programId.toBase58())) {
      const txn = await lazorkitProgram.upsertWhitelistRuleProgramsTxn(
        payer.publicKey,
        transferLimitProgram.programId
      );

      await sendAndConfirmTransaction(connection, txn, [payer], {
        commitment: "confirmed",
      });
    }
  });

  xit("Change default to transfer limit", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL / 100,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(100),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Execute instruction: ", sig2);
  });

  xit("Change default to transfer limit and add member", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL / 100,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(100),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Change rule instruction: ", sig2);

    const newPasskeyPubkey = Array.from(
      Buffer.from(ECDSA.generateKey().toCompressedPublicKey(), "base64")
    );
    const [newSmartWalletAuthenticator, bump] =
      lazorkitProgram.smartWalletAuthenticator(newPasskeyPubkey, smartWallet);

    const addMemberIns = await transferLimitProgram.addMemeberIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      newSmartWalletAuthenticator,
      lazorkitProgram.programId,
      newPasskeyPubkey,
      bump
    );

    const newMessage = Buffer.from("add member");
    const newSignatureBytes = Buffer.from(
      privateKey.sign(newMessage),
      "base64"
    );

    const addMemberTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      newMessage,
      newSignatureBytes,
      addMemberIns,
      null,
      payer.publicKey,
      smartWallet,
      ExecuteAction.CallRuleProgram,
      newPasskeyPubkey
    );

    const addMemberSig = await sendAndConfirmTransaction(
      connection,
      addMemberTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Add member: ", addMemberSig);
  });

  xit("Change default to transfer limit and admin execute", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(LAMPORTS_PER_SOL),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Change rule instruction: ", sig2);

    const transferSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: smartWallet,
      toPubkey: payer.publicKey,
      lamports: LAMPORTS_PER_SOL / 100,
    });

    const checkRuleIns = await transferLimitProgram.checkRuleIns(
      smartWallet,
      smartWalletAuthenticator,
      transferSolIns
    );

    const executeTxn2 = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      checkRuleIns,
      transferSolIns,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ExecuteCpi
    );

    const sig3 = await sendAndConfirmTransaction(
      connection,
      executeTxn2,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Execute transfer: ", sig3);
  });

  xit("Change default to transfer limit and add member and member execute exceeded", async () => {
    const privateKey = ECDSA.generateKey();

    const pubkey = Array.from(
      Buffer.from(privateKey.toCompressedPublicKey(), "base64")
    );

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(LAMPORTS_PER_SOL / 100 - 1),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Change rule instruction: ", sig2);

    const newPasskey = ECDSA.generateKey();

    const newPasskeyPubkey = Array.from(
      Buffer.from(newPasskey.toCompressedPublicKey(), "base64")
    );

    const [newSmartWalletAuthenticator, bump] =
      lazorkitProgram.smartWalletAuthenticator(newPasskeyPubkey, smartWallet);

    const addMemberIns = await transferLimitProgram.addMemeberIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      newSmartWalletAuthenticator,
      lazorkitProgram.programId,
      newPasskeyPubkey,
      bump
    );

    const addMemberTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      addMemberIns,
      null,
      payer.publicKey,
      smartWallet,
      ExecuteAction.CallRuleProgram,
      newPasskeyPubkey
    );

    const addMemberSig = await sendAndConfirmTransaction(
      connection,
      addMemberTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Add member: ", addMemberSig);

    const transferSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: smartWallet,
      toPubkey: payer.publicKey,
      lamports: LAMPORTS_PER_SOL / 100,
    });

    const checkRuleIns = await transferLimitProgram.checkRuleIns(
      smartWallet,
      newSmartWalletAuthenticator,
      transferSolIns
    );

    const memberSignatureBytes = Buffer.from(
      newPasskey.sign(message),
      "base64"
    );

    const executeTxn2 = await lazorkitProgram.executeInstructionTxn(
      newPasskeyPubkey,
      message,
      memberSignatureBytes,
      checkRuleIns,
      transferSolIns,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ExecuteCpi
    );

    const sig3 = await sendAndConfirmTransaction(
      connection,
      executeTxn2,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Execute transfer: ", sig3);
  });

  xit("Change default to transfer limit and add member and member execute success", async () => {
    const privateKey = ECDSA.generateKey();

    const pubkey = Array.from(
      Buffer.from(privateKey.toCompressedPublicKey(), "base64")
    );

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(LAMPORTS_PER_SOL),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Change rule instruction: ", sig2);

    const newPasskey = ECDSA.generateKey();

    const newPasskeyPubkey = Array.from(
      Buffer.from(newPasskey.toCompressedPublicKey(), "base64")
    );

    const [newSmartWalletAuthenticator, bump] =
      lazorkitProgram.smartWalletAuthenticator(newPasskeyPubkey, smartWallet);

    const addMemberIns = await transferLimitProgram.addMemeberIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      newSmartWalletAuthenticator,
      lazorkitProgram.programId,
      newPasskeyPubkey,
      bump
    );

    const addMemberTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      addMemberIns,
      null,
      payer.publicKey,
      smartWallet,
      ExecuteAction.CallRuleProgram,
      newPasskeyPubkey
    );

    const addMemberSig = await sendAndConfirmTransaction(
      connection,
      addMemberTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Add member: ", addMemberSig);

    const transferSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: smartWallet,
      toPubkey: payer.publicKey,
      lamports: LAMPORTS_PER_SOL / 100,
    });

    const checkRuleIns = await transferLimitProgram.checkRuleIns(
      smartWallet,
      newSmartWalletAuthenticator,
      transferSolIns
    );

    const memberSignatureBytes = Buffer.from(
      newPasskey.sign(message),
      "base64"
    );

    const executeTxn2 = await lazorkitProgram.executeInstructionTxn(
      newPasskeyPubkey,
      message,
      memberSignatureBytes,
      checkRuleIns,
      transferSolIns,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ExecuteCpi
    );

    const sig3 = await sendAndConfirmTransaction(
      connection,
      executeTxn2,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Execute transfer: ", sig3);
  });

  it("Change default to transfer limit and add member and member execute but not transfer", async () => {
    const privateKey = ECDSA.generateKey();

    const pubkey = Array.from(
      Buffer.from(privateKey.toCompressedPublicKey(), "base64")
    );

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

    const smartWalletConfig = lazorkitProgram.smartWalletConfig(smartWallet);

    const [smartWalletAuthenticator] = lazorkitProgram.smartWalletAuthenticator(
      pubkey,
      smartWallet
    );

    // the user has deposit 0.01 SOL to the smart-wallet
    const depositSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: smartWallet,
      lamports: LAMPORTS_PER_SOL,
    });

    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(depositSolIns),
      [payer],
      {
        commitment: "confirmed",
      }
    );

    const initRuleIns = await defaultRuleProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const createSmartWalletTxn = await lazorkitProgram.createSmartWalletTxn(
      pubkey,
      initRuleIns,
      payer.publicKey
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", sig);

    // Change rule
    const destroyRuleDefaultIns = await defaultRuleProgram.destroyIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator
    );

    const initTransferLimitRule = await transferLimitProgram.initRuleIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      smartWalletConfig,
      {
        passkeyPubkey: pubkey,
        token: anchor.web3.PublicKey.default,
        limitAmount: new anchor.BN(LAMPORTS_PER_SOL),
        limitPeriod: new anchor.BN(1000),
      }
    );

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      destroyRuleDefaultIns,
      initTransferLimitRule,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ChangeProgramRule
    );

    const sig2 = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Change rule instruction: ", sig2);

    const newPasskey = ECDSA.generateKey();

    const newPasskeyPubkey = Array.from(
      Buffer.from(newPasskey.toCompressedPublicKey(), "base64")
    );

    const [newSmartWalletAuthenticator, bump] =
      lazorkitProgram.smartWalletAuthenticator(newPasskeyPubkey, smartWallet);

    const addMemberIns = await transferLimitProgram.addMemeberIns(
      payer.publicKey,
      smartWallet,
      smartWalletAuthenticator,
      newSmartWalletAuthenticator,
      lazorkitProgram.programId,
      newPasskeyPubkey,
      bump
    );

    const addMemberTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      addMemberIns,
      null,
      payer.publicKey,
      smartWallet,
      ExecuteAction.CallRuleProgram,
      newPasskeyPubkey
    );

    const addMemberSig = await sendAndConfirmTransaction(
      connection,
      addMemberTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Add member: ", addMemberSig);

    const createAccount = anchor.web3.SystemProgram.createAccount({
      fromPubkey: smartWallet,
      newAccountPubkey: Keypair.generate().publicKey,
      lamports: LAMPORTS_PER_SOL / 100,
      space: 0,
      programId: lazorkitProgram.programId,
    });

    const checkRuleIns = await transferLimitProgram.checkRuleIns(
      smartWallet,
      newSmartWalletAuthenticator,
      createAccount
    );

    const memberSignatureBytes = Buffer.from(
      newPasskey.sign(message),
      "base64"
    );

    const executeTxn2 = await lazorkitProgram.executeInstructionTxn(
      newPasskeyPubkey,
      message,
      memberSignatureBytes,
      checkRuleIns,
      createAccount,
      payer.publicKey,
      smartWallet,
      ExecuteAction.ExecuteCpi
    );

    const sig3 = await sendAndConfirmTransaction(
      connection,
      executeTxn2,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Execute transfer: ", sig3);
  });
});
