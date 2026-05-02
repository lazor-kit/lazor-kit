import React from 'react';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import type { DeferredPayload, SessionAction, WebAuthnResponse } from './program';

/**
 * Core wallet types
 */
export interface WalletInfo {
  readonly credentialId: string;
  /** 33-byte compressed secp256r1 public key as number[] */
  passkeyPubkey: number[];
  readonly expo: string;
  readonly platform: string;
  /**
   * Base58 vault PDA — the address where SOL/tokens actually live for this
   * smart wallet. This is the address users should see, share, and query for
   * balances.
   */
  readonly smartWallet: string;
  /**
   * Base58 wallet PDA (metadata/authority account, derived from
   * `['wallet', userSeed]`). Used internally by SDK operations; not the
   * address where funds reside.
   */
  readonly walletPda: string;
  /** Base58 authority PDA (derived from `['authority', walletPda, credentialIdHash]`) */
  readonly walletDevice: string;
}

export interface WalletConfig {
  readonly portalUrl: string;
  readonly configPaymaster: {
    readonly paymasterUrl: string;
    readonly apiKey?: string;
  };
  readonly rpcUrl?: string;
  /** WebAuthn Relying Party ID, e.g. "portal.lazor.sh". Defaults to portal host. */
  readonly rpId?: string;
}

/**
 * Provider configuration types
 */
export interface LazorKitProviderProps {
  readonly rpcUrl?: string;
  readonly portalUrl?: string;
  readonly configPaymaster?: {
    readonly paymasterUrl: string;
    readonly apiKey?: string;
  };
  readonly rpId?: string;
  readonly isDebug?: boolean;
  readonly children:
  | React.JSX.Element
  | React.JSX.Element[]
  | string
  | number
  | boolean
  | null
  | undefined;
}

/**
 * Browser interaction types — portal returns base64-encoded WebAuthn pieces.
 */
export interface BrowserResult {
  readonly signature: string;
  readonly clientDataJsonBase64: string;
  readonly authenticatorDataBase64: string;
  readonly message: string;
}

/**
 * Operation options
 */
export interface ConnectOptions {
  readonly redirectUrl: string;
  readonly onSuccess?: (wallet: WalletInfo) => void;
  readonly onFail?: (error: Error) => void;
}

export interface DisconnectOptions {
  readonly onSuccess?: () => void;
  readonly onFail?: (error: Error) => void;
}

export interface SignOptions {
  readonly redirectUrl: string;
  readonly onSuccess?: (result: any) => void;
  readonly onFail?: (error: Error) => void;
}

/**
 * Transaction options shared across passkey-signed flows.
 */
export interface TransactionOptions {
  readonly feeToken?: string;
  readonly addressLookupTableAccounts?: AddressLookupTableAccount[];
  readonly computeUnitLimit?: number;
  readonly clusterSimulation?: 'devnet' | 'mainnet';
}

/** Payload for single-tx `signAndSendTransaction` (and the 2-tx deferred flow). */
export interface SignAndSendTransactionPayload {
  readonly instructions: TransactionInstruction[];
  readonly transactionOptions?: TransactionOptions;
}

/** Payload for `authorizeAndExecute` (2-tx deferred, bundled). */
export interface AuthorizeExecutePayload extends SignAndSendTransactionPayload {
  /** Expiry offset in slots for the authorization window (default 300 = ~2 min). */
  readonly expiryOffset?: number;
}

/** Payload for `authorize` (standalone TX1 — returns payload so TX2 can happen elsewhere). */
export interface AuthorizePayload {
  readonly instructions: TransactionInstruction[];
  /** Expiry offset in slots for the authorization window (default 300 = ~2 min). */
  readonly expiryOffset?: number;
  readonly transactionOptions?: TransactionOptions;
}

/** Result returned from a successful `authorize` call. Persist `deferredPayload` to
 *  submit `executeDeferred` from another device / later / via relayer. */
export interface AuthorizeResult {
  /** TX1 (Authorize) transaction signature. */
  readonly signature: string;
  /** Serializable payload required to submit TX2 (ExecuteDeferred). */
  readonly deferredPayload: DeferredPayload;
  /** PDA of the on-chain DeferredExec account the payload writes to. */
  readonly deferredExecPda: PublicKey;
  /** Odometer counter used when authorising (for debugging / analytics). */
  readonly counter: number;
}

