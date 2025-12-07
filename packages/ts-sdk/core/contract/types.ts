import * as anchor from '@coral-xyz/anchor';
import { Lazorkit } from './anchor/types/lazorkit';

// ============================================================================
// Core Types (from on-chain)
// ============================================================================
export type WalletState = anchor.IdlTypes<Lazorkit>['walletState'];
export type WalletDevice = anchor.IdlTypes<Lazorkit>['walletDevice'];
export type Chunk = anchor.IdlTypes<Lazorkit>['chunk'];

// Instruction Args
export type CreateSmartWalletArgs =
  anchor.IdlTypes<Lazorkit>['createSmartWalletArgs'];
export type ExecuteArgs = anchor.IdlTypes<Lazorkit>['executeArgs'];
export type CreateChunkArgs = anchor.IdlTypes<Lazorkit>['createChunkArgs'];

// ============================================================================
// Branded Types for Type Safety
// ============================================================================

/**
 * Branded type for passkey public key (33 bytes)
 * This ensures type safety and prevents mixing up different byte arrays
 */
export type PasskeyPublicKey = number[] & {
  readonly __brand: 'PasskeyPublicKey';
};

/**
 * Branded type for credential hash (32 bytes)
 */
export type CredentialHash = number[] & { readonly __brand: 'CredentialHash' };

/**
 * Branded type for signature (64 bytes)
 */
export type Signature = number[] & { readonly __brand: 'Signature' };

// ============================================================================
// Type-Safe Conversion Helpers
// ============================================================================

/**
 * Creates a type-safe PasskeyPublicKey from a validated number array
 * WARNING: This function does NOT validate the input. Use validation functions first.
 * @internal
 */
export function asPasskeyPublicKey(value: number[]): PasskeyPublicKey {
  return value as PasskeyPublicKey;
}

/**
 * Creates a type-safe CredentialHash from a validated number array
 * WARNING: This function does NOT validate the input. Use validation functions first.
 * @internal
 */
export function asCredentialHash(value: number[]): CredentialHash {
  return value as CredentialHash;
}

/**
 * Creates a type-safe Signature from a validated number array
 * WARNING: This function does NOT validate the input. Use validation functions first.
 * @internal
 */
export function asSignature(value: number[]): Signature {
  return value as Signature;
}

// ============================================================================
// Smart Wallet Actions
// ============================================================================
export enum SmartWalletAction {
  Execute = 'execute',
  CreateChunk = 'create_chunk',
  ExecuteChunk = 'execute_chunk',
}

export type ArgsByAction = {
  [SmartWalletAction.Execute]: {
    policyInstruction: anchor.web3.TransactionInstruction | null;
    cpiInstruction: anchor.web3.TransactionInstruction;
    cpiSigners?: readonly anchor.web3.PublicKey[];
  };
  [SmartWalletAction.CreateChunk]: {
    policyInstruction: anchor.web3.TransactionInstruction | null;
    cpiInstructions: readonly anchor.web3.TransactionInstruction[];
    expiresAt: number;
    cpiSigners?: readonly anchor.web3.PublicKey[];
  };
  [SmartWalletAction.ExecuteChunk]: {
    cpiInstructions: readonly anchor.web3.TransactionInstruction[];
    cpiSigners?: readonly anchor.web3.PublicKey[];
  };
};

export type SmartWalletActionArgs<
  K extends SmartWalletAction = SmartWalletAction
> = {
  type: K;
  args: ArgsByAction[K];
};

// ============================================================================
// Authentication & Transaction Types
// ============================================================================

/**
 * Passkey signature data for authentication
 * All fields are required and validated
 */
export interface PasskeySignature {
  /** Passkey public key (33 bytes, compressed secp256r1) */
  readonly passkeyPublicKey: PasskeyPublicKey;
  /** Base64-encoded signature (64 bytes when decoded) */
  readonly signature64: string;
  /** Base64-encoded client data JSON */
  readonly clientDataJsonRaw64: string;
  /** Base64-encoded authenticator data */
  readonly authenticatorDataRaw64: string;
}

export interface TransactionBuilderOptions {
  /** Use versioned transaction (v0) instead of legacy */
  readonly useVersionedTransaction?: boolean;
  /** Address lookup table for versioned transactions */
  readonly addressLookupTable?: anchor.web3.AddressLookupTableAccount;
  /** Custom recent blockhash (if not provided, fetched from connection) */
  readonly recentBlockhash?: string;
  /** Compute unit limit for transaction */
  readonly computeUnitLimit?: number;
}

