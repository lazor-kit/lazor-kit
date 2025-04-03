import {
  Connection,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Contract } from './idl/contract';
import IDL from './idl/contract.json';
import * as anchor from '@coral-xyz/anchor';
import {
  AddAuthenticatorsParam,
  CreateInitSmartWalletTransactionParam,
  CreateVerifyAndExecuteTransactionParam,
  Message,
  PasskeyPubkey,
  SmartWalletAuthority,
  VerifyParam,
} from '../types';
import { createSecp256r1Instruction, getID } from '../utils';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { LOOKUP_TABLE_ADDRESS, SMART_WALLET_SEED } from '../constants';
import crypto from 'crypto';
export class SolanaService {
  constructor(private readonly connection: Connection) {}

  private lookupTableAddress: PublicKey = LOOKUP_TABLE_ADDRESS;

  get program(): anchor.Program<Contract> {
    return new anchor.Program(IDL as Contract, {
      connection: this.connection,
    });
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  async getListSmartWalletAuthorityByPasskeyPubkey(
    authority: PasskeyPubkey
  ): Promise<PublicKey[]> {
    const data = await this.connection.getProgramAccounts(
      this.program.programId,
      {
        dataSlice: {
          offset: 8,
          length: 33,
        },
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: bs58.encode(
                IDL?.accounts.find(
                  (acc: { name: string; discriminator: number[] }) =>
                    acc.name === 'SmartWalletAuthority'
                )?.discriminator as number[]
              ),
            },
          },
          {
            memcmp: {
              offset: 8,
              bytes: bs58.encode(authority.data),
            },
          },
        ],
      }
    );

    if (data.length <= 0) {
      throw new Error('This passkey pubkey does not have any smart-wallet');
    }

    return data.map((item) => item.pubkey);
  }

  async getSmartWalletAuthorityData(
    smartWalletAuthorityPubkey: PublicKey
  ): Promise<SmartWalletAuthority> {
    return this.program.account.smartWalletAuthority.fetch(
      smartWalletAuthorityPubkey
    );
  }

  async getMessage(smartWalletAuthorityData: SmartWalletAuthority): Promise<{
    message: Message;
    messageBytes: Buffer<ArrayBufferLike>;
  }> {
    const slot = await this.connection.getSlot({ commitment: 'processed' });
    const timestamp = await this.connection.getBlockTime(slot);

    const message: Message = {
      nonce: smartWalletAuthorityData.nonce,
      timestamp: new anchor.BN(timestamp),
    };

    const messageBytes = this.program.coder.types.encode('message', message);

    return { message, messageBytes };
  }

  async createInitSmartWalletTransaction(
    param: CreateInitSmartWalletTransactionParam
  ): Promise<Transaction> {
    const { secp256r1PubkeyBytes, payer } = param;

    // check pubkey length
    if (secp256r1PubkeyBytes.length !== 33) {
      throw new Error('Invalid pubkey length');
    }

    const id = getID();

    const [smartWalletPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SMART_WALLET_SEED),
        new anchor.BN(id).toArrayLike(Buffer, 'le', 8),
      ],
      this.programId
    );

    const [smartWalletAuthorityPda] = PublicKey.findProgramAddressSync(
      [this.hashSeeds(secp256r1PubkeyBytes, smartWalletPda)],
      this.programId
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
    txn.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;

    return txn;
  }

  async createVerifyAndExecuteTransaction(
    params: CreateVerifyAndExecuteTransactionParam
  ): Promise<VersionedTransaction> {
    const {
      arbitraryInstruction,
      pubkey,
      signature,
      message,
      payer,
      smartWalletAuthority,
      smartWalletPubkey,
    } = params;

    // find signer and set isSigner to false
    let remainingAccounts = arbitraryInstruction.keys.map((key) => {
      return {
        pubkey: key.pubkey,
        isSigner: false,
        isWritable: key.isWritable,
      };
    });

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
      .executeInstruction(verifyParam, arbitraryInstruction.data)
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
      instructions: [verifySecp256r1Instruction, executeInstruction], // note this is an array of instructions
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    return transactionV0;
  }

  async addAuthenticatorsTxn(
    param: AddAuthenticatorsParam
  ): Promise<VersionedTransaction> {
    const {
      pubkey,
      signature,
      message,
      payer,
      newPasskey,
      smartWalletPubkey,
      smartWalletAuthority,
    } = param;

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
      [this.hashSeeds(Array.from(newPasskey.data), smartWalletPubkey)],
      this.programId
    );

    const addAuthIns = await this.program.methods
      .addAuthenticator(verifyParam, newPasskey)
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
      instructions: [verifySecp256r1Instruction, addAuthIns], // note this is an array of instructions
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    return transactionV0;
  }

  async setLookupTableAddress(lookupTableAddress: PublicKey) {
    this.lookupTableAddress = lookupTableAddress;
  }

  // hash with crypto
  hashSeeds(passkey: number[], smartWallet: PublicKey): Buffer {
    const data = Buffer.concat([Buffer.from(passkey), smartWallet.toBuffer()]);
    return crypto.createHash('sha256').update(data).digest().subarray(0, 32);
  }
} 