import React from 'react';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import type { DeferredPayload, OwnershipProof, SessionAction, WebAuthnResponse } from './program';

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
  /**
   * The protocol this wallet lives on: 1 for a wallet made before LazorKit v2,
   * 2 since. Absent on wallets persisted by earlier releases of this package,
   * all of which are v1. Every action routes by it.
   */
  readonly protocolVersion?: 1 | 2;
}

/** A paymaster: the JSON-RPC service that signs as fee payer and sends. */
export interface PaymasterConfig {
  readonly paymasterUrl: string;
  readonly apiKey?: string;
  /**
   * This paymaster signs SIMD-0385 v1 transactions. Default `false`: a
   * `txVersion: 'v1'` request is then sent as v0. Experimental, devnet only.
   * Do not set it for kora.devnet.lazorkit.com, which cannot read v1.
   */
  readonly acceptsTxV1?: boolean;
}

export interface WalletConfig {
  readonly portalUrl: string;
  /** The paymaster for v2 wallets. */
  readonly configPaymaster: PaymasterConfig;
  /**
   * The paymaster for wallets still on LazorKit v1 — the relayer the app used
   * before v2. Defaults to `configPaymaster`. Keep them apart where you can: a
   * relayer that sponsors the full v1 program can have its fee payer pulled
   * into any v1 transaction's inner calls, so the v2 relayer should not.
   */
  readonly v1ConfigPaymaster?: PaymasterConfig;
  readonly rpcUrl?: string;
  /**
   * Which cluster `rpcUrl` serves, when its URL does not say. Without it the
   * cluster is read from the URL (mainnet / devnet / localhost), and anything
   * else is taken as mainnet, as every release before v2 did.
   */
  readonly cluster?: 'mainnet' | 'devnet';
  /** WebAuthn Relying Party ID, e.g. "portal.lazor.sh". Defaults to portal host. */
  readonly rpId?: string;
  /**
   * What `connect` does when the passkey's wallet cannot be adopted on its
   * own and the user has to say which wallet is theirs. Default `'builtin'`.
   * See {@link OnConfirmWallet}.
   */
  readonly onConfirmWallet?: OnConfirmWallet;
  /**
   * Base58 Ed25519 keys of your own (a backend admin key, session keys your
   * app issues). An authority, session or token approval held by one of them
   * does not stop `connect` from adopting a wallet. Passkeys and pending
   * transactions cannot be trusted this way.
   */
  readonly trustedAuthorities?: readonly string[];
  /**
   * Base58 SPL Token mints your app receives. The vault's token account for
   * each is checked for having been handed to someone else, on top of wSOL,
   * USDC, USDT and devnet USDC.
   */
  readonly watchMints?: readonly string[];
}

/**
 * A wallet the passkey is proven to hold a key of, that `connect` will not
 * adopt without the user: someone else can also spend from it, or the passkey
 * has never signed for it, or it is one of several. Show the vault address;
 * it is the one users recognise. The order is not a recommendation.
 */
export interface WalletChoice {
  /** Wallet PDA. */
  wallet: string;
  /** Vault PDA — where the funds are, and the address to show. */
  vault: string;
  version: 1 | 2;
  /** Vault balance, lamports. */
  lamports: number;
  /** Times this passkey has signed for the wallet; 0 = not used with it yet. */
  signatureCount: number;
  /**
   * `false`: the vault was handed to another program, and the passkey no
   * longer controls what leaves it — nor what is sent to it later.
   */
  vaultIsSystemAccount: boolean;
  /** Every authority on the wallet except this passkey's. */
  otherAuthorities: {
    /** The authority account. */
    address: string;
    type: 'passkey' | 'key';
    role: 'owner' | 'admin' | 'spender' | 'unknown';
    /** `type: 'key'` only: the Ed25519 key. */
    key?: string;
    /** `type: 'passkey'` only: created under the same relying party as this passkey. */
    sameRelyingParty?: boolean;
    /** Listed in `trustedAuthorities`. A passkey never is. */
    trusted: boolean;
  }[];
  /** Sessions that can still sign. */
  liveSessions: {
    address: string;
    /** `null` when the session account is too short to read. */
    sessionKey: string | null;
    /**
     * About when it stops signing, ms since the epoch (slots × 400 ms). `null`
     * when the account is too short to read.
     */
    approxExpiresAt: number | null;
    trusted: boolean;
  }[];
  /** Transactions authorized and not yet run or expired. Never trusted. */
  pendingDeferred: {
    address: string;
    approxExpiresAt: number | null;
  }[];
  /** Rights over the vault's token accounts held by someone else. */
  tokenGrants: {
    tokenAccount: string;
    tokenProgram: string;
    /** `null` when the account is too short to read. */
    mint: string | null;
    kind: 'delegate' | 'closeAuthority' | 'owner' | 'unreadable';
    /** Who holds the right; `null` when the account is too short to read. */
    grantee: string | null;
    /** `grantee` is listed in `trustedAuthorities`. */
    trusted: boolean;
  }[];
}

