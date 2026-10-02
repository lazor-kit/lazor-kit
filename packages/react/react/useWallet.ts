/**
 * Wallet Hook - Provides clean interface to wallet functionality
 * Business logic is handled by store actions
 */

import { useCallback } from 'react';
import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction, AddressLookupTableAccount } from '@solana/web3.js';
import { useWalletStore } from './store';
import { WalletInfo } from '../core/storage';
import type { ActionCallbacks, DisconnectOptions, RemoveAuthorityOptions, SignAndSendPayload, SignMessageOptions, SpendingLimits } from '../core/types';
import type { OnConfirmWallet } from '../core/wallet/confirmation';
import type { SignMessageResult } from '../core/message/signedMessage';
import type { WalletStatus } from '../core/embedded/types';
import { deriveStatus } from '../core/client/createClient';

/**
 * The Easy API: what most apps need. `status` replaces the three 3.x flags;
 * `address` is the vault (base58), the address to show and fund.
 */
export interface EasyWallet {
  status: WalletStatus;
  /** The vault, base58: where the user's funds live. `null` when disconnected. */
  address: string | null;
  wallet: WalletInfo | null;
  /**
   * Connect: the stored wallet, or "Continue with passkey" (Embedded) / the
   * portal (portal mode). Rejects with `UserRejectedError` when the user
   * says no ("Not now", "None of these", a closed sheet), which does not
   * set `error`.
   */
  connect: (options?: ConnectHookOptions) => Promise<WalletInfo>;
  disconnect: (options?: DisconnectOptions) => Promise<void>;
  /**
   * Sign with the passkey and send; resolves with the signature once the
   * transaction is confirmed. `onSubmitted` gets the signature as soon as it
   * is sent. Embedded mode shows the review sheet first (`confirm`).
   */
  signAndSend: (payload: SignAndSendHookPayload) => Promise<string>;
  /**
   * The passkey signs `signedMessageChallenge(message)`, not the message's
   * bytes. Check the result with `verifyWalletMessage`, which reads the
   * passkey's key from chain.
   */
  signMessage: (message: string, options?: SignMessageOptions) => Promise<SignMessageResult>;
  /** The last failure. Never a user rejection. */
  error: Error | null;
}

/** `signAndSend`'s payload on the hook: a send, its callbacks, `onSubmitted` and `confirm`. */
export type SignAndSendHookPayload = SendTxPayload &
  ActionCallbacks<string> &
  Pick<SignAndSendPayload, 'onSubmitted' | 'confirm'>;

export interface WalletHookInterface extends EasyWallet {
  // State
  /** The wallet PDA — an internal account. Do not send funds here. */
  smartWalletPubkey: PublicKey | null;
  /** The vault: the address the user's funds live at, and the one to show. */
  vaultPubkey: PublicKey | null;
  isConnected: boolean;
  /** @deprecated Use `status`. Removed in 5.0. */
  isLoading: boolean;
  /** @deprecated Use `status === 'connecting'`. Removed in 5.0. */
  isConnecting: boolean;
  /** @deprecated Use `status === 'signing'`. Removed in 5.0. */
  isSigning: boolean;
  error: Error | null;
  wallet: WalletInfo | null;
  /**
   * The protocol the connected wallet lives on: 1 for a wallet made before
   * LazorKit v2, 2 since. `null` when disconnected. Every action already routes
   * by it; read it to offer a v1 user the move to v2.
   */
  protocolVersion: 1 | 2 | null;

