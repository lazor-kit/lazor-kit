/**
 * LazorKit Wallet Mobile Adapter - Store Actions
 *
 * Orchestrates wallet connection, disconnection, and passkey-signed
 * transaction flows via the LazorKit portal (React Native deep-link) and
 * `LazorKitClient`.
 */
import { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { sha256 } from 'js-sha256';

import { handleAuthRedirect } from './core/auth/handleRedirect';
import { openBrowser } from './core/browser/open';
import {
  buildPreviewTransactionBase64,
  createWalletActions,
  decodeWebAuthnResponse,
  sendInstructionsViaPaymaster,
  signChallengeViaPortal,
  toBase64Url,
} from './core/wallet/actions';
import { logger } from './core/logger';
import { API_ENDPOINTS } from './config';
import {
  LazorKitClient,
  type SessionAction,
  type Secp256r1Params,
  ROLE_SPENDER,
  AUTH_TYPE_ED25519,
} from './program';
import {
  AddAuthorityPayload,
  AuthorizeExecutePayload,
  AuthorizePayload,
  AuthorizeResult,
  ConnectOptions,
  CreateSessionPayload,
  ExecuteDeferredPayload,
  ListAuthoritiesResult,
  ReclaimDeferredPayload,
  RemoveAuthorityPayload,
  RevokeSessionPayload,
  SessionSignPayload,
  SignAndSendTransactionPayload,
  SignOptions,
  SigningError,
  TransferSolPayload,
  TxCallbacks,
  WalletConnectionError,
  WalletStateClient,
} from './types';
import { getFeePayer } from './core/paymaster';

// ─── Internal helpers ──────────────────────────────────────────────

/** Guards isSigning + resets state around an async op. */
async function withSigningState<T>(
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const { isSigning } = get();
  if (isSigning) return undefined;
  set({ isSigning: true, error: null });
  try {
    return await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    set({ error: err });
    throw err;
  } finally {
    set({ isSigning: false });
  }
}

/** Common guard: connected wallet + connection. Throws SigningError if missing. */
function requireWalletAndConnection(get: () => WalletStateClient) {
  const state = get();
  if (!state.wallet) throw new SigningError('No wallet connected');
  if (!state.connection) throw new SigningError('No connection available');
  return state;
}

/** Build a LazorKitClient bound to the current connection. */
function buildClient(get: () => WalletStateClient): LazorKitClient {
  return new LazorKitClient(get().connection);
}

/**
 * Derive the `Secp256r1Params` object the client expects from the persisted WalletInfo.
 *
 * We intentionally DO NOT pass `publicKeyBytes` here — the client reads the authoritative
 * pubkey off the on-chain Authority account via `readAuthorityPubkey`. Relying on the
 * portal-provided pubkey cached in `WalletInfo.passkeyPubkey` breaks cross-device passkey
 * recovery: on a second device, the saved/portal pubkey can desync from what the program
 * actually stored, yielding `0x2 InvalidSignature` from the secp256r1 precompile.
 */
function buildSecp256r1Params(wallet: {
  credentialId: string;
  walletDevice: string;
}): Secp256r1Params {
  return {
    credentialIdHash: new Uint8Array(
      sha256.arrayBuffer(Buffer.from(wallet.credentialId, 'base64')),
    ),
    authorityPda: new PublicKey(wallet.walletDevice),
  };
}

// ─── Connect / Disconnect ──────────────────────────────────────────

/**
 * Opens the portal, authenticates a passkey, and persists the resulting
 * LazorKit smart wallet (creating it on-chain if needed).
 */
export const connectAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  options: ConnectOptions,
) => {
  const { isConnecting, config } = get();
  if (isConnecting) {
    logger.error('Connect attempt while already connecting');
    throw new WalletConnectionError('Already connecting');
  }

  set({ isConnecting: true, error: null });

  try {
    const { redirectUrl } = options;
    const connectUrl = `${config.portalUrl}/${API_ENDPOINTS.CONNECT}&redirect_url=${encodeURIComponent(redirectUrl)}`;

    const resultUrl = await openBrowser(connectUrl, redirectUrl);
    const walletInfo = handleAuthRedirect(resultUrl);
    if (!walletInfo) {
      logger.error('Invalid wallet info from redirect', { resultUrl });
      throw new WalletConnectionError('Invalid wallet info from redirect');
    }

    const { saveWallet } = createWalletActions(
      get().connection,
      (isLoading) => set({ isLoading }),
      config,
    );

    const savedWallet = await saveWallet(walletInfo);
    set({ wallet: savedWallet });
    return savedWallet;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new WalletConnectionError(String(error));
    logger.error('Connect action failed:', err, { redirectUrl: options.redirectUrl });
    set({ error: err });
    throw err;
  } finally {
    set({ isConnecting: false });
  }
};

