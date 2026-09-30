/**
 * LazorKit Wallet Mobile Adapter - React Hook
 */

import { PublicKey } from '@solana/web3.js';
import { useWalletStore } from './store';
import {
  AddAuthorityPayload,
  AuthorizeExecutePayload,
  AuthorizePayload,
  AuthorizeResult,
  ConnectOptions,
  CreateSessionPayload,
  DisconnectOptions,
  ExecuteDeferredPayload,
  LazorWalletHook,
  ListAuthoritiesResult,
  ReclaimDeferredPayload,
  RemoveAuthorityPayload,
  RevokeSessionPayload,
  SessionSignPayload,
  SignAndSendTransactionPayload,
  SignOptions,
  TransferSolPayload,
  TxCallbacks,
} from '../types';
import { logger } from '../core/logger';

export function useWallet(): LazorWalletHook {
  const {
    wallet,
    isLoading,
    isConnecting,
    isSigning,
    error,
    connection,
    connect,
    disconnect,
    signAndExecuteTransaction,
    signMessage,
    createSession,
    revokeSession,
    signAndSendWithSession,
    addAuthorityEd25519,
    removeAuthority,
    authorizeAndExecute,
    authorizeDeferred,
    executeDeferred,
    reclaimDeferred,
    listAuthorities,
    transferSol,
  } = useWalletStore();

  // `smartWallet` is the vault PDA — where SOL/tokens live.
  const smartWalletPubkey = wallet?.smartWallet ? new PublicKey(wallet.smartWallet) : null;
  const vaultPubkey = smartWalletPubkey; // alias for clarity
  const walletPdaPubkey = wallet?.walletPda ? new PublicKey(wallet.walletPda) : null;

  const handleConnect = async (connectOptions: ConnectOptions) => {
    try {
      const result = await connect(connectOptions);
      connectOptions?.onSuccess?.(result);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error('Hook connect failed:', err, { redirectUrl: connectOptions.redirectUrl });
      connectOptions?.onFail?.(err);
      throw err;
    }
  };

  const handleDisconnect = async (disconnectOptions?: DisconnectOptions) => {
    try {
      await disconnect();
      disconnectOptions?.onSuccess?.();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error('Hook disconnect failed:', err);
      disconnectOptions?.onFail?.(err);
      throw err;
    }
  };

  // Each action's promise settles, and its callbacks run, once `isSigning`
  // is false again: `await send(a); await send(b)` runs both.
  const handleSignAndSend = (
    payload: SignAndSendTransactionPayload,
    signOptions: SignOptions,
  ): Promise<string> => signAndExecuteTransaction(payload, signOptions);

  const handleSignMessage = (
    message: string,
    signOptions: SignOptions,
  ): Promise<{ signature: string; signedPayload: string }> => signMessage(message, signOptions);

  const handleCreateSession = async (
    payload: CreateSessionPayload,
    signOptions: SignOptions,
  ): Promise<{ signature: string; sessionPda: PublicKey }> => {
    return createSession(payload, signOptions);
  };

  const handleRevokeSession = async (
    payload: RevokeSessionPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    return revokeSession(payload, signOptions);
  };

  const handleSignAndSendWithSession = async (
    payload: SessionSignPayload,
    options?: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
  ): Promise<string> => {
    return signAndSendWithSession(payload, options ?? {});
  };

  const handleAddAuthorityEd25519 = async (
    payload: AddAuthorityPayload,
    signOptions: SignOptions,
  ): Promise<{ signature: string; newAuthorityPda: PublicKey }> => {
    return addAuthorityEd25519(payload, signOptions);
  };

  const handleRemoveAuthority = async (
    payload: RemoveAuthorityPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    return removeAuthority(payload, signOptions);
  };

  const handleAuthorizeAndExecute = async (
    payload: AuthorizeExecutePayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    return authorizeAndExecute(payload, signOptions);
  };

  const handleAuthorizeDeferred = async (
    payload: AuthorizePayload,
    signOptions: SignOptions,
  ): Promise<AuthorizeResult> => {
    return authorizeDeferred(payload, signOptions);
  };

  const handleExecuteDeferred = async (
    payload: ExecuteDeferredPayload,
    options?: TxCallbacks,
  ): Promise<string> => {
    return executeDeferred(payload, options);
  };

  const handleReclaimDeferred = async (
    payload: ReclaimDeferredPayload,
    options?: TxCallbacks,
  ): Promise<string> => {
    return reclaimDeferred(payload, options);
  };

  const handleListAuthorities = async (): Promise<ListAuthoritiesResult> => {
    return listAuthorities();
  };

  const handleTransferSol = (
    payload: TransferSolPayload,
    signOptions: SignOptions,
  ): Promise<string> => transferSol(payload, signOptions);

  return {
    smartWalletPubkey,
    vaultPubkey,
    walletPdaPubkey,
    passkeyPubkey: wallet?.passkeyPubkey || null,
    protocolVersion: wallet ? (wallet.protocolVersion ?? 1) : null,
    isConnected: !!wallet,
    isLoading,
    isConnecting,
    isSigning,
    error,
    connection,
    connect: handleConnect,
    disconnect: handleDisconnect,
    signAndSendTransaction: handleSignAndSend,
    signMessage: handleSignMessage,
    createSession: handleCreateSession,
    revokeSession: handleRevokeSession,
    signAndSendWithSession: handleSignAndSendWithSession,
    addAuthorityEd25519: handleAddAuthorityEd25519,
    removeAuthority: handleRemoveAuthority,
    listAuthorities: handleListAuthorities,
    authorizeAndExecute: handleAuthorizeAndExecute,
    authorizeDeferred: handleAuthorizeDeferred,
    executeDeferred: handleExecuteDeferred,
    reclaimDeferred: handleReclaimDeferred,
    transferSol: handleTransferSol,
  };
}
