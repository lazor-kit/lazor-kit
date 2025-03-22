import {
  Connection,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Contract } from '../idl/contract';
import IDL from '../idl/contract.json';
import {
  CreateSmartWalletParams,
  ExecuteTransactionParams,
  AddAuthenticatorParams,
  Message,
  VerifyParam,
} from '../types';
import { createSecp256r1Instruction, getID } from '../utils';
import { LOOKUP_TABLE_ADDRESS, SMART_WALLET_SEED } from '../constants';
import crypto from 'crypto';

export class SolanaService {
  private connection: Connection;
  private program: anchor.Program<Contract>;
  private lookupTableAddress: PublicKey;

  constructor(connection: Connection) {
    this.connection = connection;
    this.program = new anchor.Program(IDL as Contract, {
      connection: this.connection,
    });
    this.lookupTableAddress = LOOKUP_TABLE_ADDRESS;
  }

  async createSmartWallet(params: CreateSmartWalletParams): Promise<Transaction> {
    const { secp256r1PubkeyBytes, payer } = params;

    if (secp256r1PubkeyBytes.length !== 33) {
      throw new Error('Invalid pubkey length');
    }

    const id = getID();

    const [smartWalletPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SMART_WALLET_SEED),
        new anchor.BN(id).toArrayLike(Buffer, 'le', 8),
      ],
      this.program.programId
    );

    const [smartWalletAuthorityPda] = PublicKey.findProgramAddressSync(
      [this.hashSeeds(secp256r1PubkeyBytes, smartWalletPda)],
      this.program.programId
    );

    const createSmartWalletIns = await this.program.methods
      .initSmartWallet({ data: secp256r1PubkeyBytes }, new anchor.BN(id))
      .accountsPartial({
        signer: payer,
        smartWallet: smartWalletPda,
        smartWalletAuthority: smartWalletAuthorityPda,
      })
      .instruction();

    const txn = new Transaction().add(createSmartWalletIns);

    txn.feePayer = payer;
    txn.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return txn;
  }

  async executeTransaction(params: ExecuteTransactionParams): Promise<VersionedTransaction> {
    const {
      arbitraryInstruction,
      pubkey,
      signature,
      message,
      payer,
      smartWalletAuthority,
      smartWalletPubkey,
    } = params;

    let remainingAccounts = arbitraryInstruction.keys.map((key) => ({
      pubkey: key.pubkey,
      isSigner: false,
      isWritable: key.isWritable,
    }));

    const messageBytes = this.program.coder.types.encode('message', message);

    const verifySecp256r1Instruction = createSecp256r1Instruction(
      messageBytes,
      pubkey,
      signature
    );

    const verifyParam: VerifyParam = {
      pubkey: { data: Array.from(pubkey) },
      msg: message,
      sig: Array.from(signature),
    };

    const executeInstruction = await this.program.methods
      .executeInstruction(verifyParam)
      .accountsPartial({
        smartWallet: smartWalletPubkey,
        smartWalletAuthority,
        cpiProgram: arbitraryInstruction.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    const blockhash = (await this.connection.getLatestBlockhash()).blockhash;

    const lookupTableAccount = (
      await this.connection.getAddressLookupTable(this.lookupTableAddress)
    ).value;

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [verifySecp256r1Instruction, executeInstruction],
    }).compileToV0Message([lookupTableAccount]);

    return new VersionedTransaction(messageV0);
  }

  async addAuthenticator(params: AddAuthenticatorParams): Promise<VersionedTransaction> {
    const {
      pubkey,
      signature,
      message,
      payer,
      smartWalletPubkey,
      smartWalletAuthority,
    } = params;

    const messageBytes = this.program.coder.types.encode('message', message);

    const verifySecp256r1Instruction = createSecp256r1Instruction(
      messageBytes,
      pubkey,
      signature
    );

    const verifyParam: VerifyParam = {
      pubkey: { data: Array.from(pubkey) },
      msg: message,
      sig: Array.from(signature),
    };

    const [newSmartWalletAuthorityPda] = PublicKey.findProgramAddressSync(
      [this.hashSeeds(Array.from(message.payload), smartWalletPubkey)],
      this.program.programId
    );

    const addAuthIns = await this.program.methods
      .addAuthenticator(verifyParam, {
        data: Array.from(message.payload),
      })
      .accountsPartial({
        payer,
        smartWallet: smartWalletPubkey,
        smartWalletAuthority,
        newWalletAuthority: newSmartWalletAuthorityPda,
      })
      .instruction();

    const blockhash = (await this.connection.getLatestBlockhash()).blockhash;

    const lookupTableAccount = (
      await this.connection.getAddressLookupTable(this.lookupTableAddress)
    ).value;

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [verifySecp256r1Instruction, addAuthIns],
    }).compileToV0Message([lookupTableAccount]);

    return new VersionedTransaction(messageV0);
  }

  private hashSeeds(passkey: number[], smartWallet: PublicKey): Buffer {
    const data = Buffer.concat([Buffer.from(passkey), smartWallet.toBuffer()]);
    return crypto.createHash('sha256').update(data).digest().subarray(0, 32);
  }
} 