import {
    Connection,
    TransactionInstruction,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import { WalletInfo, WalletConfig } from '../storage';
import type { OnConfirmWallet } from '../wallet/confirmation';

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
    authorizeAndExecute: (payload: AuthorizeAndExecutePayload) => Promise<string>;
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
     * Create a session with no spending limits, which can spend the whole
     * vault through any program until it expires. Required to be explicit:
     * an actionless session is the most powerful thing this SDK can mint,
     * and the key lives in the app rather than behind the user's passkey.
     */
    readonly unrestricted?: boolean;
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
    /**
     * Spending policy, required when the role is ROLE_SPENDER (Delegate) on a
     * v2 wallet. Build it with `serializeActions([...])`. v2 rejects a Delegate
     * without one (3033) and a policy on any other rank (3035). v1 wallets have
     * no policies: passing one for a v1 wallet throws.
     */
    readonly policy?: Uint8Array;
    /**
     * Required to add a key to a v1 wallet, where any added key can spend the
     * whole vault (v1 never checked rank at Execute). Ignored for v2.
     */
    readonly unrestricted?: boolean;
    readonly onSuccess?: (authorityPda: string, authorityPublicKey: string) => void;
    readonly onFail?: (error: Error) => void;
}

export interface ConnectOptions {
    /**
     * The wallet the user recognised — its vault address (or wallet PDA) —
     * among those a connect offered for confirmation. Only used when no wallet
     * is stored yet. Within 2 minutes of a connect that threw
     * `WalletNeedsConfirmationError`, it is adopted without a second passkey
     * prompt; otherwise the portal is opened and it must name a wallet the
     * passkey is proven to hold. A `confirmWallet` that names none of them
     * throws — it is never ignored.
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

export interface SignAndSendTransactionPayload {
    readonly transactionOptions?: {
        readonly feeToken?: string;
        readonly addressLookupTableAccounts?: AddressLookupTableAccount[];
        /**
         * Ignored by legacy and v0 sends, and by a 'v1' request that goes out
         * as v0. As v1: the compute-unit limit written into the transaction,
         * 1 to 1,400,000. Default: measured by a simulation.
         */
        readonly computeUnitLimit?: number;
        readonly clusterSimulation?: 'devnet' | 'mainnet';
        /**
         * Wire format for the transaction. Defaults to 'v0'.
         *
         * 'v1' (SIMD-0385, up to 4096 bytes and 64 addresses) is experimental
         * and devnet only. It is used when the paymaster declares
         * `acceptsTxV1` and the wallet is on the devnet LazorKit v2 program;
         * otherwise the transaction goes out as v0, with the bytes a 'v0'
         * request sends (the README lists what a 'v1' request still checks
         * and reads before the prompt). A v1 transaction has no lookup
         * tables: `addressLookupTableAccounts` serve only the v0 fallback and
         * its preview. A transaction that does not fit the format it goes out
         * in throws `TransactionTooLargeError`, before the prompt when that
         * is already known; nothing is sent.
         */
        readonly txVersion?: 'legacy' | 'v0' | 'v1';
        /**
         * `txVersion: 'v1'` only, when it goes out as v1: the loaded-accounts
         * data size limit, in bytes, 196,608 to 67,108,864. Default: measured
         * by a simulation.
         */
        readonly loadedAccountsDataSizeLimit?: number;
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

export interface AuthorizeAndExecutePayload extends SignAndSendTransactionPayload {
    /**
     * How many slots after TX1 (Authorize) the program still accepts TX2
     * (ExecuteDeferred): 10 to 9000. Defaults to `DEFAULTS.DEFERRED_EXPIRY_SLOTS`
     * (1500). A slot's length varies by cluster and load, so leave room: past
     * the window TX2 fails with `DeferredExpiredError`, and the user has to
     * approve again.
     */
    readonly expiryOffset?: number;
}

export interface AuthorizeDeferredPayload {
    readonly transactionOptions?: SignAndSendTransactionPayload['transactionOptions'];
    readonly instructions: TransactionInstruction[];
    /**
     * How many slots after TX1 the program still accepts `executeDeferred`: 10
     * to 9000, default `DEFAULTS.DEFERRED_EXPIRY_SLOTS` (1500). Counted from
     * TX1's slot, not from when this call resolves.
     */
    readonly expiryOffset?: number;
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