export const disconnectAction = async (
  set: (state: Partial<WalletStateClient>) => void,
) => {
  set({ isLoading: true });
  try {
    set({ wallet: null });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Disconnect action failed:', err);
    set({ error: err });
    throw err;
  } finally {
    set({ isLoading: false });
  }
};

// ─── Sign + Execute (single-tx via Execute) ────────────────────────

/**
 * Passkey-signed LazorKit `Execute` — prepare challenge, defer to portal,
 * finalize and relay via paymaster.
 */
export const signAndExecuteTransaction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: SignAndSendTransactionPayload,
  options: SignOptions,
) => {
  await withSigningState(get, set, async () => {
    try {
      const signature = await performPasskeyExecute(get, payload, options);
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      logger.error('signAndExecuteTransaction failed:', err, {
        smartWallet: get().wallet?.smartWallet,
        redirectUrl: options.redirectUrl,
      });
      options?.onFail?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  });
};

async function performPasskeyExecute(
  get: () => WalletStateClient,
  payload: SignAndSendTransactionPayload,
  options: SignOptions,
): Promise<string> {
  const { connection, wallet, config } = requireWalletAndConnection(get);
  const client = buildClient(get);
  const feePayer = await getFeePayer(
    config.configPaymaster.paymasterUrl,
    config.configPaymaster.apiKey,
  );

  const walletPda = new PublicKey(wallet!.walletPda);

  const prepared = await client.prepareExecute({
    payer: feePayer,
    walletPda,
    secp256r1: buildSecp256r1Params(wallet!),
    instructions: payload.instructions,
  });

  const previewBase64Tx = await buildPreviewTransactionBase64({
    connection,
    feePayer,
    instructions: payload.instructions,
  });

  const webAuthnResponse = await signChallengeViaPortal({
    challenge: prepared.challenge,
    credentialId: wallet!.credentialId,
    portalUrl: config.portalUrl,
    redirectUrl: options.redirectUrl,
    previewBase64Tx,
    clusterSimulation: payload.transactionOptions?.clusterSimulation,
  });

  const { instructions } = client.finalizeExecute(prepared, webAuthnResponse);
  const executeInstructions: TransactionInstruction[] = [];
  if (payload.transactionOptions?.computeUnitLimit) {
    executeInstructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: payload.transactionOptions.computeUnitLimit,
      }),
    );
  }
  executeInstructions.push(...instructions);

  const signature = await sendInstructionsViaPaymaster({
    instructions: executeInstructions,
    connection,
    feePayer,
    config,
    addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
    feeToken: payload.transactionOptions?.feeToken,
  });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

// ─── Sign Message (portal-only, no on-chain tx) ─────────────────────