/** What a wallet chooser gets: the passkey, and the wallets to choose from. */
export interface ConfirmWalletRequest {
  credentialId: string;
  candidates: WalletChoice[];
}

/**
 * Your own wallet chooser. Resolve with the chosen candidate's `wallet` (or
 * `vault`), or `null` when the user recognises none of them. Never choose for
 * the user.
 */
export type ConfirmWalletHandler = (
  request: ConfirmWalletRequest,
) => Promise<{ wallet: string } | null> | { wallet: string } | null;

/**
 * `'builtin'`: `LazorKitProvider` shows its own chooser.
 * `'throw'`: `connect` throws {@link WalletNeedsConfirmationError}; call
 * `connect({ redirectUrl, confirmWallet })` with the user's pick within two
 * minutes and it is adopted without opening the portal again.
 * A function: your own chooser ({@link ConfirmWalletHandler}).
 */
export type OnConfirmWallet = ConfirmWalletHandler | 'builtin' | 'throw';

/** The built-in chooser's open request, as the store holds it while it is shown. */
export interface PendingWalletConfirmation {
  readonly request: ConfirmWalletRequest;
  /** The user's answer: a candidate's `wallet`, or `null` for none of these. */
  readonly resolve: (choice: { wallet: string } | null) => void;
  /** The chooser could not be shown: `connect` rejects with `error`. */
  readonly reject: (error: Error) => void;
}

/**
 * Provider configuration types
 */
export interface LazorKitProviderProps {
  readonly rpcUrl?: string;
  readonly portalUrl?: string;
  readonly configPaymaster?: PaymasterConfig;
  /** The paymaster for users whose wallet is still on LazorKit v1. Defaults to `configPaymaster`. */
  readonly v1ConfigPaymaster?: PaymasterConfig;
  /** Which cluster `rpcUrl` serves, if its URL does not say. See WalletConfig. */
  readonly cluster?: 'mainnet' | 'devnet';
  readonly rpId?: string;
  /** Default `'builtin'`. See WalletConfig. */
  readonly onConfirmWallet?: OnConfirmWallet;
  /** Your own Ed25519 keys, base58. See WalletConfig. */
  readonly trustedAuthorities?: readonly string[];
  /** SPL Token mints your app receives, base58. See WalletConfig. */
  readonly watchMints?: readonly string[];
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
  /**
   * The credential (base64) the portal says it signed with, when it says. The
   * portal signs with the `credentialId` the sign URL names (as the only
   * `allowCredentials` entry) and names it back in the redirect.
   */
  readonly credentialId?: string;
}

/**
 * Operation options
 */
export interface ConnectOptions {
  readonly redirectUrl: string;
  /**
   * The wallet the user chose — its vault or wallet PDA, from
   * `WalletNeedsConfirmationError.candidates`. Within two minutes of that
   * error it is adopted without opening the portal again. It must be one of
   * the passkey's proven wallets: an address that is not throws.
   */
  readonly confirmWallet?: string;
  /** Overrides the provider's `onConfirmWallet` for this call. */
  readonly onConfirmWallet?: OnConfirmWallet;
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
  /**
   * The compute-unit limit. A v0 transaction gets a SetComputeUnitLimit
   * instruction; a v1 transaction carries it in its config instead
   * (1 to 1,400,000; default: measured).
   */
  readonly computeUnitLimit?: number;
  readonly clusterSimulation?: 'devnet' | 'mainnet';
  /**
   * The transaction format. Default `'v0'`, as before. `'v1'` is SIMD-0385
   * (up to 4096 bytes and 64 addresses, no lookup tables), experimental and
   * devnet-only. It is used when the paymaster declares `acceptsTxV1`, no
   * `feeToken` is set, and the wallet is on the devnet LazorKit v2 program.
   * Otherwise the transaction is sent as v0, with the bytes a `'v0'` request
   * sends, and the reason is logged (the README lists what a 'v1' request
   * still checks and reads before the portal opens; the v1 limits are not
   * checked then). A 'v1' request that cannot be sent in the format chosen
   * throws `TransactionTooLargeError` (or `PayloadExceedsProgramLimitsError`)
   * before anything is sent, and before the portal opens when that is already
   * known. Honoured by signAndSendTransaction, transferSol,
   * signAndSendWithSession, authorizeAndExecute, authorizeDeferred and
   * executeDeferred.
   */
  readonly txVersion?: 'v0' | 'v1';
  /**
   * v1 only (ignored when a 'v1' request goes out as v0): the loaded-accounts
   * data size limit, in bytes, 196,608 to 67,108,864. Default: measured. In a
   * deferred pair it applies to TX2, as `computeUnitLimit` does.
   */
  readonly loadedAccountsDataSizeLimit?: number;
}