/** Payload for `executeDeferred` (standalone TX2 from a previously-authorized payload). */
export interface ExecuteDeferredPayload {
  readonly deferredPayload: DeferredPayload;
  /** Where the closed DeferredExec PDA's rent lands. Defaults to the paymaster fee payer. */
  readonly refundDestination?: PublicKey;
  readonly transactionOptions?: TransactionOptions;
}

/** Payload for `reclaimDeferred` — close an expired DeferredExec to recover its rent. */
export interface ReclaimDeferredPayload {
  readonly deferredExecPda: PublicKey;
  /** Where the reclaimed rent lands. Defaults to the paymaster fee payer. */
  readonly refundDestination?: PublicKey;
}

/** Callbacks for flows that don't need a passkey prompt (no `redirectUrl`). */
export interface TxCallbacks {
  readonly onSuccess?: (signature: string) => void;
  readonly onFail?: (error: Error) => void;
}

/** Payload for session-signed send (Ed25519 signed locally, no portal prompt). */
export interface SessionSignPayload {
  readonly sessionKeypair: Keypair;
  readonly sessionPda: PublicKey;
  readonly instructions: TransactionInstruction[];
  readonly transactionOptions?: TransactionOptions;
}

/** Payload for `createSession`. */
export interface CreateSessionPayload {
  /** New session public key (Ed25519). Clients typically generate a fresh Keypair. */
  readonly sessionKey: PublicKey;
  /** Absolute slot at which the session expires. */
  readonly expiresAtSlot: bigint;
  /** Optional permission actions (spending limits, program whitelist, etc.). */
  readonly actions?: SessionAction[];
}

/** Payload for `revokeSession`. */
export interface RevokeSessionPayload {
  readonly sessionPda: PublicKey;
  readonly refundDestination?: PublicKey;
}

/** Payload for `addAuthorityEd25519`. */
export interface AddAuthorityPayload {
  readonly newEd25519Pubkey: PublicKey;
  /** Role: ROLE_ADMIN (1) or ROLE_SPENDER (2). Defaults to SPENDER. */
  readonly role?: number;
}

/** Payload for `removeAuthority`. */
export interface RemoveAuthorityPayload {
  readonly targetAuthorityPda: PublicKey;
  readonly refundDestination?: PublicKey;
}

/** Payload for `transferSol` convenience. */
export interface TransferSolPayload {
  readonly recipient: PublicKey;
  readonly lamports: bigint | number;
  readonly transactionOptions?: TransactionOptions;
}

/** Authority entry returned by `listAuthorities`. */
export interface AuthorityEntry {
  readonly authorityPda: PublicKey;
  /** 0 = ed25519, 1 = secp256r1 */
  readonly authorityType: number;
  /** 0 = owner, 1 = admin, 2 = spender */
  readonly role: number;
  /** Ed25519: 32-byte pubkey. Secp256r1: 32-byte credential-id hash. */
  readonly credential: Uint8Array;
  /** Secp256r1 only: 33-byte compressed pubkey. */
  readonly secp256r1Pubkey?: Uint8Array;
}

export type ListAuthoritiesResult = AuthorityEntry[];

/**
 * Store state
 */
export interface WalletStateClient {
  // Data
  wallet: WalletInfo | null;
  config: WalletConfig;
  connection: Connection;

  // Status
  isLoading: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;

  // State setters
  setConfig: (config: WalletConfig) => void;
  setWallet: (wallet: WalletInfo | null) => void;
  setLoading: (isLoading: boolean) => void;
  setConnecting: (isConnecting: boolean) => void;
  setSigning: (isSigning: boolean) => void;
  setConnection: (connection: Connection) => void;
  setError: (error: Error | null) => void;
  clearError: () => void;

  // Actions
  connect: (options: ConnectOptions) => Promise<WalletInfo>;
  disconnect: () => Promise<void>;
  signAndExecuteTransaction: (payload: SignAndSendTransactionPayload, options: SignOptions) => Promise<void>;
  signMessage: (message: string, options: SignOptions) => Promise<void>;
  createSession: (
    payload: CreateSessionPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; sessionPda: PublicKey } | undefined>;
  revokeSession: (
    payload: RevokeSessionPayload,
    options: SignOptions,
  ) => Promise<string | undefined>;
  signAndSendWithSession: (
    payload: SessionSignPayload,
    options: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
  ) => Promise<string | undefined>;
  addAuthorityEd25519: (
    payload: AddAuthorityPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; newAuthorityPda: PublicKey } | undefined>;
  removeAuthority: (
    payload: RemoveAuthorityPayload,
    options: SignOptions,
  ) => Promise<string | undefined>;
  authorizeAndExecute: (
    payload: AuthorizeExecutePayload,
    options: SignOptions,
  ) => Promise<string | undefined>;
  authorizeDeferred: (
    payload: AuthorizePayload,
    options: SignOptions,
  ) => Promise<AuthorizeResult | undefined>;
  executeDeferred: (
    payload: ExecuteDeferredPayload,
    options?: TxCallbacks,
  ) => Promise<string | undefined>;
  reclaimDeferred: (
    payload: ReclaimDeferredPayload,
    options?: TxCallbacks,
  ) => Promise<string | undefined>;
  listAuthorities: () => Promise<ListAuthoritiesResult>;
  transferSol: (payload: TransferSolPayload, options: SignOptions) => Promise<void>;
}

