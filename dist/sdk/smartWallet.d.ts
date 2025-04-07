import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Contract } from '../idl/contract';
import * as anchor from '@coral-xyz/anchor';
import { AddAuthenticatorsParam, CreateInitSmartWalletTransactionParam, CreateVerifyAndExecuteTransactionParam, Message, PasskeyPubkey, SmartWalletAuthority } from './types';
export declare class SmartWalletContract {
    private readonly connection;
    constructor(connection: Connection);
    private lookupTableAddress;
    get program(): anchor.Program<Contract>;
    get programId(): PublicKey;
    getListSmartWalletAuthorityByPasskeyPubkey(authority: PasskeyPubkey): Promise<PublicKey[]>;
    getSmartWalletAuthorityData(smartWalletAuthorityPubkey: PublicKey): Promise<SmartWalletAuthority>;
    getMessage(smartWalletAuthorityData: SmartWalletAuthority): Promise<{
        message: Message;
        messageBytes: Buffer<ArrayBufferLike>;
    }>;
    createInitSmartWalletTransaction(param: CreateInitSmartWalletTransactionParam): Promise<Transaction>;
    createVerifyAndExecuteTransaction(params: CreateVerifyAndExecuteTransactionParam): Promise<VersionedTransaction>;
    addAuthenticatorsTxn(param: AddAuthenticatorsParam): Promise<VersionedTransaction>;
    setLookupTableAddress(lookupTableAddress: PublicKey): Promise<void>;
    hashSeeds(passkey: number[], smartWallet: PublicKey): Buffer;
}
//# sourceMappingURL=smartWallet.d.ts.map