/** Payload for single-tx `signAndSendTransaction` (and the 2-tx deferred flow). */
export interface SignAndSendTransactionPayload {
  readonly instructions: TransactionInstruction[];
  readonly transactionOptions?: TransactionOptions;
}

/** Payload for `authorizeAndExecute` (2-tx deferred, bundled). */
export interface AuthorizeExecutePayload extends SignAndSendTransactionPayload {
  /**
   * How many slots after TX1 (Authorize) the program still accepts TX2
   * (ExecuteDeferred): 10 to 9000. Defaults to `DEFAULTS.DEFERRED_EXPIRY_SLOTS`
   * (1500). A slot's length varies by cluster and load, so leave room: past
   * the window TX2 fails with `DeferredExpiredError`, and the user has to
   * approve again.
   */
  readonly expiryOffset?: number;
}

/** Payload for `authorize` (standalone TX1 — returns payload so TX2 can happen elsewhere). */
export interface AuthorizePayload {
  readonly instructions: TransactionInstruction[];
  /**
   * How many slots after TX1 the program still accepts `executeDeferred`: 10
   * to 9000, default `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500). Counted from
   * TX1's slot, not from when this call resolves.
   */
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
  /**
   * Create a session with no spending limits, which can spend the whole vault
   * through any program until it expires. Required to be explicit: an
   * actionless session is the most powerful thing this SDK can mint, and the
   * key lives in the app rather than behind the user's passkey.
   */
  readonly unrestricted?: boolean;
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
  /**
   * Spending policy, required when the role is ROLE_SPENDER (Delegate).
   * Build it with `serializeActions([...])`. Protocol v2 rejects a Delegate
   * without one (3033) and a policy on any other rank (3035). v1 wallets have
   * no policies: passing one for a v1 wallet throws.
   */
  readonly policy?: Uint8Array;
  /**
   * Required to add a key to a v1 wallet, where any added key can spend the
   * whole vault (v1 never checked rank at Execute). Ignored for v2.
   */
  readonly unrestricted?: boolean;
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
  /**
   * The built-in wallet chooser's open request, while `connect` waits for the
   * user (`onConfirmWallet: 'builtin'`). `LazorKitProvider` draws it. Not
   * persisted.
   */
  pendingWalletConfirmation: PendingWalletConfirmation | null;

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
  signAndExecuteTransaction: (payload: SignAndSendTransactionPayload, options: SignOptions) => Promise<string>;
  signMessage: (message: string, options: SignOptions) => Promise<{ signature: string; signedPayload: string }>;
  createSession: (
    payload: CreateSessionPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; sessionPda: PublicKey }>;
  revokeSession: (
    payload: RevokeSessionPayload,
    options: SignOptions,
  ) => Promise<string>;
  signAndSendWithSession: (
    payload: SessionSignPayload,
    options: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
  ) => Promise<string>;
  addAuthorityEd25519: (
    payload: AddAuthorityPayload,
    options: SignOptions,
  ) => Promise<{ signature: string; newAuthorityPda: PublicKey }>;
  removeAuthority: (
    payload: RemoveAuthorityPayload,
    options: SignOptions,
  ) => Promise<string>;
  authorizeAndExecute: (
    payload: AuthorizeExecutePayload,
    options: SignOptions,
  ) => Promise<string>;
  authorizeDeferred: (
    payload: AuthorizePayload,
    options: SignOptions,
  ) => Promise<AuthorizeResult>;
  executeDeferred: (
    payload: ExecuteDeferredPayload,
    options?: TxCallbacks,
  ) => Promise<string>;
  reclaimDeferred: (
    payload: ReclaimDeferredPayload,
    options?: TxCallbacks,
  ) => Promise<string>;
  listAuthorities: () => Promise<ListAuthoritiesResult>;
  transferSol: (payload: TransferSolPayload, options: SignOptions) => Promise<string>;
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
  /**
   * The protocol the connected wallet lives on: 1 for a wallet made before
   * LazorKit v2, 2 since. `null` when disconnected. Every action already routes
   * by it; read it to offer a v1 user the move to v2.
   */
  protocolVersion: 1 | 2 | null;
  isConnected: boolean;
  /**
   * The SDK is working. `false` while the wallet chooser (or your
   * `onConfirmWallet` function) waits for the user, so a loading overlay does
   * not cover it; `isConnecting` stays `true` for the whole connect.
   */
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

/** How `saveWallet` settles which wallet is the passkey's own. */
export interface SaveWalletOptions {
  /** Lets it ask the passkey, through the portal, to prove which wallet is its own. */
  readonly redirectUrl?: string;
  /**
   * An assertion that came with the connect reply, over the challenge the
   * connect URL carried. Used instead of asking the portal again when it
   * verifies against a candidate's key or the reported one (and counts only
   * for the keys it verifies against); otherwise the portal is asked once.
   */
  readonly proof?: OwnershipProof;
  /** See ConnectOptions. */
  readonly confirmWallet?: string;
  /** Default: the config's, else `'builtin'`. */
  readonly onConfirmWallet?: OnConfirmWallet;
  /** Draws the built-in chooser. Without it, `'builtin'` throws. */
  readonly openChooser?: (request: ConfirmWalletRequest) => Promise<{ wallet: string } | null>;
  /**
   * Aborted by `disconnect`: from then on nothing is remembered, asked,
   * created or returned, and the call rejects with `PortalCancelledError`.
   */
  readonly signal?: AbortSignal;
}

/**
 * Wallet Actions interface (low-level, used by the connect flow).
 */
export interface WalletActions {
  saveWallet: (data: WalletInfo, options?: SaveWalletOptions) => Promise<WalletInfo>;
  /**
   * The remembered candidate at `confirmWallet`, as a wallet to save, when
   * `connect` threw `WalletNeedsConfirmationError` for it less than two
   * minutes ago; else `null`.
   */
  adoptRemembered: (confirmWallet: string) => WalletInfo | null;
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

/**
 * The user closed the portal — dismissed the browser, or went back to the
 * app — before it answered. Nothing was signed.
 */
export class PortalCancelledError extends LazorKitError {
  constructor(message = 'The LazorKit portal was closed before it answered; nothing was signed.') {
    super(message, 'PORTAL_CANCELLED');
    this.name = 'PortalCancelledError';
  }
}

/**
 * The built-in wallet chooser was not on screen within a few seconds of
 * `connect` asking for it (iOS). iOS shows one modal at a time from a given
 * screen: while the app has a `<Modal>` or a modal screen open, the chooser
 * that `LazorKitProvider` draws cannot appear over it. Close it before
 * connecting, mount `<WalletChooser />` inside it, or pass `onConfirmWallet`.
 */
export class WalletChooserNotShownError extends LazorKitError {
  constructor() {
    super(
      'The wallet chooser could not be shown, so no wallet was connected. On iOS it cannot appear ' +
        'over another modal (a <Modal> or a modal screen) that is open: close that before connecting, ' +
        'render <WalletChooser /> inside it, or pass onConfirmWallet.',
      'WALLET_CHOOSER_NOT_SHOWN',
    );
    this.name = 'WalletChooserNotShownError';
  }
}

/**
 * The passkey's wallet cannot be adopted without the user (`onConfirmWallet:
 * 'throw'`). Show `candidates` — the vault address, balance, and who else can
 * spend from each — and let the user pick one they recognise; then call
 * `connect({ redirectUrl, confirmWallet: choice.vault })`. Within two minutes
 * that adopts it without opening the portal again. Never pick for the user.
 */
export class WalletNeedsConfirmationError extends Error {
  constructor(
    readonly credentialId: string,
    readonly candidates: WalletChoice[],
  ) {
    super(
      "This passkey's wallet needs the user to confirm it: anyone can add a passkey to a wallet " +
        'of their own, so only a wallet the user recognises should be used. Show the candidates ' +
        'and call connect with confirmWallet set to the chosen vault.',
    );
    this.name = 'WalletNeedsConfirmationError';
  }
}

/** The user recognised none of the wallets offered. Nothing was saved. */
export class WalletConfirmationDeclinedError extends Error {
  constructor() {
    super('No wallet was chosen, so none was connected.');
    this.name = 'WalletConfirmationDeclinedError';
  }
}