/**
 * Hook interface
 */
export interface LazorWalletHook {
  // State
  /** User-facing wallet address (vault PDA where funds live). */
  smartWalletPubkey: PublicKey | null;
  /** Alias of `smartWalletPubkey`, kept for clarity. */
  vaultPubkey: PublicKey | null;
  /** Internal wallet PDA (metadata/authority account). Needed for raw SDK calls. */
  walletPdaPubkey: PublicKey | null;
  passkeyPubkey: number[] | null;
  isConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;
  connection: Connection;

  // Core flows
  connect: (options: ConnectOptions) => Promise<WalletInfo>;
  disconnect: (options?: DisconnectOptions) => Promise<void>;
  signAndSendTransaction: (payload: SignAndSendTransactionPayload, options: SignOptions) => Promise<string>;
  signMessage: (message: string, options: SignOptions) => Promise<{ signature: string; signedPayload: string }>;

  // Session
  createSession: (
    payload: CreateSessionPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; sessionPda: PublicKey }>;
  revokeSession: (payload: RevokeSessionPayload, options: SignOptions) => Promise<string>;
  signAndSendWithSession: (
    payload: SessionSignPayload,
    options?: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
  ) => Promise<string>;

  // Authority
  addAuthorityEd25519: (
    payload: AddAuthorityPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; newAuthorityPda: PublicKey }>;
  removeAuthority: (payload: RemoveAuthorityPayload, options: SignOptions) => Promise<string>;
  listAuthorities: () => Promise<ListAuthoritiesResult>;

  // Deferred execution (for large payloads)
  /** Bundled 2-tx flow: one passkey prompt, SDK submits Authorize + ExecuteDeferred back-to-back. */
  authorizeAndExecute: (payload: AuthorizeExecutePayload, options: SignOptions) => Promise<string>;
  /** TX1 only — passkey-signed Authorize. Persist the returned payload to run TX2 later / elsewhere. */
  authorizeDeferred: (payload: AuthorizePayload, options: SignOptions) => Promise<AuthorizeResult>;
  /** TX2 only — submits ExecuteDeferred using a payload from a prior `authorize`. No passkey. */
  executeDeferred: (payload: ExecuteDeferredPayload, options?: TxCallbacks) => Promise<string>;
  /** Close an expired DeferredExec PDA and reclaim its rent. Payer-gated, no passkey. */
  reclaimDeferred: (payload: ReclaimDeferredPayload, options?: TxCallbacks) => Promise<string>;

  // Convenience
  transferSol: (payload: TransferSolPayload, options: SignOptions) => Promise<string>;
}

/**
 * Finalize callback returned by the program-level prepare step. Called with
 * the portal's WebAuthn response to produce the [precompileIx, executeIx] pair.
 */
export type ExecuteFinalize = (response: WebAuthnResponse) => {
  instructions: TransactionInstruction[];
};

/**
 * Wallet Actions interface (low-level, used by the connect flow).
 */
export interface WalletActions {
  saveWallet: (data: WalletInfo) => Promise<WalletInfo>;
  executeWallet: (
    data: WalletInfo,
    feePayer: PublicKey,
    finalize: ExecuteFinalize,
    browserResult: BrowserResult,
    transactionOptions?: TransactionOptions,
  ) => Promise<string>;
}

/**
 * Error classes
 */
export class LazorKitError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'LazorKitError';
  }
}

export class WalletConnectionError extends LazorKitError {
  constructor(message: string) {
    super(message, 'WALLET_CONNECTION_ERROR');
    this.name = 'WalletConnectionError';
  }
}

export class SigningError extends LazorKitError {
  constructor(message: string) {
    super(message, 'SIGNING_ERROR');
    this.name = 'SigningError';
  }
}