  // Actions. Every action's `onSuccess` / `onFail` runs once the action is
  // over (`isSigning` / `isConnecting` already false), right before its
  // promise settles the same way, refusals included. A refusal because
  // another call is running ('Already signing', 'Already connecting') calls
  // `onFail` at once, while that call still holds the flag. A send started
  // from `onSuccess` runs. What a callback throws is logged and changes
  // nothing: a transaction that landed is never reported as failed.
  /**
   * Connect the stored wallet, or find the passkey's own. `confirmWallet`: the
   * vault (or wallet) address the user recognised after a
   * `WalletNeedsConfirmationError`. `onConfirmWallet` overrides the
   * provider's for this call.
   */
  connect: (options?: ConnectHookOptions) => Promise<WalletInfo>;
  disconnect: (options?: DisconnectOptions) => Promise<void>;
  /** The same as `signAndSend` (the 3.x name; not deprecated). */
  signAndSendTransaction: (payload: SignAndSendHookPayload) => Promise<string>;
  /**
   * @deprecated Checks only that `signature` is over `signedPayload`, not which
   * message was signed: any assertion the passkey ever made passes. Never
   * use it to authenticate. Use
   * `verifyWalletMessage({ connection, wallet, credentialId, rpId, message, ...result })`,
   * or `verifySignedMessage({ message, publicKey, ...result })` with a key read
   * from the chain.
   */
  verifyMessage: (args: { signedPayload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array }) => Promise<boolean>;

  // Session key actions. The session, authority and deferred actions move to
  // the Advanced hooks a later 4.x adds to `@lazorkit/wallet/hooks`, with
  // the same names and parameters; they stay here until 5.0.
  /** @deprecated Moves to `useSessions()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  createSession: (payload?: {
    expiresInSlots?: bigint;
    spendingLimits?: SpendingLimits;
    /**
     * Optional pubkey to register as the session authority. When set, the
     * SDK generates and stores no key — the caller owns the matching secret
     * key (typical for backend / agent delegation). When omitted, the SDK
     * generates one and keeps it as a non-extractable WebCrypto key in
     * IndexedDB (see the provider's `keyStorage`). Accepts base58 string or
     * `PublicKey`.
     */
    sessionKey?: PublicKey | string;
    /**
     * Mint a session with no spending limits — it can spend the whole vault
     * through any program until it expires. Required when `spendingLimits` is
     * omitted; without either, `createSession` throws.
     */
    unrestricted?: boolean;
    onSuccess?: (sessionPda: string, sessionPublicKey: string) => void;
    onFail?: (error: Error) => void;
  }) => Promise<{ sessionPda: string; sessionPublicKey: string }>;
  /**
   * Revokes `sessionPda`, or without it the session whose key the SDK keeps,
   * which must be the connected wallet's (`KeyWalletMismatchError` otherwise,
   * before the passkey prompt).
   */
  /** @deprecated Moves to `useSessions()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  revokeSession: (payload?: { sessionPda?: PublicKey | string; onSuccess?: () => void; onFail?: (error: Error) => void }) => Promise<void>;
  /**
   * Signs with the session key the SDK keeps, no passkey prompt. Only while
   * the wallet the session belongs to is connected: otherwise it rejects with
   * `KeyWalletMismatchError`, and nothing is signed or sent. A key whose
   * session has expired is deleted, and the call rejects.
   */
  /** @deprecated Moves to `useSessions()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  signAndSendWithSession: (payload: SendTxPayload & ActionCallbacks<string>) => Promise<string>;

  // Ed25519 authority actions
  /**
   * Adds a new Ed25519 key the SDK generates and keeps, with one passkey
   * approval. `role` is required (no default): `ROLE_OWNER` (0) manages every
   * authority, `ROLE_ADMIN` (1) manages delegates only, both spend without
   * limit; `ROLE_SPENDER` (2), the delegate rank, manages nothing and spends
   * within its `policy` (required on v2). For an app key use `ROLE_SPENDER`
   * with a policy. A missing or unknown role throws before the prompt.
   */
  /** @deprecated Moves to `useAuthorities()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  addAuthority: (payload: {
    role: number;
    policy?: Uint8Array;
    unrestricted?: boolean;
    onSuccess?: (authorityPda: string, authorityPublicKey: string) => void;
    onFail?: (error: Error) => void;
  }) => Promise<{ authorityPda: string; authorityPublicKey: string }>;
  /** @deprecated Moves to `useAuthorities()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  removeAuthority: (targetAuthorityPda: string, options?: RemoveAuthorityOptions) => Promise<void>;
  /**
   * Signs with the authority key the SDK keeps, no passkey prompt. Only while
   * the wallet the authority was added to is connected: otherwise it rejects
   * with `KeyWalletMismatchError`, and nothing is signed or sent.
   */
  /** @deprecated Moves to `useAuthorities()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  signAndSendWithAuthority: (payload: SendTxPayload & ActionCallbacks<string>) => Promise<string>;

  // Deferred execution
  /** @deprecated Moves to `useDeferred()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  authorizeAndExecute: (payload: DeferredTxPayload & ActionCallbacks<string>) => Promise<string>;
  /** TX1 only: the passkey signs, and the serialized deferredPayload for TX2 comes back. */
  /** @deprecated Moves to `useDeferred()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  authorizeDeferred: (
    payload: DeferredTxPayload & ActionCallbacks<{ signature: string; deferredPayload: string }>,
  ) => Promise<{ signature: string; deferredPayload: string }>;
  /** TX2 only: sent from a serialized deferredPayload. No passkey needed. */
  /** @deprecated Moves to `useDeferred()` in `@lazorkit/wallet/hooks` in a later 4.x, with the same parameters. */
  executeDeferred: (payload: ExecuteDeferredHookPayload & ActionCallbacks<string>) => Promise<string>;
}

