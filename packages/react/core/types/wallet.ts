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

    // Actions. A call's `onSuccess` / `onFail` runs once the action is over
    // (`isSigning` / `isConnecting` already false), right before its promise
    // settles the same way; what a callback throws is logged and changes
    // nothing. A call refused because another is running ('Already signing',
    // 'Already connecting') calls `onFail` at once, while the flag is still
    // `true`: it belongs to the call that is running.
    connect: (options?: ConnectOptions & { feeMode?: 'paymaster' | 'user' }) => Promise<WalletInfo>;
    disconnect: (options?: DisconnectOptions) => Promise<void>;
    signAndSendTransaction: (payload: SignAndSendTransactionPayload) => Promise<string>;
    signMessage: (message: string, options?: SignMessageOptions) => Promise<{ signature: string, signedPayload: string }>;

    // Session key actions
    createSession: (payload?: CreateSessionPayload) => Promise<{ sessionPda: string; sessionPublicKey: string }>;
    revokeSession: (payload?: RevokeSessionPayload) => Promise<void>;
    signAndSendWithSession: (payload: SignAndSendTransactionPayload) => Promise<string>;

    // Ed25519 authority actions
    /** `payload.role` is required: see `AddAuthorityPayload.role`. */
    addAuthority: (payload: AddAuthorityPayload) => Promise<{ authorityPda: string; authorityPublicKey: string }>;
    removeAuthority: (targetAuthorityPda: string, options?: RemoveAuthorityOptions) => Promise<void>;
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
     * omitted the SDK generates a fresh key client-side and keeps it for
     * `signAndSendWithSession`: a non-extractable WebCrypto key in IndexedDB
     * (see `keyStorage` on the provider), not in localStorage. When provided, the
     * SDK registers this pubkey on-chain and stores nothing — useful for
     * delegating to a backend / agent that already holds the matching
     * private key.
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
     * or PublicKey. When omitted, the SDK revokes the session whose key it
     * keeps (the last `createSession` without `sessionKey`), which must be
     * the connected wallet's: `KeyWalletMismatchError` otherwise, before the
     * passkey prompt. A kept key whose session has expired is deleted then,
     * and the call rejects.
     *
     * Use this when you registered an external session key (e.g. a backend /
     * agent session). The key the SDK keeps is deleted once the session it
     * belongs to is revoked, and left alone when another session is.
     */
    readonly sessionPda?: import('@solana/web3.js').PublicKey | string;
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

export interface AddAuthorityPayload {
    /**
     * Required: the rank the new key gets on the wallet. There is no default;
     * a missing or unknown role throws before the passkey prompt.
     * - `ROLE_OWNER` (0): adds and removes any authority, other owners
     *   included (never the last owner), and spends without limit. On a v2
     *   wallet the protocol SDK adds an owner only with `allowOwner`, which
     *   this method does not pass, so it refuses `ROLE_OWNER` before the
     *   prompt.
     * - `ROLE_ADMIN` (1): adds and removes delegates only, and spends without
     *   limit: no policy, no expiry, until `removeAuthority`.
     * - `ROLE_SPENDER` (2), the delegate rank: manages no authority, and
     *   spends only within its `policy`, which v2 requires for it.
     *
     * For a key your app holds, use `ROLE_SPENDER` with a `policy`. The SDK
     * keeps the key for `signAndSendWithAuthority` (see `keyStorage`), bound to
     * this wallet.
     */
    readonly role: number;
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
    /**
     * Called with the connected wallet once `isConnecting` is false again,
     * right before the promise resolves. What it throws is logged and does
     * not fail the connect.
     */
    readonly onSuccess?: (wallet: WalletInfo) => void;
    /**
     * Called with the error the promise rejects with, once `isConnecting` is
     * false again. A refusal because another connect is running ('Already
     * connecting') calls it at once, while `isConnecting` is still `true`: the
     * flag belongs to that connect.
     */
    readonly onFail?: (error: Error) => void;
}

/**
 * What an action reports its outcome to: `onSuccess` with what its promise
 * resolves with, `onFail` with the error it rejects with, refusals included.
 * Either runs once the action is over, with `isSigning` / `isConnecting`
 * already false, right before the promise settles. The one exception is a
 * refusal because another call is running ('Already signing', 'Already
 * connecting'): its `onFail` runs at once, and the flag stays `true`, since it
 * belongs to the call that is running. What a callback throws is logged and
 * changes nothing.
 */
export interface ActionCallbacks<T> {
    readonly onSuccess?: (result: T) => void;
    readonly onFail?: (error: Error) => void;
}

/** As with every action: called once the call is over, right before its promise settles; what they throw changes nothing. */
export interface DisconnectOptions {
    /**
     * Keep the session key the SDK keeps (`createSession`). By default
     * `disconnect` deletes it. A kept one signs only once its wallet is
     * connected again. The authority key (`addAuthority`) is always kept, on
     * the same terms; `removeAuthority` or `forgetStoredKeys()` deletes it.
     */
    readonly keepSessionKeys?: boolean;
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

/** As with every action: called once the call is over (`isSigning` false), right before its promise settles. */
export interface RemoveAuthorityOptions {
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

/** `signMessage`'s callbacks, as every action's: called once the call is over (`isSigning` false), right before its promise settles. */
export type SignMessageOptions = ActionCallbacks<{ signature: string; signedPayload: string }>;

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
         * otherwise the transaction goes out as v0, with the requests a 'v0'
         * request makes (the README lists what a 'v1' request still checks
         * before the prompt). A v1 transaction has no lookup tables:
         * `addressLookupTableAccounts` serve only the v0 fallback and its
         * preview. A transaction that does not fit the format it goes out in
         * throws `TransactionTooLargeError`, before the prompt when that is
         * already known; nothing is sent.
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
