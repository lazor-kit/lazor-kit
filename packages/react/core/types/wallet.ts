import {
    Connection,
    TransactionInstruction,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import { WalletInfo, WalletConfig } from '../storage';

export interface WalletState {
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
    connect: (options?: ConnectOptions & { feeMode?: 'paymaster' | 'user' }) => Promise<WalletInfo>;
    disconnect: () => Promise<void>;
    signAndSendTransaction: (payload: SignAndSendTransactionPayload) => Promise<string>;
    signMessage: (message: string) => Promise<{ signature: string, signedPayload: string }>;

    // Session key actions
    createSession: (payload?: CreateSessionPayload) => Promise<{ sessionPda: string; sessionPublicKey: string }>;
    revokeSession: (payload?: RevokeSessionPayload) => Promise<void>;
    signAndSendWithSession: (payload: SignAndSendTransactionPayload) => Promise<string>;

    // Ed25519 authority actions
    addAuthority: (payload?: AddAuthorityPayload) => Promise<{ authorityPda: string; authorityPublicKey: string }>;
    removeAuthority: (targetAuthorityPda: string) => Promise<void>;
    signAndSendWithAuthority: (payload: SignAndSendTransactionPayload) => Promise<string>;

    // Deferred execution
    authorizeAndExecute: (payload: SignAndSendTransactionPayload) => Promise<string>;
    /** Step 1: passkey signs TX1 and returns a serialized payload for later TX2 submission. */
    authorizeDeferred: (payload: AuthorizeDeferredPayload) => Promise<{ signature: string; deferredPayload: string }>;
    /** Step 2: submit TX2 using a previously-authorized payload. No passkey needed. */
    executeDeferred: (payload: ExecuteDeferredPayload) => Promise<string>;
}

export interface SpendingLimits {
    /** Lifetime SOL cap in lamports — session exhausted once spent */
    solLifetimeCap?: bigint;
    /** Max SOL per single execute in lamports */
    solPerTxMax?: bigint;
    /** SOL cap that resets every `windowSlots` slots */
    solRecurring?: {
        limit: bigint;
        windowSlots: bigint;
    };
}

export interface CreateSessionPayload {
    readonly expiresInSlots?: bigint;
    readonly spendingLimits?: SpendingLimits;
    /**
     * Optional external session key to register as the authority. When
     * omitted the SDK generates a fresh keypair client-side and persists
     * its secretKey to localStorage for later signing. When provided, the
     * SDK registers this pubkey on-chain without touching localStorage —
     * useful for delegating to a backend / agent that already holds the
     * matching private key.
     *
     * Accepts a base58 string or a `PublicKey` instance.
     */
    readonly sessionKey?: import('@solana/web3.js').PublicKey | string;
    readonly onSuccess?: (sessionPda: string, sessionPublicKey: string) => void;
    readonly onFail?: (error: Error) => void;
}

export interface RevokeSessionPayload {
    /**
     * Optional — revoke a *specific* session by its PDA. Accepts base58
     * or PublicKey. When omitted, the SDK revokes the session it previously
     * created via `createSession` (tracked in localStorage).
     *
     * Use this when you registered an external session key (e.g. a backend /
     * agent session) and want to revoke it without touching localStorage.
     */
    readonly sessionPda?: import('@solana/web3.js').PublicKey | string;
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

export interface AddAuthorityPayload {
    readonly role?: number;
    readonly onSuccess?: (authorityPda: string, authorityPublicKey: string) => void;
    readonly onFail?: (error: Error) => void;
}

export interface ConnectOptions {
    readonly onSuccess?: (wallet: WalletInfo) => void;
    readonly onFail?: (error: Error) => void;
}

export interface DisconnectOptions {
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

export interface SignAndSendTransactionPayload {
    readonly transactionOptions?: {
        readonly feeToken?: string;
        readonly addressLookupTableAccounts?: AddressLookupTableAccount[];
        readonly computeUnitLimit?: number;
        readonly clusterSimulation?: 'devnet' | 'mainnet';
        /** Wire format for the transaction. Defaults to 'v0'. */
        readonly txVersion?: 'legacy' | 'v0';
    };
    readonly instructions: TransactionInstruction[];
    readonly onSuccess?: (signature: string) => void;
    readonly onFail?: (error: Error) => void;
}

export interface SignOptions {
    readonly onSuccess?: (signature: string) => void;
    readonly onFail?: (error: Error) => void;
}

export interface SignResponse {
    readonly msg?: string;
    readonly normalized: string;
    readonly clientDataJSONReturn: string;
    readonly authenticatorDataReturn: string;
}

export interface AuthorizeDeferredPayload {
    readonly transactionOptions?: SignAndSendTransactionPayload['transactionOptions'];
    readonly instructions: TransactionInstruction[];
    readonly onSuccess?: (result: { signature: string; deferredPayload: string }) => void;
    readonly onFail?: (error: Error) => void;
}

export interface ExecuteDeferredPayload {
    readonly transactionOptions?: SignAndSendTransactionPayload['transactionOptions'];
    /** Serialized DeferredPayload string (returned by `authorizeDeferred`). */
    readonly deferredPayload: string;
    readonly onSuccess?: (signature: string) => void;
    readonly onFail?: (error: Error) => void;
}