export interface ConnectHookOptions {
  feeMode?: 'paymaster' | 'user';
  confirmWallet?: string;
  onConfirmWallet?: OnConfirmWallet;
  onSuccess?: (wallet: WalletInfo) => void;
  onFail?: (error: Error) => void;
}

/** Shared payload for every send-tx action on the hook. */
export interface SendTxPayload {
  instructions: TransactionInstruction[];
  transactionOptions?: {
    feeToken?: string;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
    computeUnitLimit?: number;
    clusterSimulation?: 'devnet' | 'mainnet';
    /** Wire format for the transaction. Defaults to 'v0'. */
    txVersion?: 'legacy' | 'v0';
  };
}

/**
 * `authorizeAndExecute` / `authorizeDeferred`: a send, and how many slots after
 * TX1 the program still accepts TX2 (10 to 9000; default
 * `DEFAULTS.DEFERRED_EXPIRY_SLOTS`, 1500). Past it, TX2 fails with
 * `DeferredExpiredError`.
 */
export interface DeferredTxPayload extends SendTxPayload {
  expiryOffset?: number;
}

export interface ExecuteDeferredHookPayload {
  deferredPayload: string;
  transactionOptions?: SendTxPayload['transactionOptions'];
}

import { verifySignatureBrowser } from '../utils/verify';

/**
 * Hook for interacting with the Lazorkit wallet
 * Simplified interface for wallet functionality
 */
