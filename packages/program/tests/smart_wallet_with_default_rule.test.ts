import * as anchor from "@coral-xyz/anchor";
import ECDSA from "ecdsa-secp256r1";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { LazorKitProgram } from "../sdk/lazor-kit";
import { DefaultRuleProgram } from "../sdk/default-rule-program";
import { createNewMint, mintTokenTo } from "./utils";
import { createTransferCheckedInstruction } from "@solana/spl-token";
dotenv.config();

describe.skip("Test smart wallet with default rule", () => {
  const connection = new anchor.web3.Connection(
    process.env.RPC_URL || "http://localhost:8899",
    "confirmed"
  );

  const lazorkitProgram = new LazorKitProgram(connection);

  const defaultRuleProgram = new DefaultRuleProgram(connection);

  const payer = anchor.web3.Keypair.fromSecretKey(
    bs58.decode(process.env.PRIVATE_KEY!)
  );

  before(async () => {
    // airdrop some SOL to the payer

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
  });

  it("Initialize successfully", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const SeqBefore = await lazorkitProgram.smartWalletSeqData;

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

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

    const SeqAfter = await lazorkitProgram.smartWalletSeqData;

    expect(SeqAfter.seq.toString()).to.be.equal(
      SeqBefore.seq.add(new anchor.BN(1)).toString()
    );

    const smartWalletConfigData =
      await lazorkitProgram.getSmartWalletConfigData(smartWallet);

    expect(smartWalletConfigData.id.toString()).to.be.equal(
      SeqBefore.seq.toString()
    );

    const smartWalletAuthenticatorData =
      await lazorkitProgram.getSmartWalletAuthenticatorData(
        smartWalletAuthenticator
      );

    expect(smartWalletAuthenticatorData.passkeyPubkey.toString()).to.be.equal(
      pubkey.toString()
    );
    expect(smartWalletAuthenticatorData.smartWallet.toString()).to.be.equal(
      smartWallet.toString()
    );
  });

  it("Spend SOL successfully", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

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

    const createSmartWalletSig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", createSmartWalletSig);

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const transferSolIns = anchor.web3.SystemProgram.transfer({
      fromPubkey: smartWallet,
      toPubkey: Keypair.generate().publicKey,
      lamports: 4000000,
    });

    const checkRule = await defaultRuleProgram.checkRuleIns(
      smartWallet,
      smartWalletAuthenticator
    );

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      checkRule,
      transferSolIns,
      payer.publicKey,
      smartWallet
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
      }
    );

    console.log("Execute txn: ", sig);
  });

  it("Spend Token successfully", async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, "base64"));

    const smartWallet = await lazorkitProgram.getLastestSmartWallet();

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

    const createSmartWalletSig = await sendAndConfirmTransaction(
      connection,
      createSmartWalletTxn,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log("Create smart-wallet: ", createSmartWalletSig);

    const message = Buffer.from("hello");
    const signatureBytes = Buffer.from(privateKey.sign(message), "base64");

    const mint = await createNewMint(connection, payer, 6);
    const smartWalletTokenAccount = await mintTokenTo(
      connection,
      mint,
      payer,
      payer,
      smartWallet,
      100_000 * 10 ** 6
    );

    const randomTokenAccount = await mintTokenTo(
      connection,
      mint,
      payer,
      payer,
      Keypair.generate().publicKey,
      1_000_000
    );

    const transferTokenIns = createTransferCheckedInstruction(
      smartWalletTokenAccount,
      mint,
      randomTokenAccount,
      smartWallet,
      100_000 * 10 ** 6,
      6,
      []
    );

    const checkRule = await defaultRuleProgram.checkRuleIns(
      smartWallet,
      smartWalletAuthenticator
    );

    const executeTxn = await lazorkitProgram.executeInstructionTxn(
      pubkey,
      message,
      signatureBytes,
      checkRule,
      transferTokenIns,
      payer.publicKey,
      smartWallet
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      executeTxn,
      [payer],
      {
        commitment: "confirmed",
      }
    );

    console.log("Execute txn: ", sig);
  });
});
