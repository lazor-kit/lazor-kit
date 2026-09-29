/**
 * Wallet Hook - Provides clean interface to wallet functionality
 * Business logic is handled by store actions
 */

import { useCallback } from 'react';
import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction, AddressLookupTableAccount } from '@solana/web3.js';
import { useWalletStore } from './store';
import { WalletInfo } from '../core/storage';
import type { SpendingLimits } from '../core/types';
import type { OnConfirmWallet } from '../core/wallet/confirmation';

export interface WalletHookInterface {
  // State
  /** The wallet PDA — an internal account. Do not send funds here. */
  smartWalletPubkey: PublicKey | null;
  /** The vault: the address the user's funds live at, and the one to show. */
  vaultPubkey: PublicKey | null;
  isConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;
  wallet: WalletInfo | null;
  /**
   * The protocol the connected wallet lives on: 1 for a wallet made before
   * LazorKit v2, 2 since. `null` when disconnected. Every action already routes
   * by it; read it to offer a v1 user the move to v2.
   */
  protocolVersion: 1 | 2 | null;

  // Actions
  /**
   * Connect the stored wallet, or find the passkey's own. `confirmWallet`: the
   * vault (or wallet) address the user recognised after a
   * `WalletNeedsConfirmationError`. `onConfirmWallet` overrides the
   * provider's for this call.
   */
  connect: (options?: ConnectHookOptions) => Promise<WalletInfo>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (payload: SendTxPayload) => Promise<string>;
  signMessage: (message: string) => Promise<{ signature: string, signedPayload: string }>;
  verifyMessage: (args: { signedPayload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array }) => Promise<boolean>;

  // Session key actions
  createSession: (payload?: {
    expiresInSlots?: bigint;
    spendingLimits?: SpendingLimits;
    /**
     * Optional pubkey to register as the session authority. When set, the
     * SDK skips local keypair generation + localStorage persistence — the
     * caller owns the matching secretKey (typical for backend / agent
     * delegation). Accepts base58 string or `PublicKey`.
     */
    sessionKey?: PublicKey | string;
    /**
     * Mint a session with no spending limits — it can spend the whole vault
     * through any program until it expires. Required when `spendingLimits` is
     * omitted; without either, `createSession` throws.
     */
    unrestricted?: boolean;
  }) => Promise<{ sessionPda: string; sessionPublicKey: string }>;
  revokeSession: (payload?: { sessionPda?: PublicKey | string }) => Promise<void>;
  signAndSendWithSession: (payload: SendTxPayload) => Promise<string>;

  // Ed25519 authority actions
  addAuthority: (payload?: { role?: number; policy?: Uint8Array; unrestricted?: boolean }) => Promise<{ authorityPda: string; authorityPublicKey: string }>;
  removeAuthority: (targetAuthorityPda: string) => Promise<void>;
  signAndSendWithAuthority: (payload: SendTxPayload) => Promise<string>;

  // Deferred execution
  authorizeAndExecute: (payload: SendTxPayload) => Promise<string>;
  /** TX1 only — passkey ký và trả về serialized deferredPayload cho TX2. */
  authorizeDeferred: (payload: SendTxPayload) => Promise<{ signature: string; deferredPayload: string }>;
  /** TX2 only — submit từ serialized deferredPayload. Không cần passkey. */
  executeDeferred: (payload: ExecuteDeferredHookPayload) => Promise<string>;
}

export interface ConnectHookOptions {
  feeMode?: 'paymaster' | 'user';
  confirmWallet?: string;
  onConfirmWallet?: OnConfirmWallet;
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

export interface ExecuteDeferredHookPayload {
  deferredPayload: string;
  transactionOptions?: SendTxPayload['transactionOptions'];
}

import { verifySignatureBrowser } from '../utils/verify';

/**
 * Hook for interacting with the Lazorkit wallet
 * Simplified interface for wallet functionality
 */
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

  const handleDisconnect = useCallback(() => disconnect(), [disconnect]);

  const handleSignAndSendTransaction = useCallback(
    (payload: SendTxPayload) => signAndSendTransaction(payload),
    [signAndSendTransaction]
  );

  const handleSignMessage = useCallback(
    (message: string) => signMessage(message),
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

  return {
    // State
    smartWalletPubkey,
    vaultPubkey: wallet?.vaultPda ? new PublicKey(wallet.vaultPda) : null,
    isConnected: !!wallet,
    isLoading: isLoading || isConnecting || isSigning,
    isConnecting,
    isSigning,
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
      (payload?: {
        expiresInSlots?: bigint;
        spendingLimits?: SpendingLimits;
        sessionKey?: PublicKey | string;
        unrestricted?: boolean;
      }) => createSession(payload),
      [createSession]
    ),
    revokeSession: useCallback(
      (payload?: { sessionPda?: PublicKey | string }) => revokeSession(payload),
      [revokeSession]
    ),
    signAndSendWithSession: useCallback(
      (payload: SendTxPayload) => signAndSendWithSession(payload),
      [signAndSendWithSession]
    ),

    // Ed25519 authority actions
    addAuthority: useCallback(
      (payload?: { role?: number; policy?: Uint8Array; unrestricted?: boolean }) => addAuthority(payload),
      [addAuthority]
    ),
    removeAuthority: useCallback(
      (targetAuthorityPda: string) => removeAuthority(targetAuthorityPda),
      [removeAuthority]
    ),
    signAndSendWithAuthority: useCallback(
      (payload: SendTxPayload) => signAndSendWithAuthority(payload),
      [signAndSendWithAuthority]
    ),

    // Deferred execution
    authorizeAndExecute: useCallback(
      (payload: SendTxPayload) => authorizeAndExecute(payload),
      [authorizeAndExecute]
    ),
    authorizeDeferred: useCallback(
      (payload: SendTxPayload) => authorizeDeferred(payload),
      [authorizeDeferred]
    ),
    executeDeferred: useCallback(
      (payload: ExecuteDeferredHookPayload) => executeDeferred(payload),
      [executeDeferred]
    ),
  };
};
