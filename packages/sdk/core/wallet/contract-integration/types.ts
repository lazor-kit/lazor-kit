import * as anchor from '@coral-xyz/anchor';
import { Lazorkit } from './anchor/types/lazorkit';

// ============================================================================
// Account Types (from on-chain state)
// ============================================================================
export type SmartWallet = anchor.IdlTypes<Lazorkit>['smartWallet'];
export type WalletDevice = anchor.IdlTypes<Lazorkit>['walletDevice'];
export type Config = anchor.IdlTypes<Lazorkit>['config'];
export type PolicyProgramRegistry =
  anchor.IdlTypes<Lazorkit>['policyProgramRegistry'];

// ============================================================================
// Instruction Argument Types (from on-chain instructions)
// ============================================================================
export type CreateSmartWalletArgs =
  anchor.IdlTypes<Lazorkit>['createSmartWalletArgs'];
export type ExecuteTransactionArgs =
  anchor.IdlTypes<Lazorkit>['executeTransactionArgs'];
export type UpdatePolicyArgs = anchor.IdlTypes<Lazorkit>['updatePolicyArgs'];
export type InvokePolicyArgs = anchor.IdlTypes<Lazorkit>['invokePolicyArgs'];
export type CreateSessionArgs = anchor.IdlTypes<Lazorkit>['createSessionArgs'];
export type NewWalletDeviceArgs =
  anchor.IdlTypes<Lazorkit>['newWalletDeviceArgs'];

// ============================================================================
// Configuration Types
// ============================================================================
export type UpdateConfigType = anchor.IdlTypes<Lazorkit>['updateConfigType'];

// ============================================================================
// Smart Wallet Action Types
// ============================================================================
export enum SmartWalletAction {
  UpdatePolicy = 'update_policy',
  InvokePolicy = 'invoke_policy',
  ExecuteTransaction = 'execute_transaction',
}

export type ArgsByAction = {
  [SmartWalletAction.ExecuteTransaction]: {
    policyInstruction: anchor.web3.TransactionInstruction | null;
    cpiInstruction: anchor.web3.TransactionInstruction;
  };
  [SmartWalletAction.InvokePolicy]: {
    policyInstruction: anchor.web3.TransactionInstruction;
    newWalletDevice: {
      passkeyPubkey: number[];
      credentialIdBase64: string;
    } | null;
  };
  [SmartWalletAction.UpdatePolicy]: {
    destroyPolicyIns: anchor.web3.TransactionInstruction;
    initPolicyIns: anchor.web3.TransactionInstruction;
    newWalletDevice: {
      passkeyPubkey: number[];
      credentialIdBase64: string;
    } | null;
  };
};

/**
 * Generic type for smart wallet action arguments.
 * Can be used for message building, SDK operations, or any other context
 * where you need to specify a smart wallet action with its arguments.
 */
export type SmartWalletActionArgs<
  K extends SmartWalletAction = SmartWalletAction
> = {
  type: K;
  args: ArgsByAction[K];
};

// ============================================================================
// Authentication Types
// ============================================================================
export interface PasskeySignature {
  passkeyPubkey: number[];
  signature64: string;
  clientDataJsonRaw64: string;
  authenticatorDataRaw64: string;
}

export interface NewPasskeyDevice {
  passkeyPubkey: number[];
  credentialIdBase64: string;
}

// ============================================================================
// Transaction Builder Types
// ============================================================================
export interface CreateSmartWalletParams {
  payer: anchor.web3.PublicKey;
  passkeyPubkey: number[];
  credentialIdBase64: string;
  policyInstruction?: anchor.web3.TransactionInstruction | null;
  isPayForUser?: boolean;
  smartWalletId?: anchor.BN;
}

export interface ExecuteTransactionParams {
  payer: anchor.web3.PublicKey;
  smartWallet: anchor.web3.PublicKey;
  passkeySignature: PasskeySignature;
  policyInstruction: anchor.web3.TransactionInstruction | null;
  cpiInstruction: anchor.web3.TransactionInstruction;
}

export interface InvokePolicyParams {
  payer: anchor.web3.PublicKey;
  smartWallet: anchor.web3.PublicKey;
  passkeySignature: PasskeySignature;
  policyInstruction: anchor.web3.TransactionInstruction;
  newWalletDevice?: NewPasskeyDevice | null;
}

export interface UpdatePolicyParams {
  payer: anchor.web3.PublicKey;
  smartWallet: anchor.web3.PublicKey;
  passkeySignature: PasskeySignature;
  destroyPolicyInstruction: anchor.web3.TransactionInstruction;
  initPolicyInstruction: anchor.web3.TransactionInstruction;
  newWalletDevice?: NewPasskeyDevice | null;
}

export interface CreateTransactionSessionParams {
  payer: anchor.web3.PublicKey;
  smartWallet: anchor.web3.PublicKey;
  passkeySignature: PasskeySignature;
  policyInstruction: anchor.web3.TransactionInstruction | null;
  expiresAt: number;
}

export interface ExecuteSessionTransactionParams {
  payer: anchor.web3.PublicKey;
  smartWallet: anchor.web3.PublicKey;
  cpiInstruction: anchor.web3.TransactionInstruction;
}
