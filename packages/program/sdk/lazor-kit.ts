import * as anchor from '@coral-xyz/anchor';
import IDL from '../target/idl/lazorkit.json';
import * as bs58 from 'bs58';
import { Lazorkit } from '../target/types/lazorkit';
import * as constants from './constants';
import {
  createSecp256r1Instruction,
  hashSeeds,
  instructionToAccountMetas,
} from './utils';
import * as types from './types';
import { sha256 } from 'js-sha256';
import * as borsh from 'borsh';
import { Buffer } from 'buffer';

// Polyfill for structuredClone (e.g. React Native/Expo)
if (typeof globalThis.structuredClone !== 'function') {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – minimal polyfill for non-circular data
  globalThis.structuredClone = (obj: unknown) =>
    JSON.parse(JSON.stringify(obj));
}

export class LazorKitProgram {
  /** Network connection used by all RPC / account queries */
  readonly connection: anchor.web3.Connection;

  /** Cached IDL to avoid repeated JSON parsing */
  readonly Idl: anchor.Idl = IDL as Lazorkit;

  /** Lazily-instantiated (and cached) Anchor `Program` wrapper */
  private _program?: anchor.Program<Lazorkit>;

  /** Frequently-used PDA caches (network-independent, so safe to memoise) */
  private _smartWalletSeq?: anchor.web3.PublicKey;
  private _config?: anchor.web3.PublicKey;

  constructor(connection: anchor.web3.Connection) {
    this.connection = connection;
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
    return anchor.web3.PublicKey.findProgramAddressSync(
      [constants.SMART_WALLET_AUTHENTICATOR_SEED, smartWallet.toBuffer(), hash],
      this.programId
    );
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
    payer: anchor.web3.PublicKey
  ): Promise<anchor.web3.Transaction> {
    const ix = await this.program.methods
      .initialize()
      .accountsPartial({
        signer: payer,
        config: this.config,
        smartWalletSeq: this.smartWalletSeq,
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

  async createSmartWalletTxn(
    passkeyPubkey: number[],
    payer: anchor.web3.PublicKey,
    credentialId: string = ''
  ): Promise<anchor.web3.Transaction> {
    const smartWallet = await this.getLastestSmartWallet();
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(
      passkeyPubkey,
      smartWallet
    );

    const createSmartWalletIx = await this.program.methods
      .createSmartWallet(passkeyPubkey, Buffer.from(credentialId, 'base64'))
      .accountsPartial({
        signer: payer,
        smartWalletSeq: this.smartWalletSeq,
        smartWallet,
        smartWalletConfig: this.smartWalletConfig(smartWallet),
        smartWalletAuthenticator,
        config: this.config,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
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
    cpiIns: anchor.web3.TransactionInstruction,
    verifyInstructionIndex: number = 1
  ): Promise<anchor.web3.Transaction> {
    const [smartWalletAuthenticator] = this.smartWalletAuthenticator(
      passkeyPubkey,
      smartWallet
    );

    const remainingAccounts: anchor.web3.AccountMeta[] = [
      ...instructionToAccountMetas(cpiIns, payer),
    ];

    const message = Buffer.concat([
      authenticatorDataRaw,
      Buffer.from(sha256.arrayBuffer(clientDataJsonRaw)),
    ]);

    const verifySignatureIx = createSecp256r1Instruction(
      message,
      Buffer.from(passkeyPubkey),
      signature
    );

    const executeInstructionIx = await this.program.methods
      .executeInstruction({
        passkeyPubkey,
        signature,
        clientDataJsonRaw,
        authenticatorDataRaw,
        verifyInstructionIndex,
      })
      .accountsPartial({
        payer,
        config: this.config,
        smartWallet,
        smartWalletConfig: this.smartWalletConfig(smartWallet),
        smartWalletAuthenticator,

        ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        cpiProgram: cpiIns.programId,
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
    txn.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
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

    const smartWalletAuthenticatorData =
      await this.getSmartWalletAuthenticatorData(accounts[0].pubkey);

    return {
      smartWalletAuthenticator: accounts[0].pubkey,
      smartWallet: smartWalletAuthenticatorData.smartWallet,
    };
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

  /**
   * Build the serialized Message struct used for signing requests.
   */
  async getMessage(
    smartWallet: string,
    instructionData: Buffer
  ): Promise<Buffer> {
    const smartWalletData = await this.getSmartWalletConfigData(
      new anchor.web3.PublicKey(smartWallet)
    );

    // Manually serialize the message struct:
    // - nonce (u64): 8 bytes
    // - current_slot (i64): 8 bytes  
    // - instruction_data (Vec<u8>): 4 bytes length + data bytes
    
    const currentSlot = await this.connection.getSlot();
    const instructionDataLength = instructionData.length;
    
    // Calculate total buffer size: 8 + 8 + 4 + instructionDataLength
    const buffer = Buffer.alloc(20 + instructionDataLength);
    
    // Write nonce as little-endian u64 (bytes 0-7)
    buffer.writeBigUInt64LE(BigInt(smartWalletData.lastNonce.toString()), 0);
    
    // Write current_slot as little-endian i64 (bytes 8-15)
    buffer.writeBigInt64LE(BigInt(currentSlot), 8);
    
    // Write instruction_data length as little-endian u32 (bytes 16-19)
    buffer.writeUInt32LE(instructionDataLength, 16);
    
    // Write instruction_data bytes (starting at byte 20)
    instructionData.copy(buffer, 20);
    
    return buffer;
  }
}
