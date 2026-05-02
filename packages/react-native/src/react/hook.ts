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

  const handleSignAndSend = (
    payload: SignAndSendTransactionPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      signAndExecuteTransaction(payload, {
        redirectUrl: signOptions.redirectUrl,
        onSuccess: (signature: string) => {
          signOptions?.onSuccess?.(signature);
          resolve(signature);
        },
        onFail: (err) => {
          signOptions?.onFail?.(err);
          reject(err);
        },
      }).catch(reject);
    });
  };

  const handleSignMessage = (
    message: string,
    signOptions: SignOptions,
  ): Promise<{ signature: string; signedPayload: string }> => {
    return new Promise((resolve, reject) => {
      signMessage(message, {
        redirectUrl: signOptions.redirectUrl,
        onSuccess: (result) => {
          signOptions?.onSuccess?.(result);
          resolve(result);
        },
        onFail: (err) => {
          signOptions?.onFail?.(err);
          reject(err);
        },
      }).catch(reject);
    });
  };

  const handleCreateSession = async (
    payload: CreateSessionPayload,
    signOptions: SignOptions,
  ): Promise<{ signature: string; sessionPda: PublicKey }> => {
    const result = await createSession(payload, signOptions);
    if (!result) throw new Error('createSession returned no result');
    return result;
  };

  const handleRevokeSession = async (
    payload: RevokeSessionPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    const sig = await revokeSession(payload, signOptions);
    if (!sig) throw new Error('revokeSession returned no signature');
    return sig;
  };

  const handleSignAndSendWithSession = async (
    payload: SessionSignPayload,
    options?: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
  ): Promise<string> => {
    const sig = await signAndSendWithSession(payload, options ?? {});
    if (!sig) throw new Error('signAndSendWithSession returned no signature');
    return sig;
  };

  const handleAddAuthorityEd25519 = async (
    payload: AddAuthorityPayload,
    signOptions: SignOptions,
  ): Promise<{ signature: string; newAuthorityPda: PublicKey }> => {
    const result = await addAuthorityEd25519(payload, signOptions);
    if (!result) throw new Error('addAuthorityEd25519 returned no result');
    return result;
  };

  const handleRemoveAuthority = async (
    payload: RemoveAuthorityPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    const sig = await removeAuthority(payload, signOptions);
    if (!sig) throw new Error('removeAuthority returned no signature');
    return sig;
  };

  const handleAuthorizeAndExecute = async (
    payload: AuthorizeExecutePayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    const sig = await authorizeAndExecute(payload, signOptions);
    if (!sig) throw new Error('authorizeAndExecute returned no signature');
    return sig;
  };

  const handleAuthorizeDeferred = async (
    payload: AuthorizePayload,
    signOptions: SignOptions,
  ): Promise<AuthorizeResult> => {
    const result = await authorizeDeferred(payload, signOptions);
    if (!result) throw new Error('authorizeDeferred returned no result');
    return result;
  };

  const handleExecuteDeferred = async (
    payload: ExecuteDeferredPayload,
    options?: TxCallbacks,
  ): Promise<string> => {
    const sig = await executeDeferred(payload, options);
    if (!sig) throw new Error('executeDeferred returned no signature');
    return sig;
  };

  const handleReclaimDeferred = async (
    payload: ReclaimDeferredPayload,
    options?: TxCallbacks,
  ): Promise<string> => {
    const sig = await reclaimDeferred(payload, options);
    if (!sig) throw new Error('reclaimDeferred returned no signature');
    return sig;
  };

  const handleListAuthorities = async (): Promise<ListAuthoritiesResult> => {
    return listAuthorities();
  };

  const handleTransferSol = (
    payload: TransferSolPayload,
    signOptions: SignOptions,
  ): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      transferSol(payload, {
        redirectUrl: signOptions.redirectUrl,
        onSuccess: (signature: string) => {
          signOptions?.onSuccess?.(signature);
          resolve(signature);
        },
        onFail: (err) => {
          signOptions?.onFail?.(err);
          reject(err);
        },
      }).catch(reject);
    });
  };

  return {
    smartWalletPubkey,
    vaultPubkey,
    walletPdaPubkey,
    passkeyPubkey: wallet?.passkeyPubkey || null,
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