export interface TransactionBuilderResult {
  readonly transaction:
  | anchor.web3.Transaction
  | anchor.web3.VersionedTransaction;
  readonly isVersioned: boolean;
  readonly recentBlockhash: string;
}

// ============================================================================
// Base Parameter Types
// ============================================================================

/**
 * Base parameters required for all smart wallet operations
 */
export interface BaseParams {
  /** Payer account that will pay for transaction fees */
  readonly payer: anchor.web3.PublicKey;
  /** Smart wallet PDA address */
  readonly smartWallet: anchor.web3.PublicKey;
}

/**
 * Parameters for operations requiring authentication
 */
export interface AuthParams extends BaseParams {
  /** Passkey signature for authentication */
  readonly passkeySignature: PasskeySignature;
  /** Credential hash (32 bytes) */
  readonly credentialHash: CredentialHash;
}

// ============================================================================
// Parameter Types (Strict)
// ============================================================================

/**
 * Parameters for creating a new smart wallet
 * All required fields must be provided and validated
 */
export interface CreateSmartWalletParams {
  /** Payer account that will pay for transaction fees (required) */
  readonly payer: anchor.web3.PublicKey;
  /** Passkey public key (33 bytes, compressed secp256r1) (required) */
  readonly passkeyPublicKey: PasskeyPublicKey;
  /** Base64-encoded credential ID (required, must be valid base64) */
  readonly credentialIdBase64: string;
  /** Initial funding amount in lamports (optional, defaults to EMPTY_PDA_RENT_EXEMPT_BALANCE) */
  readonly amount?: anchor.BN;
  /** Custom policy instruction (optional, if not provided, default policy is used) */
  readonly policyInstruction?: anchor.web3.TransactionInstruction | null;
  /** Wallet ID (optional, if not provided, a random one is generated) */
  readonly smartWalletId?: anchor.BN;
  /** Policy data size in bytes (optional, if not provided, default policy size is used) */
  readonly policyDataSize?: number;
}

/**
 * Parameters for executing a direct transaction
 * Note: smartWalletId is derived from smartWallet, so it's not required
 * All required fields must be provided and validated
 */
export interface ExecuteParams extends AuthParams {
  /** Policy instruction (null for default policy, must be valid TransactionInstruction if provided) */
  readonly policyInstruction: anchor.web3.TransactionInstruction | null;
  /** CPI instruction to execute (required, must be valid TransactionInstruction) */
  readonly cpiInstruction: anchor.web3.TransactionInstruction;
  /** Transaction timestamp (Unix timestamp in seconds, required, must be non-negative) */
  readonly timestamp: anchor.BN;
  /** Optional signers for CPI instruction (all must be valid PublicKeys if provided) */
  readonly cpiSigners?: readonly anchor.web3.PublicKey[];
}

/**
 * Parameters for creating a deferred execution (chunk)
 * All required fields must be provided and validated
 */
export interface CreateChunkParams extends AuthParams {
  /** Policy instruction (null for default policy, must be valid TransactionInstruction if provided) */
  readonly policyInstruction: anchor.web3.TransactionInstruction | null;
  /** CPI instructions to execute later (required, must be non-empty array, all must be valid TransactionInstructions) */
  readonly cpiInstructions: readonly anchor.web3.TransactionInstruction[];
  /** Transaction timestamp (Unix timestamp in seconds, required, must be non-negative) */
  readonly timestamp: anchor.BN;
  /** Optional signers for CPI instructions (all must be valid PublicKeys if provided) */
  readonly cpiSigners?: readonly anchor.web3.PublicKey[];
}

/**
 * Parameters for executing a deferred transaction (chunk)
 * No authentication required as it was already verified during chunk creation
 * All required fields must be provided and validated
 */
export interface ExecuteChunkParams extends BaseParams {
  /** CPI instructions to execute (required, must be non-empty array, all must be valid TransactionInstructions) */
  readonly cpiInstructions: readonly anchor.web3.TransactionInstruction[];
  /** Optional signers for CPI instructions (all must be valid PublicKeys if provided) */
  readonly cpiSigners?: readonly anchor.web3.PublicKey[];
}

/**
 * Parameters for closing a chunk
 * All required fields must be provided and validated
 */
export interface CloseChunkParams extends BaseParams {
  /** Nonce of the chunk to close (required, must be non-negative) */
  readonly nonce: anchor.BN;
}