const warned = new Set<string>();
/** A deprecated flag, read: warns once per page. */
function deprecated<T>(name: string, use: string, value: T): T {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[LazorKit] useWallet().${name} is deprecated: use ${use}. It is removed in 5.0.`);
  }
  return value;
}

export const useWallet = (): WalletHookInterface => {
  const {
    wallet,
    isLoading,
    isConnecting,
    isSigning,
    error,
    connect,
    disconnect,
    signAndSendTransaction,
    signMessage,
    createSession,
    revokeSession,
    signAndSendWithSession,
    addAuthority,
    removeAuthority,
    signAndSendWithAuthority,
    authorizeAndExecute,
    authorizeDeferred,
    executeDeferred,
  } = useWalletStore();

  const handleConnect = useCallback(
    (options?: ConnectHookOptions) => connect(options),
    [connect]
  );

  const handleDisconnect = useCallback(
    (options?: DisconnectOptions) => disconnect(options),
    [disconnect]
  );

  const handleSignAndSendTransaction = useCallback(
    (payload: SignAndSendHookPayload) => signAndSendTransaction(payload),
    [signAndSendTransaction]
  );

  const handleSignMessage = useCallback(
    (message: string, options?: SignMessageOptions) => signMessage(message, options),
    [signMessage]
  );

  /**
   * Verify message helper
   */
  const handleVerifyMessage = useCallback(
    async ({ signedPayload, signature, publicKey }: { signedPayload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array }): Promise<boolean> => {
      // Convert Uint8Arrays to base64 strings for the helper
      const signedPayloadB64 = Buffer.from(signedPayload).toString('base64');
      const signatureB64 = Buffer.from(signature).toString('base64');
      const publicKeyB64 = Buffer.from(publicKey).toString('base64');

      return await verifySignatureBrowser({
        signedPayload: signedPayloadB64,
        signature: signatureB64,
        publicKey: publicKeyB64
      });
    },
    []
  );


  // Get the smart wallet public key from the wallet if available
  const smartWalletPubkey = wallet?.smartWallet
    ? new PublicKey(wallet.smartWallet)
    : null;

  const result = {
    // Easy
    status: deriveStatus({ wallet, isConnecting, isSigning }),
    address: wallet?.vaultPda ?? null,
    signAndSend: handleSignAndSendTransaction,

    // State
    smartWalletPubkey,
    vaultPubkey: wallet?.vaultPda ? new PublicKey(wallet.vaultPda) : null,
    isConnected: !!wallet,
    error,
    wallet,
    protocolVersion: wallet ? (wallet.protocolVersion ?? 1) : null,

    // Actions
    connect: handleConnect,
    disconnect: handleDisconnect,
    signAndSendTransaction: handleSignAndSendTransaction,
    signMessage: handleSignMessage,
    verifyMessage: handleVerifyMessage,

    // Session key actions
    createSession: useCallback(
      (payload?: Parameters<WalletHookInterface['createSession']>[0]) => createSession(payload),
      [createSession]
    ),
    revokeSession: useCallback(
      (payload?: Parameters<WalletHookInterface['revokeSession']>[0]) => revokeSession(payload),
      [revokeSession]
    ),
    signAndSendWithSession: useCallback(
      (payload: SendTxPayload & ActionCallbacks<string>) => signAndSendWithSession(payload),
      [signAndSendWithSession]
    ),

    // Ed25519 authority actions
    addAuthority: useCallback(
      (payload: Parameters<WalletHookInterface['addAuthority']>[0]) => addAuthority(payload),
      [addAuthority]
    ),
    removeAuthority: useCallback(
      (targetAuthorityPda: string, options?: RemoveAuthorityOptions) => removeAuthority(targetAuthorityPda, options),
      [removeAuthority]
    ),
    signAndSendWithAuthority: useCallback(
      (payload: SendTxPayload & ActionCallbacks<string>) => signAndSendWithAuthority(payload),
      [signAndSendWithAuthority]
    ),

    // Deferred execution
    authorizeAndExecute: useCallback(
      (payload: DeferredTxPayload & ActionCallbacks<string>) => authorizeAndExecute(payload),
      [authorizeAndExecute]
    ),
    authorizeDeferred: useCallback(
      (payload: DeferredTxPayload & ActionCallbacks<{ signature: string; deferredPayload: string }>) =>
        authorizeDeferred(payload),
      [authorizeDeferred]
    ),
    executeDeferred: useCallback(
      (payload: ExecuteDeferredHookPayload & ActionCallbacks<string>) => executeDeferred(payload),
      [executeDeferred]
    ),
  };

  // The 3.x flags, as getters: reading one warns once per page.
  return Object.defineProperties(result, {
    isLoading: { enumerable: true, get: () => deprecated('isLoading', 'status', isLoading || isConnecting || isSigning) },
    isConnecting: { enumerable: true, get: () => deprecated('isConnecting', "status === 'connecting'", isConnecting) },
    isSigning: { enumerable: true, get: () => deprecated('isSigning', "status === 'signing'", isSigning) },
  }) as typeof result & Pick<WalletHookInterface, 'isLoading' | 'isConnecting' | 'isSigning'>;
};
