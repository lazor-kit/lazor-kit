import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { IdlTypes } from '@coral-xyz/anchor';
import { Contract } from './idl/contract';
import { Buffer } from 'buffer';

export type Message = IdlTypes<Contract>['message'];
export type VerifyParam = IdlTypes<Contract>['verifyParam'];
export type PasskeyPubkey = IdlTypes<Contract>['passkeyPubkey'];
export type SmartWalletAuthority =
  IdlTypes<Contract>['smartWalletAuthority'];

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
