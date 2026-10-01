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

import { handleAuthRedirect, readConnectAssertion } from './core/auth/handleRedirect';
import { openBrowser } from './core/browser/open';
import {
  buildPreviewTransactionBase64,
  createWalletActions,
  decodeWebAuthnResponse,
  newOwnershipChallenge,
  paymasterFor,
  sendInstructionsViaPaymaster,
  signChallengeViaPortal,
  toBase64Url,
} from './core/wallet/actions';
import { connectAbandoned, forgetCandidates, hasChooserHost } from './core/wallet/confirmation';
import { type AuthorityTurn, withAuthority } from './core/wallet/sequence';
import { deferredExpiryOffset, executeBeforeExpiry } from './core/wallet/deferred';
import {
  type TxV1Decision,
  placeholderFor,
  planTxV1BeforePrompt,
  withComputeUnitLimit,
} from './core/wallet/txv1-send';
import { logger } from './core/logger';
import { API_ENDPOINTS } from './config';
import {
  LazorKitClient,
  type SessionAction,
  type Secp256r1Params,
  type ProtocolVersion,
  ROLE_SPENDER,
  ACCOUNT_DISCRIMINATOR,
  AUTH_TYPE_ED25519,
  V1_DISC_AUTHORITY,
  clientFor,
  versionOf,
  versionOfAccount,
  isRetiredDeploymentError,
  V1WalletRetiredError,
  V1WalletMigratedError,
} from './program';
import {
  AddAuthorityPayload,
  AuthorizeExecutePayload,
  AuthorizePayload,
  AuthorizeResult,
  ConfirmWalletRequest,
  ConnectOptions,
  CreateSessionPayload,
  ExecuteDeferredPayload,
  ListAuthoritiesResult,
  PendingWalletConfirmation,
  ReclaimDeferredPayload,
  RemoveAuthorityPayload,
  RevokeSessionPayload,
  SessionSignPayload,
  SignAndSendTransactionPayload,
  SignOptions,
  SigningError,
  TransactionOptions,
  TransferSolPayload,
  TxCallbacks,
  WalletConnectionError,
  WalletInfo,
  WalletStateClient,
} from './types';
import { getFeePayer } from './core/paymaster';

// ─── Internal helpers ──────────────────────────────────────────────

/**
 * Guards isSigning + resets state around an async op, then reports its
 * outcome: to `callbacks`, and as the returned promise. Both come after
 * `isSigning` is false again, so an app that sends again from `onSuccess`, or
 * on the line after `await`, is not refused as still in progress.
 *
 * A second request while one is running rejects with `SigningError` (and
 * calls its onFail): resolving it with nothing would leave its caller
 * waiting forever.
 */
async function withSigningState<T>(
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  callbacks:
    | { readonly onSuccess?: (result: T) => void; readonly onFail?: (error: Error) => void }
    | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const { isSigning } = get();
  if (isSigning) {
    const error = new SigningError('Another passkey request is still in progress');
    notify(callbacks?.onFail, error);
    throw error;
  }
  set({ isSigning: true, error: null });
  let outcome: { ok: true; value: T } | { ok: false; error: Error };
  try {
    outcome = { ok: true, value: await fn() };
  } catch (error) {
    const err = toActionError(error, get);
    // The stored wallet is gone from the chain; stop showing its address.
    if (err instanceof V1WalletMigratedError) set({ wallet: null });
    set({ error: err });
    outcome = { ok: false, error: err };
  } finally {
    set({ isSigning: false });
  }
  if (!outcome.ok) {
    notify(callbacks?.onFail, outcome.error);
    throw outcome.error;
  }
  notify(callbacks?.onSuccess, outcome.value);
  return outcome.value;
}

/** Calls an app's callback. What it throws is logged, and does not change the action's outcome. */
function notify<A>(callback: ((arg: A) => void) | undefined, arg: A): void {
  if (!callback) return;
  try {
    callback(arg);
  } catch (error) {
    logger.error('A wallet action callback threw:', error);
  }
}