export const signMessageAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  message: string,
  options: SignOptions,
) => {
  await withSigningState(get, set, async () => {
    try {
      const { wallet, config } = requireWalletAndConnection(get);
      const { redirectUrl } = options;
      const signUrl = `${config.portalUrl}/${API_ENDPOINTS.SIGN}&message=${encodeURIComponent(
        message,
      )}&credentialId=${encodeURIComponent(wallet!.credentialId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;

      const resultUrl = await openBrowser(signUrl, redirectUrl);
      const { handleBrowserResult } = await import('./core/browser/parseResult');
      const authResult = handleBrowserResult(resultUrl);
      const result = { signature: authResult.signature, signedPayload: authResult.message };
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('signMessageAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

// ─── Session Management ─────────────────────────────────────────────

/**
 * Create a session key with optional spending limits. The user's passkey
 * authorises creation; afterwards the session keypair can sign transactions
 * locally without further passkey prompts.
 */
export const createSessionAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  params: CreateSessionPayload,
  options: SignOptions,
): Promise<{ signature: string; sessionPda: PublicKey } | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const prepared = await client.prepareCreateSession({
        payer: feePayer,
        walletPda,
        secp256r1: buildSecp256r1Params(wallet!),
        sessionKey: params.sessionKey,
        expiresAt: params.expiresAtSlot,
        actions: params.actions,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
      });

      const { instructions } = client.finalizeCreateSession(prepared, response);
      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      const sessionPda = prepared.sessionPda;
      options?.onSuccess?.({ signature, sessionPda });
      return { signature, sessionPda };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('createSessionAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

/** Revoke a session before its expiry. Admin/owner passkey authorises. */
export const revokeSessionAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  params: RevokeSessionPayload,
  options: SignOptions,
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const prepared = await client.prepareRevokeSession({
        payer: feePayer,
        walletPda,
        secp256r1: buildSecp256r1Params(wallet!),
        sessionPda: params.sessionPda,
        refundDestination: params.refundDestination,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
      });

      const { instructions } = client.finalizeRevokeSession(prepared, response);
      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('revokeSessionAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

/**
 * Send a transaction using a session keypair. No passkey prompt; session
 * is Ed25519-signed locally. Falls back to paymaster for fees.
 */
export const signAndSendWithSessionAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: SessionSignPayload,
  options: { onSuccess?: (sig: string) => void; onFail?: (err: Error) => void },
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const { instructions } = await client.execute({
        payer: feePayer,
        walletPda,
        signer: {
          type: 'session',
          sessionPda: payload.sessionPda,
          sessionKeyPubkey: payload.sessionKeypair.publicKey,
        },
        instructions: payload.instructions,
      });

      const allInstructions: TransactionInstruction[] = [];
      if (payload.transactionOptions?.computeUnitLimit) {
        allInstructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: payload.transactionOptions.computeUnitLimit,
          }),
        );
      }
      allInstructions.push(...instructions);

      const signature = await sendInstructionsViaPaymaster({
        instructions: allInstructions,
        connection,
        feePayer,
        config,
        addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
        feeToken: payload.transactionOptions?.feeToken,
        extraSigners: [payload.sessionKeypair],
      });
      await connection.confirmTransaction(signature, 'confirmed');
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('signAndSendWithSessionAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

// ─── Authority Management ───────────────────────────────────────────

/**
 * Add an Ed25519 public key as an authority (admin or spender). Signed by
 * the current passkey owner.
 */
export const addAuthorityEd25519Action = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  params: AddAuthorityPayload,
  options: SignOptions,
): Promise<{ signature: string; newAuthorityPda: PublicKey } | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const prepared = await client.prepareAddAuthority({
        payer: feePayer,
        walletPda,
        secp256r1: buildSecp256r1Params(wallet!),
        newAuthority: {
          type: 'ed25519',
          publicKey: params.newEd25519Pubkey,
        },
        role: params.role ?? ROLE_SPENDER,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
      });

      const { instructions } = client.finalizeAddAuthority(prepared, response);
      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      const newAuthorityPda = prepared.newAuthorityPda;
      options?.onSuccess?.({ signature, newAuthorityPda });
      return { signature, newAuthorityPda };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('addAuthorityEd25519Action failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

/** Remove an existing authority (admin/spender). Passkey owner signs. */
export const removeAuthorityAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  params: RemoveAuthorityPayload,
  options: SignOptions,
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const prepared = await client.prepareRemoveAuthority({
        payer: feePayer,
        walletPda,
        secp256r1: buildSecp256r1Params(wallet!),
        targetAuthorityPda: params.targetAuthorityPda,
        refundDestination: params.refundDestination,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
      });

      const { instructions } = client.finalizeRemoveAuthority(prepared, response);
      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('removeAuthorityAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

// ─── Deferred Execution (2-tx: Authorize + ExecuteDeferred) ────────

/**
 * Two-transaction deferred flow. TX1 signs hashes of the instruction set;
 * TX2 executes without needing another signature. Use for payloads too big
 * for a single transaction (Jupiter swaps, multi-CPI batches).
 */
export const authorizeAndExecuteAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: AuthorizeExecutePayload,
  options: SignOptions,
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);

      const prepared = await client.prepareAuthorize({
        payer: feePayer,
        walletPda,
        secp256r1: buildSecp256r1Params(wallet!),
        instructions: payload.instructions,
        expiryOffset: payload.expiryOffset,
      });

      const previewBase64Tx = await buildPreviewTransactionBase64({
        connection,
        feePayer,
        instructions: payload.instructions,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
        previewBase64Tx,
        clusterSimulation: payload.transactionOptions?.clusterSimulation,
      });

      // TX1: Authorize (finalize also returns deferredPayload for TX2)
      const {
        instructions: authorizeIxs,
        deferredPayload,
      } = client.finalizeAuthorize(prepared, response);
      const authorizeSig = await sendInstructionsViaPaymaster({
        instructions: authorizeIxs,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(authorizeSig, 'confirmed');

      // TX2: ExecuteDeferred
      const { instructions: executeIxs } = await client.executeDeferredFromPayload({
        payer: feePayer,
        deferredPayload,
      });

      const tx2Instructions: TransactionInstruction[] = [];
      if (payload.transactionOptions?.computeUnitLimit) {
        tx2Instructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: payload.transactionOptions.computeUnitLimit,
          }),
        );
      }
      tx2Instructions.push(...executeIxs);

      const executeSig = await sendInstructionsViaPaymaster({
        instructions: tx2Instructions,
        connection,
        feePayer,
        config,
        addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
        feeToken: payload.transactionOptions?.feeToken,
      });
      await connection.confirmTransaction(executeSig, 'confirmed');
      options?.onSuccess?.(executeSig);
      return executeSig;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('authorizeAndExecuteAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

// ─── Deferred execution (standalone TX1 / TX2 / reclaim) ───────────

/**
 * Standalone TX1 — passkey-signed `Authorize`. Returns the on-chain tx signature
 * plus the `DeferredPayload` needed to submit TX2 (ExecuteDeferred). Persist the
 * payload (e.g. via `serializeDeferredPayload`) if TX2 runs on another device /
 * via a relayer / at a later time.
 */
export const authorizeDeferredAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: AuthorizePayload,
  options: SignOptions,
): Promise<AuthorizeResult | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );
      const walletPda = new PublicKey(wallet!.walletPda);
      const secp256r1 = buildSecp256r1Params(wallet!);

      const prepared = await client.prepareAuthorize({
        payer: feePayer,
        walletPda,
        secp256r1,
        instructions: payload.instructions,
        expiryOffset: payload.expiryOffset,
      });

      const previewBase64Tx = await buildPreviewTransactionBase64({
        connection,
        feePayer,
        instructions: payload.instructions,
      });

      const response = await signChallengeViaPortal({
        challenge: prepared.challenge,
        credentialId: wallet!.credentialId,
        portalUrl: config.portalUrl,
        redirectUrl: options.redirectUrl,
        previewBase64Tx,
        clusterSimulation: payload.transactionOptions?.clusterSimulation,
      });

      const {
        instructions,
        deferredExecPda,
        counter,
        deferredPayload,
      } = client.finalizeAuthorize(prepared, response);

      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');

      const result: AuthorizeResult = { signature, deferredPayload, deferredExecPda, counter };
      options?.onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('authorizeDeferredAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

/**
 * Standalone TX2 — submits `ExecuteDeferred` from a payload produced by
 * {@link authorizeDeferredAction} (or deserialized from storage / network). No passkey
 * prompt: the on-chain program verifies the instruction + accounts hash against
 * the TX1 authorization.
 */
export const executeDeferredAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: ExecuteDeferredPayload,
  options?: TxCallbacks,
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );

      const { instructions } = await client.executeDeferredFromPayload({
        payer: feePayer,
        deferredPayload: payload.deferredPayload,
        refundDestination: payload.refundDestination,
      });

      const allInstructions: TransactionInstruction[] = [];
      if (payload.transactionOptions?.computeUnitLimit) {
        allInstructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: payload.transactionOptions.computeUnitLimit,
          }),
        );
      }
      allInstructions.push(...instructions);

      const signature = await sendInstructionsViaPaymaster({
        instructions: allInstructions,
        connection,
        feePayer,
        config,
        addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
        feeToken: payload.transactionOptions?.feeToken,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('executeDeferredAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

/**
 * Close an expired `DeferredExec` PDA and recover its rent. Gated on the
 * original payer; no passkey signing involved.
 */
export const reclaimDeferredAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: ReclaimDeferredPayload,
  options?: TxCallbacks,
): Promise<string | undefined> => {
  return withSigningState(get, set, async () => {
    try {
      const { connection, config } = requireWalletAndConnection(get);
      const client = buildClient(get);
      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );

      const { instructions } = client.reclaimDeferred({
        payer: feePayer,
        deferredExecPda: payload.deferredExecPda,
        refundDestination: payload.refundDestination,
      });

      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      await connection.confirmTransaction(signature, 'confirmed');
      options?.onSuccess?.(signature);
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('reclaimDeferredAction failed:', error);
      options?.onFail?.(error);
      throw error;
    }
  });
};

// ─── Read-only ──────────────────────────────────────────────────────

/**
 * Fetch all authority accounts for the currently connected wallet.
 *
 * Uses `getProgramAccounts` with discriminator + wallet filters. After the
 * v2 Authority layout (fixed 145-byte accounts with `rpIdHash` instead of
 * variable `rpId`), the credential field lives at offset 48 and the
 * compressed secp256r1 pubkey at offset 80.
 */
export const listAuthoritiesAction = async (
  get: () => WalletStateClient,
): Promise<ListAuthoritiesResult> => {
  const { connection, wallet } = requireWalletAndConnection(get);
  const walletPda = new PublicKey(wallet!.walletPda);

  const programId = new LazorKitClient(connection).programId;
  const accounts = await connection.getProgramAccounts(programId, {
    encoding: 'base64',
    filters: [
      // discriminator: 2 (Authority)
      { memcmp: { offset: 0, bytes: Buffer.from([2]).toString('base64'), encoding: 'base64' } },
      // wallet pubkey at offset 16 of the AuthorityAccountHeader
      { memcmp: { offset: 16, bytes: Buffer.from(walletPda.toBytes()).toString('base64'), encoding: 'base64' } },
    ],
  });

  return accounts.map(({ pubkey: authorityPda, account }) => {
    const data = account.data as unknown as Buffer;
    const authorityType = data[1];
    return {
      authorityPda,
      authorityType,
      role: data[2],
      credential: new Uint8Array(data.slice(48, 80)),
      secp256r1Pubkey:
        authorityType === AUTH_TYPE_ED25519
          ? undefined
          : new Uint8Array(data.slice(80, 113)),
    };
  });
};

// ─── Convenience: transferSol ──────────────────────────────────────

/** Convenience helper — wraps `signAndExecuteTransaction` with a vault→recipient transfer. */
export const transferSolAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: TransferSolPayload,
  options: SignOptions,
) => {
  const { wallet } = requireWalletAndConnection(get);
  // smartWallet now IS the vault address — funds live there.
  const vaultPda = new PublicKey(wallet!.smartWallet);
  const lamports =
    typeof payload.lamports === 'bigint'
      ? Number(payload.lamports)
      : payload.lamports;
  const ix = SystemProgram.transfer({
    fromPubkey: vaultPda,
    toPubkey: payload.recipient,
    lamports,
  });
  await signAndExecuteTransaction(
    get,
    set,
    {
      instructions: [ix],
      transactionOptions: payload.transactionOptions,
    },
    options,
  );
};

// Re-export toBase64Url for callers that want to build custom challenges.
export { toBase64Url };

// Keep these imports used (tree-shaking safety for types-only imports)
export type { Keypair, SessionAction };
