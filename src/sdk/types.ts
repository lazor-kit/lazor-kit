import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Contract } from '../idl/contract';

export type Message = anchor.IdlTypes<Contract>['message'];
export type VerifyParam = anchor.IdlTypes<Contract>['verifyParam'];
export type PasskeyPubkey = anchor.IdlTypes<Contract>['passkeyPubkey'];
export type SmartWalletAuthority =
  anchor.IdlTypes<Contract>['smartWalletAuthority'];

export type CreateVerifyAndExecuteTransactionParam = {
  arbitraryInstruction: TransactionInstruction;
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
};

export type CreateInitSmartWalletTransactionParam = {
  secp256r1PubkeyBytes: number[];
  payer: PublicKey;
};

export type AddAuthenticatorsParam = {
  pubkey: Buffer<ArrayBuffer>;
  signature: Buffer<ArrayBuffer>;
  message: Message;
  payer: PublicKey;
  newPasskey: PasskeyPubkey;
  smartWalletPubkey: PublicKey;
  smartWalletAuthority: PublicKey;
};