/**
 * The error an action reports, to its onFail and to its caller alike. A v1
 * wallet after LazorKit v1 was retired gets `V1WalletRetiredError`, which
 * says what happened and what to do, rather than a bare `0xfb2`.
 */
function toActionError(error: unknown, get: () => WalletStateClient, flowVersion?: ProtocolVersion): Error {
  if (error instanceof V1WalletRetiredError || error instanceof V1WalletMigratedError) return error;
  const wallet = get().wallet;
  if (isRetiredDeploymentError(error, flowVersion ?? (wallet ? versionOf(wallet) : undefined))) {
    return new V1WalletRetiredError(error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Common guard: connected wallet + connection. Throws SigningError if missing. */
function requireWalletAndConnection(get: () => WalletStateClient) {
  const state = get();
  if (!state.wallet) throw new SigningError('No wallet connected');
  if (!state.connection) throw new SigningError('No connection available');
  return state;
}

/**
 * The client for the connected wallet's protocol — v1 for a wallet made before
 * LazorKit v2, v2 since. Sending one protocol's instruction to the other's
 * program fails, so nothing here uses a single global program id.
 */
async function buildClient(
  get: () => WalletStateClient,
): Promise<{ client: LazorKitClient; version: ProtocolVersion }> {
  const { wallet, connection } = get();
  const version = wallet ? versionOf(wallet) : 2;
  // A v1 wallet that no longer exists has been migrated: its funds are in the
  // passkey's v2 wallet now, and the persisted address is dead.
  if (wallet && version === 1 && !(await connection.getAccountInfo(new PublicKey(wallet.walletPda)))) {
    throw new V1WalletMigratedError();
  }
  return { client: clientFor(version, connection), version };
}

/** The fee payer of the paymaster that serves this protocol. */
function feePayerFor(config: WalletStateClient['config'], version: ProtocolVersion) {
  const paymaster = paymasterFor(config, version);
  return getFeePayer(paymaster.paymasterUrl, paymaster.apiKey);
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

/**
 * Run a passkey-signed flow in its authority's lane (core/wallet/sequence):
 * one at a time per passkey, each challenge read at `confirmed` from a node
 * that has executed the passkey's previous transaction. `fn` gets the
 * challenge params with those read options, and the turn to confirm with.
 */
async function withPasskey<T>(
  connection: WalletStateClient['connection'],
  wallet: { credentialId: string; walletDevice: string },
  fn: (secp256r1: Secp256r1Params, turn: AuthorityTurn) => Promise<T>,
): Promise<T> {
  const params = buildSecp256r1Params(wallet);
  return withAuthority(params.authorityPda!, async (turn) =>
    fn({ ...params, ...(await turn.challengeReads(connection)) }, turn),
  );
}

// ─── SIMD-0385 v1 ('v1' requests only; core/wallet/txv1-send) ──────

/** The limits a 'v1' request passes on with a send. */
function limitsOf(options: TransactionOptions): { computeUnitLimit?: number; loadedAccountsDataSizeLimit?: number } {
  return {
    computeUnitLimit: options.computeUnitLimit,
    loadedAccountsDataSizeLimit: options.loadedAccountsDataSizeLimit,
  };
}

/**
 * The format of a deferred pair ('v1' requests), decided before the portal
 * opens: one decision for both transactions. TX1 (Authorize) is measured with
 * a worst-case WebAuthn response and, when the pair goes out as v1, TX2
 * (ExecuteDeferred) exactly, since it carries no WebAuthn bytes: TX1 is never
 * sent for a v1 TX2 that could not be. A pair that goes out as v0 does not
 * build TX2 here, so it reads nothing a 'v0' request does not.
 */
function planAuthorizeTxV1(params: {
  client: LazorKitClient;
  connection: WalletStateClient['connection'];
  version: ProtocolVersion;
  config: WalletStateClient['config'];
  feePayer: PublicKey;
  prepared: Awaited<ReturnType<LazorKitClient['prepareAuthorize']>>;
  instructions: TransactionInstruction[];
  options: TransactionOptions;
}): Promise<TxV1Decision> {
  // What TX2 executes does not depend on the WebAuthn response.
  const { deferredPayload } = params.client.finalizeAuthorize(params.prepared, placeholderFor(params.config.portalUrl));
  return planTxV1BeforePrompt({
    paymaster: paymasterFor(params.config, params.version),
    options: params.options,
    payload: params.instructions,
    // TX2, ExecuteDeferred, runs the payload.
    execute: 'deferred',
    payer: params.feePayer,
    portalUrl: params.config.portalUrl,
    draft: (webAuthn) => params.client.finalizeAuthorize(params.prepared, webAuthn).instructions,
    transaction: 'tx1',
    tx2: async () => {
      // TX2 as it is built once TX1 has landed, but on a client of its own:
      // executeDeferredFromPayload reads the protocol config and the payer's
      // FeeRecord, and once it has returned RegisterPayer it takes the payer
      // as registered. Asked on the action's client, the real TX2 would then
      // go without the RegisterPayer it needs.
      const tx2 = await clientFor(params.version, params.connection).executeDeferredFromPayload({
        payer: params.feePayer,
        deferredPayload,
      });
      return {
        instructions: withComputeUnitLimit(tx2.instructions, params.options.computeUnitLimit),
        addressLookupTables: params.options.addressLookupTableAccounts,
      };
    },
  });
}

// ─── Connect / Disconnect ──────────────────────────────────────────

/**
 * The store's connect in flight, if any. `disconnect` aborts it: its chooser
 * closes and it saves, remembers and returns nothing — so no wallet arrives
 * after the user disconnected, or beside a connect started after that. (The
 * store is one per app, as is this.)
 */
let connectInFlight: AbortController | null = null;

/**
 * Returns the connected wallet when there is one; otherwise opens the portal,
 * proves which wallet is the passkey's (asking the user when the SDK cannot
 * tell) and persists it — creating one on-chain when it has none.
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

  const attempt = new AbortController();
  connectInFlight = attempt;
  set({ isConnecting: true, error: null });

  try {
    const { redirectUrl } = options;

    let stored = get().wallet;
    // A stored v1 wallet may have been migrated since — on the LazorKit
    // migration page, say. Then it is closed and its address is dead; forget
    // it and connect afresh, which finds the v2 wallet.
    if (stored && versionOf(stored) === 1 && !(await get().connection.getAccountInfo(new PublicKey(stored.walletPda)))) {
      if (attempt.signal.aborted) throw connectAbandoned();
      set({ wallet: null });
      stored = null;
    }
    if (stored) {
      // A connected wallet is never swapped silently for another.
      if (options.confirmWallet !== undefined && !namesWallet(stored, options.confirmWallet)) {
        throw new Error(
          `confirmWallet ${options.confirmWallet} is not the connected wallet (${stored.smartWallet}). ` +
            'Disconnect first to connect another.',
        );
      }
      if (attempt.signal.aborted) throw connectAbandoned();
      return stored;
    }

    const { saveWallet, adoptRemembered } = createWalletActions(
      get().connection,
      // An abandoned connect no longer owns the store's loading state.
      (isLoading) => {
        if (!attempt.signal.aborted) set({ isLoading });
      },
      config,
    );

    // The user's pick after WalletNeedsConfirmationError: no second trip
    // through the portal while the candidates are fresh. One that names none
    // of them throws here, and they stay remembered.
    const remembered = options.confirmWallet !== undefined && adoptRemembered(options.confirmWallet);
    if (remembered) {
      set({ wallet: remembered });
      return remembered;
    }
    // Anything still remembered came from an earlier portal session, maybe
    // another passkey's; this connect opens a new one.
    forgetCandidates();

    // A portal that signs it answers with an ownership proof, which saves the
    // passkey a second prompt; one that does not ignores the parameter.
    const challenge = newOwnershipChallenge();
    const connectUrl =
      `${config.portalUrl}/${API_ENDPOINTS.CONNECT}&redirect_url=${encodeURIComponent(redirectUrl)}` +
      `&challenge=${encodeURIComponent(toBase64Url(challenge))}`;

    const resultUrl = await openBrowser(connectUrl, redirectUrl);
    if (attempt.signal.aborted) throw connectAbandoned();
    const walletInfo = handleAuthRedirect(resultUrl);
    if (!walletInfo) {
      logger.error('Invalid wallet info from redirect', { resultUrl });
      throw new WalletConnectionError('Invalid wallet info from redirect');
    }

    const savedWallet = await saveWallet(walletInfo, {
      redirectUrl,
      proof: readConnectAssertion(resultUrl, challenge),
      confirmWallet: options.confirmWallet,
      onConfirmWallet: options.onConfirmWallet,
      openChooser: (request) => openWalletChooser(get, set, request),
      signal: attempt.signal,
    });
    // Disconnected since: a wallet created meanwhile is simply not connected
    // (the next connect offers it, "Not used with this passkey yet").
    if (attempt.signal.aborted) throw connectAbandoned();
    forgetCandidates();
    set({ wallet: savedWallet });
    return savedWallet;
  } catch (error: unknown) {
    if (attempt.signal.aborted) {
      // Abandoned by disconnect, which already reset the store: leave its
      // `error` alone, but still fail this call — with whatever the closed
      // chooser made of it (a decline) reported as the abandon.
      throw connectAbandoned();
    }
    const err = error instanceof Error ? error : new WalletConnectionError(String(error));
    logger.error('Connect action failed:', err, { redirectUrl: options.redirectUrl });
    set({ error: err });
    throw err;
  } finally {
    // An abandoned connect no longer owns `isConnecting`: disconnect reset
    // it, and a connect started since may have set it again.
    if (connectInFlight === attempt) {
      connectInFlight = null;
      set({ isConnecting: false });
    }
  }
};

/** `address` is this stored wallet's vault or wallet PDA. */
function namesWallet(wallet: WalletInfo, address: string): boolean {
  return address === wallet.smartWallet || address === wallet.walletPda;
}

/**
 * Shows the built-in chooser (drawn by `LazorKitProvider`, or an app's
 * `<WalletChooser />`) and waits for the user's answer: a candidate's
 * `wallet`, or `null` for none of these.
 */
function openWalletChooser(
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  request: ConfirmWalletRequest,
): Promise<{ wallet: string } | null> {
  if (!hasChooserHost()) {
    // Nothing would ever draw it, and connect would wait forever.
    return Promise.reject(
      new Error(
        'The built-in wallet chooser is drawn by LazorKitProvider, which is not mounted. Mount it, ' +
          "or pass onConfirmWallet (your own chooser, or 'throw').",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const close = () => {
      if (get().pendingWalletConfirmation === pending) set({ pendingWalletConfirmation: null });
    };
    const pending: PendingWalletConfirmation = {
      request,
      resolve: (choice) => {
        close();
        resolve(choice);
      },
      reject: (error) => {
        close();
        reject(error);
      },
    };
    set({ pendingWalletConfirmation: pending });
  });
}

export const disconnectAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
) => {
  set({ isLoading: true });
  try {
    // A connect still running is abandoned (see connectInFlight), so
    // resetting `isConnecting` below cannot let two run side by side.
    connectInFlight?.abort();
    connectInFlight = null;
    forgetCandidates();
    // A chooser still open belongs to the connect just abandoned.
    get().pendingWalletConfirmation?.resolve(null);
    set({ wallet: null, isConnecting: false, pendingWalletConfirmation: null });
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    try {
      const signature = await performPasskeyExecute(get, payload, options);
      return signature;
    } catch (err) {
      logger.error('signAndExecuteTransaction failed:', err, {
        smartWallet: get().wallet?.smartWallet,
        redirectUrl: options.redirectUrl,
      });
      const error = toActionError(err, get);
      throw error;
    }
  });
};

async function performPasskeyExecute(
  get: () => WalletStateClient,
  payload: SignAndSendTransactionPayload,
  options: SignOptions,
): Promise<string> {
  const { connection, wallet, config } = requireWalletAndConnection(get);
  const { client, version } = await buildClient(get);
  const feePayer = await feePayerFor(config, version);

  const walletPda = new PublicKey(wallet!.walletPda);

  return withPasskey(connection, wallet!, async (secp256r1, turn) => {
    const prepared = await client.prepareExecute({
      payer: feePayer,
      walletPda,
      secp256r1,
      instructions: payload.instructions,
    });

    // 'v1' only: the format is decided, and the transaction measured with a
    // worst-case WebAuthn response, before the portal opens.
    const txOptions = payload.transactionOptions;
    const v1: TxV1Decision | undefined =
      txOptions?.txVersion === 'v1'
        ? await planTxV1BeforePrompt({
            paymaster: paymasterFor(config, version),
            options: txOptions,
            payload: payload.instructions,
            execute: 'secp256r1',
            payer: feePayer,
            portalUrl: config.portalUrl,
            draft: (webAuthn) =>
              withComputeUnitLimit(client.finalizeExecute(prepared, webAuthn).instructions, txOptions.computeUnitLimit),
            addressLookupTables: txOptions.addressLookupTableAccounts,
          })
        : undefined;

    const previewBase64Tx = await buildPreviewTransactionBase64({
      connection,
      feePayer,
      instructions: payload.instructions,
      // A v1 transaction is sent without the caller's lookup tables, so its
      // preview is built without them too: the portal then shows every
      // account the passkey approves, not table entries it resolves on chain.
      addressLookupTables: v1?.v1 ? undefined : payload.transactionOptions?.addressLookupTableAccounts,
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

    // Resolves once confirmed; rejects if it failed on chain.
    return sendInstructionsViaPaymaster({
      instructions: executeInstructions,
      connection,
      feePayer,
      config,
      version,
      addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
      feeToken: payload.transactionOptions?.feeToken,
      turn,
      ...(v1 && txOptions
        ? {
            txVersion: 'v1' as const,
            v1: { decision: v1, ...limitsOf(txOptions), minContextSlot: secp256r1.minContextSlot },
          }
        : {}),
    });
  });
}

// ─── Sign Message (portal-only, no on-chain tx) ─────────────────────

export const signMessageAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  message: string,
  options: SignOptions,
): Promise<{ signature: string; signedPayload: string }> => {
  return withSigningState(get, set, options, async () => {
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
      return result;
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('signMessageAction failed:', error);
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
): Promise<{ signature: string; sessionPda: PublicKey }> => {
  return withSigningState(get, set, options, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      if (!params.actions?.length && !params.unrestricted) {
        throw new Error(
          'createSession needs actions. A session with no limits can spend the whole vault ' +
            'through any program until it expires, and its key lives in the app rather than ' +
            'behind the passkey. Pass actions built with serializeActions/Actions, or ' +
            'unrestricted: true to mint one anyway.',
        );
      }

      const { signature, sessionPda } = await withPasskey(connection, wallet!, async (secp256r1, turn) => {
        const prepared = await client.prepareCreateSession({
          payer: feePayer,
          walletPda,
          secp256r1,
          sessionKey: params.sessionKey,
          expiresAt: params.expiresAtSlot,
          ...(params.actions?.length
            ? { actions: params.actions }
            : { unrestricted: true as const }),
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
          version,
          turn,
        });
        return { signature, sessionPda: prepared.sessionPda };
      });
      return { signature, sessionPda };
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('createSessionAction failed:', error);
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      const signature = await withPasskey(connection, wallet!, async (secp256r1, turn) => {
        const prepared = await client.prepareRevokeSession({
          payer: feePayer,
          walletPda,
          secp256r1,
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
        return sendInstructionsViaPaymaster({
          instructions,
          connection,
          feePayer,
          config,
          version,
          turn,
        });
      });
      return signature;
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('revokeSessionAction failed:', error);
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      // The session account's owner says which program it belongs to.
      const version = await versionOfAccount(connection, payload.sessionPda);
      flowVersion = version;
      const client = clientFor(version, connection);
      const feePayer = await feePayerFor(config, version);
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

      // 'v1': no prompt here, so the send decides and measures before the
      // session key signs.
      const txOptions = payload.transactionOptions;
      const signature = await sendInstructionsViaPaymaster({
        instructions: allInstructions,
        connection,
        feePayer,
        config,
        version,
        addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
        feeToken: payload.transactionOptions?.feeToken,
        extraSigners: [payload.sessionKeypair],
        ...(txOptions?.txVersion === 'v1'
          ? { txVersion: 'v1' as const, v1: { ...limitsOf(txOptions), payload: payload.instructions } }
          : {}),
      });
      return signature;
    } catch (err) {
      const error = toActionError(err, get, flowVersion);
      logger.error('signAndSendWithSessionAction failed:', error);
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
): Promise<{ signature: string; newAuthorityPda: PublicKey }> => {
  return withSigningState(get, set, options, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      // v1 has no spending policies, and its Execute never checked rank: any
      // key added to a v1 wallet can move the whole vault. Refuse to pretend
      // otherwise — a policy would be dropped without a word.
      if (version === 1 && params.policy) {
        throw new Error(
          'This wallet is on LazorKit v1, which cannot limit what an added key may spend. ' +
            'Move the wallet to v2 first, or add the key without a policy and unrestricted: true.',
        );
      }
      if (version === 1 && !params.unrestricted) {
        throw new Error(
          'On a LazorKit v1 wallet any added key can spend the whole vault. Pass ' +
            'unrestricted: true to add one anyway, or move the wallet to v2 for bounded keys.',
        );
      }

      const { signature, newAuthorityPda } = await withPasskey(connection, wallet!, async (secp256r1, turn) => {
        const prepared = await client.prepareAddAuthority({
          payer: feePayer,
          walletPda,
          secp256r1,
          newAuthority: {
            type: 'ed25519',
            publicKey: params.newEd25519Pubkey,
          },
          role: params.role ?? ROLE_SPENDER,
          policy: params.policy,
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
          version,
          turn,
        });
        return { signature, newAuthorityPda: prepared.newAuthorityPda };
      });
      return { signature, newAuthorityPda };
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('addAuthorityEd25519Action failed:', error);
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    try {
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      const signature = await withPasskey(connection, wallet!, async (secp256r1, turn) => {
        const prepared = await client.prepareRemoveAuthority({
          payer: feePayer,
          walletPda,
          secp256r1,
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
        return sendInstructionsViaPaymaster({
          instructions,
          connection,
          feePayer,
          config,
          version,
          turn,
        });
      });
      return signature;
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('removeAuthorityAction failed:', error);
      throw error;
    }
  });
};

// ─── Deferred Execution (2-tx: Authorize + ExecuteDeferred) ────────

/**
 * Two-transaction deferred flow. TX1 signs hashes of the instruction set;
 * TX2 executes without needing another signature. Use for payloads too big
 * for a single transaction (Jupiter swaps, multi-CPI batches).
 *
 * The authorization is open for `expiryOffset` slots (default
 * `DEFAULTS.DEFERRED_EXPIRY_SLOTS`), longer than the adapter can wait for TX1.
 * When it has expired anyway, TX2 is not sent (or its 3014 is reported) as
 * `DeferredExpiredError`, with TX1's signature and the account holding the rent.
 */
export const authorizeAndExecuteAction = async (
  get: () => WalletStateClient,
  set: (state: Partial<WalletStateClient>) => void,
  payload: AuthorizeExecutePayload,
  options: SignOptions,
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    try {
      const expiryOffset = deferredExpiryOffset(payload.expiryOffset);
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      const executeSig = await withPasskey(connection, wallet!, async (secp256r1, turn) => {
        const prepared = await client.prepareAuthorize({
          payer: feePayer,
          walletPda,
          secp256r1,
          instructions: payload.instructions,
          expiryOffset,
        });

        // 'v1' only: one format for both transactions, decided before the
        // portal opens, with a v1 TX2 measured exactly.
        const txOptions = payload.transactionOptions;
        const v1 =
          txOptions?.txVersion === 'v1'
            ? await planAuthorizeTxV1({
                client,
                connection,
                version,
                config,
                feePayer,
                prepared,
                instructions: payload.instructions,
                options: txOptions,
              })
            : undefined;

        // What the user approves: the inner instructions, compiled with the
        // lookup tables TX2 is sent with (the payloads this flow exists for
        // are over the packet limit without them). A v1 TX2 is sent without
        // them, and so is its preview, which then lists every account.
        const previewBase64Tx = await buildPreviewTransactionBase64({
          connection,
          feePayer,
          instructions: payload.instructions,
          addressLookupTables: v1?.v1 ? undefined : payload.transactionOptions?.addressLookupTableAccounts,
        });

        const response = await signChallengeViaPortal({
          challenge: prepared.challenge,
          credentialId: wallet!.credentialId,
          portalUrl: config.portalUrl,
          redirectUrl: options.redirectUrl,
          previewBase64Tx,
          clusterSimulation: payload.transactionOptions?.clusterSimulation,
        });

        // TX1: Authorize (finalize also returns deferredPayload for TX2).
        // Confirmed before TX2 is built or sent: TX2 executes the
        // authorization TX1 writes.
        const {
          instructions: authorizeIxs,
          deferredExecPda,
          deferredPayload,
        } = client.finalizeAuthorize(prepared, response);
        const authorizeSignature = await sendInstructionsViaPaymaster({
          instructions: authorizeIxs,
          connection,
          feePayer,
          config,
          version,
          turn,
          ...(v1
            ? {
                txVersion: 'v1' as const,
                v1: { decision: v1, transaction: 'tx1' as const, minContextSlot: secp256r1.minContextSlot },
              }
            : {}),
        });

        // TX2: ExecuteDeferred. It consumes no counter, and the same client
        // built TX1, so the fee accounts it resolves are TX1's (no re-read).
        const { instructions: executeIxs } = await client.executeDeferredFromPayload({
          payer: feePayer,
          deferredPayload,
        });
        // 'v1': TX2's limits are simulated on a node that has TX1 (the lane's
        // floor; TX1 is settled, so this reads nothing over the network).
        const tx2Floor = v1 ? (await turn.challengeReads(connection)).minContextSlot : undefined;

        const tx2Instructions: TransactionInstruction[] = [];
        if (payload.transactionOptions?.computeUnitLimit) {
          tx2Instructions.push(
            ComputeBudgetProgram.setComputeUnitLimit({
              units: payload.transactionOptions.computeUnitLimit,
            }),
          );
        }
        tx2Instructions.push(...executeIxs);

        return executeBeforeExpiry({
          connection,
          deferredExecPda,
          authorizeSignature,
          send: () =>
            sendInstructionsViaPaymaster({
              instructions: tx2Instructions,
              connection,
              feePayer,
              config,
              version,
              addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
              feeToken: payload.transactionOptions?.feeToken,
              ...(v1 && txOptions
                ? {
                    txVersion: 'v1' as const,
                    v1: { decision: v1, transaction: 'tx2' as const, ...limitsOf(txOptions), minContextSlot: tx2Floor },
                  }
                : {}),
            }),
        });
      });
      return executeSig;
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('authorizeAndExecuteAction failed:', error);
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
): Promise<AuthorizeResult> => {
  return withSigningState(get, set, options, async () => {
    try {
      const expiryOffset = deferredExpiryOffset(payload.expiryOffset);
      const { connection, wallet, config } = requireWalletAndConnection(get);
      const { client, version } = await buildClient(get);
      const feePayer = await feePayerFor(config, version);
      const walletPda = new PublicKey(wallet!.walletPda);

      const result = await withPasskey(connection, wallet!, async (secp256r1, turn): Promise<AuthorizeResult> => {
        const prepared = await client.prepareAuthorize({
          payer: feePayer,
          walletPda,
          secp256r1,
          instructions: payload.instructions,
          expiryOffset,
        });

        // 'v1' only: decided before the portal opens, with the TX2 this
        // authorization is for measured too when it is v1.
        const txOptions = payload.transactionOptions;
        const v1 =
          txOptions?.txVersion === 'v1'
            ? await planAuthorizeTxV1({
                client,
                connection,
                version,
                config,
                feePayer,
                prepared,
                instructions: payload.instructions,
                options: txOptions,
              })
            : undefined;

        const previewBase64Tx = await buildPreviewTransactionBase64({
          connection,
          feePayer,
          instructions: payload.instructions,
          // As in authorizeAndExecute: a v1 TX2 goes without the lookup tables.
          addressLookupTables: v1?.v1 ? undefined : payload.transactionOptions?.addressLookupTableAccounts,
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

        // Confirmed before this resolves, so an `executeDeferred` made right
        // after finds the authorization on chain.
        const signature = await sendInstructionsViaPaymaster({
          instructions,
          connection,
          feePayer,
          config,
          version,
          turn,
          ...(v1
            ? {
                txVersion: 'v1' as const,
                v1: { decision: v1, transaction: 'tx1' as const, minContextSlot: secp256r1.minContextSlot },
              }
            : {}),
        });
        return { signature, deferredPayload, deferredExecPda, counter };
      });
      return result;
    } catch (err) {
      const error = toActionError(err, get);
      logger.error('authorizeDeferredAction failed:', error);
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
      const { connection, config } = requireWalletAndConnection(get);
      // A payload may come from anywhere; its authorization account's owner
      // says which program wrote it.
      const version = await versionOfAccount(connection, payload.deferredPayload.deferredExecPda);
      flowVersion = version;
      const client = clientFor(version, connection);
      const feePayer = await feePayerFor(config, version);

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

      // An expired authorization is refused before it is sent, or its 3014
      // reported, as `DeferredExpiredError`. 'v1': no prompt here, so the
      // send decides and measures.
      const txOptions = payload.transactionOptions;
      const signature = await executeBeforeExpiry({
        connection,
        deferredExecPda: payload.deferredPayload.deferredExecPda,
        send: () =>
          sendInstructionsViaPaymaster({
            instructions: allInstructions,
            connection,
            feePayer,
            config,
            version,
            addressLookupTables: payload.transactionOptions?.addressLookupTableAccounts,
            feeToken: payload.transactionOptions?.feeToken,
            ...(txOptions?.txVersion === 'v1'
              ? { txVersion: 'v1' as const, v1: { transaction: 'tx2' as const, ...limitsOf(txOptions) } }
              : {}),
          }),
      });
      return signature;
    } catch (err) {
      const error = toActionError(err, get, flowVersion);
      logger.error('executeDeferredAction failed:', error);
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
): Promise<string> => {
  return withSigningState(get, set, options, async () => {
    // The protocol this flow runs on, from its own account — for error reporting.
    let flowVersion: ProtocolVersion | undefined;
    try {
      const { connection, config } = requireWalletAndConnection(get);
      const version = await versionOfAccount(connection, payload.deferredExecPda);
      flowVersion = version;
      const client = clientFor(version, connection);
      const feePayer = await feePayerFor(config, version);

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
        version,
      });
      return signature;
    } catch (err) {
      const error = toActionError(err, get, flowVersion);
      logger.error('reclaimDeferredAction failed:', error);
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

  // The wallet's own program, and its authority discriminator: 0x22 in v2
  // (the high nibble carries the protocol major), 2 in v1. The header layout —
  // wallet at 16, credential at 48, passkey at 80 — is the same in both.
  const version = versionOf(wallet!);
  const programId = clientFor(version, connection).programId;
  const authorityDisc = version === 1 ? V1_DISC_AUTHORITY : ACCOUNT_DISCRIMINATOR.AUTHORITY;
  const accounts = await connection.getProgramAccounts(programId, {
    encoding: 'base64',
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: Buffer.from([authorityDisc]).toString('base64'),
          encoding: 'base64',
        },
      },
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
): Promise<string> => {
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
  return signAndExecuteTransaction(
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
