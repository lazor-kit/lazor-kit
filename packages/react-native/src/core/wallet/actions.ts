/**
 * LazorKit Wallet Mobile Adapter - Wallet Actions (core)
 *
 * Pure functions that interact with the LazorKit on-chain program via the
 * `LazorKitClient` (non-anchor). No React or Zustand dependencies here.
 */

import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { sha256 } from 'js-sha256';
import {
  BrowserResult,
  ExecuteFinalize,
  SaveWalletOptions,
  TransactionOptions,
  WalletActions,
  WalletConfig,
  WalletInfo,
} from '../../types';
import {
  type ProtocolVersion,
  type WalletFacts,
  type WebAuthnResponse,
  createOwnershipChallenge,
  v2Client,
  verifyOwnershipProof,
  versionOf,
} from '../../program';
import { connectAbandoned, rememberCandidates, takeRememberedCandidate } from './confirmation';
import { keyToCreate, resolveWallet, type PortalProof } from './resolveWallet';
import { API_ENDPOINTS, DEFAULTS } from '../../config';
import { openBrowser } from '../browser/open';
import { handleBrowserResult } from '../browser/parseResult';
import { getFeePayer, signAndExecuteTransaction } from '../paymaster';
import { logger } from '../logger';

/**
 * Factory that returns high-level wallet operations bound to a given
 * Connection and loading-state setter.
 */
export const createWalletActions = (
  connection: Connection,
  setLoading: (isLoading: boolean) => void,
  config: WalletConfig,
): WalletActions => {
  const rpId = config.rpId ?? DEFAULTS.RP_ID;

  // What remembered candidates were read for: a wallet found on one cluster,
  // program or relying party is nothing on another.
  const scope = `${v2Client(connection).programId.toBase58()}|${connection.rpcEndpoint}|${rpId}`;

  /**
   * The wallet the user picked after `connect` threw
   * `WalletNeedsConfirmationError`, if it was one of that error's candidates
   * and is picked within two minutes — without the portal: the candidates came
   * from a proof verified in this app moments ago. `null` when none are
   * remembered; throws when some are and `confirmWallet` names none of them.
   */
  const adoptRemembered = (confirmWallet: string): WalletInfo | null => {
    const remembered = takeRememberedCandidate(scope, confirmWallet);
    return remembered && walletInfoOf(remembered.data, remembered.facts);
  };

  /**
   * The passkey's own wallet: one it is proven to hold a key of, adopted by
   * the SDK's rule or chosen by the user — or, when it has none, a new v2
   * wallet created for it.
   */
  const saveWallet = async (data: WalletInfo, options: SaveWalletOptions = {}): Promise<WalletInfo> => {
    const { redirectUrl, signal } = options;
    /** Stop here once `disconnect` has abandoned this connect. */
    const checkAbandoned = () => {
      if (signal?.aborted) throw connectAbandoned();
    };
    setLoading(true);
    try {
      const credentialIdHash = new Uint8Array(
        sha256.arrayBuffer(Buffer.from(data.credentialId, 'base64'))
      );

      // The key in a redirect is not proof: on Android any app can deliver a
      // deep link into this scheme. So the passkey always signs a challenge
      // chosen here — in the connect reply when the portal does that, else in
      // one more portal trip — and a wallet counts only if that signature
      // verifies against its key. One proof serves both the lookup and a
      // wallet created after it — unless the reply's key is missing or not
      // this passkey's: then creating one takes a second assertion, to
      // recover the key (keyToCreate).
      //
      // The reply's assertion is that proof only if it verifies against some
      // key in play (a candidate's, or the reported one). One that proves
      // nothing — a registration, a challenge encoded some other way — would
      // otherwise fail every connect; it costs one portal sign instead, as on web.
      const reported = { publicKey: new Uint8Array(data.passkeyPubkey) };
      let proof: Promise<PortalProof> | undefined;
      const prove = (candidates: readonly { publicKey: Uint8Array }[] = []) =>
        (proof ??=
          options.proof && verifyOwnershipProof([...candidates, reported], options.proof, rpId).length
            ? Promise.resolve(options.proof)
            : Promise.resolve().then(() => {
                // No second portal trip for a connect nobody waits for.
                checkAbandoned();
                return proveViaPortal({ credentialId: data.credentialId, portalUrl: config.portalUrl, redirectUrl });
              }));

      // A v1 wallet made before LazorKit v2 keeps being used as it is: a fresh
      // v2 wallet would show that user an empty account while their funds sit
      // in the v1 one. Only a passkey that owns neither gets a new, v2, wallet.
      const own = await resolveWallet({
        client: v2Client(connection),
        credentialId: data.credentialId,
        credentialIdHash,
        rpId,
        prove,
        trustedAuthorities: config.trustedAuthorities,
        watchMints: config.watchMints,
        onConfirmWallet: options.onConfirmWallet ?? config.onConfirmWallet ?? 'builtin',
        confirmWallet: options.confirmWallet,
        openChooser: options.openChooser,
        remember: (facts) => rememberCandidates(scope, data, facts),
        // Waiting for the user is not loading. An app that covers its UI
        // while `isLoading` would cover the chooser too, and connect would
        // wait for an answer that cannot be given.
        onAsking: (asking) => setLoading(!asking),
        signal,
      });
      if (own) return walletInfoOf(data, own);
      checkAbandoned();

      const client = v2Client(connection);

      // A new wallet is owned by this key, so it must be the passkey's own
      // before anyone pays to create it: the reported key once the proof
      // verifies against it, else the key recovered from the passkey's
      // assertions (one more portal sign when needed).
      const compressedPubkey = await keyToCreate({
        rpId,
        credentialId: data.credentialId,
        reported: new Uint8Array(data.passkeyPubkey),
        connectProof: options.proof,
        prove: () => prove(),
        signFresh: () =>
          Promise.resolve().then(() => {
            // No further portal trip for a connect nobody waits for.
            checkAbandoned();
            return proveViaPortal({ credentialId: data.credentialId, portalUrl: config.portalUrl, redirectUrl });
          }),
      });

      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );

      // The last moment a disconnect can still stop the creation.
      checkAbandoned();
      const userSeed = new Uint8Array(32);
      crypto.getRandomValues(userSeed);

      const {
        instructions,
        walletPda,
        vaultPda,
        authorityPda,
      } = await client.createWallet({
        payer: feePayer,
        userSeed,
        owner: {
          type: 'secp256r1',
          credentialIdHash,
          compressedPubkey,
          rpId,
        },
      });

      const signature = await sendInstructionsViaPaymaster({
        instructions,
        connection,
        feePayer,
        config,
      });
      if (!signature) {
        logger.error('Create wallet relayer error:', {
          paymasterUrl: config.configPaymaster.paymasterUrl,
        });
        throw new Error('Create wallet relayer error');
      }
      await connection.confirmTransaction(signature, 'confirmed');

      // Saved as created, never looked up again: until its first transaction
      // a lookup would offer it for confirmation like any wallet never signed for.
      return {
        ...data,
        // The key the wallet was created for: the passkey's, which the
        // reported one may not have been.
        passkeyPubkey: Array.from(compressedPubkey),
        smartWallet: vaultPda.toBase58(),
        walletPda: walletPda.toBase58(),
        walletDevice: authorityPda.toBase58(),
        protocolVersion: 2,
      };
    } catch (error) {
      logger.error('SaveWallet action failed:', error, { walletData: data });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Finalizes a prepared passkey signature into the LazorKit Execute
   * instruction and submits it through the paymaster.
   */
  const executeWallet = async (
    data: WalletInfo,
    feePayer: PublicKey,
    finalize: ExecuteFinalize,
    browserResult: BrowserResult,
    transactionOptions?: TransactionOptions,
  ): Promise<string> => {
    setLoading(true);
    try {
      const webAuthnResponse = decodeWebAuthnResponse(browserResult);
      const { instructions } = finalize(webAuthnResponse);

      const allInstructions: TransactionInstruction[] = [];
      if (transactionOptions?.computeUnitLimit) {
        allInstructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: transactionOptions.computeUnitLimit,
          }),
        );
      }
      allInstructions.push(...instructions);

      const alts = transactionOptions?.addressLookupTableAccounts ?? [];
      const signature = await sendInstructionsViaPaymaster({
        instructions: allInstructions,
        connection,
        feePayer,
        config,
        version: versionOf(data),
        addressLookupTables: alts,
        feeToken: transactionOptions?.feeToken,
      });

      await connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } catch (error) {
      logger.error('ExecuteWallet action failed:', error, {
        smartWallet: data.smartWallet,
      });
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      setLoading(false);
    }
  };

  return { saveWallet, adoptRemembered, executeWallet };
};

/** The wallet to save for the passkey of connect reply `data`, from its facts. */
function walletInfoOf(data: WalletInfo, own: WalletFacts): WalletInfo {
  return {
    ...data,
    // The key on chain, which the passkey has been shown to hold.
    passkeyPubkey: Array.from(own.publicKey),
    smartWallet: own.vaultPda.toBase58(),
    walletPda: own.walletPda.toBase58(),
    walletDevice: own.authorityPda.toBase58(),
    protocolVersion: own.version,
  };
}

/**
 * A fresh challenge for an ownership proof. `createOwnershipChallenge` draws
 * from the `crypto` @noble/hashes found when it loaded; in React Native that
 * exists only if react-native-get-random-values ran first, which is up to the
 * app's import order. The polyfilled global is there by now either way.
 */
export function newOwnershipChallenge(): Uint8Array {
  try {
    return createOwnershipChallenge();
  } catch {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge;
  }
}

/**
 * One portal sign over a fresh challenge, as an ownership proof — with the
 * credential the portal says it signed with, when its redirect says.
 */
async function proveViaPortal(params: {
  credentialId: string;
  portalUrl: string;
  redirectUrl?: string;
}): Promise<PortalProof> {
  if (!params.redirectUrl) {
    throw new Error("Proving which wallet is this passkey's needs a redirectUrl for the portal");
  }
  const challenge = newOwnershipChallenge();
  const result = await openPortalSign({
    challenge,
    credentialId: params.credentialId,
    portalUrl: params.portalUrl,
    redirectUrl: params.redirectUrl,
  });
  const response = decodeWebAuthnResponse(result);
  return {
    challenge,
    signature: response.signature,
    authenticatorData: response.authenticatorData,
    clientDataJson: response.clientDataJson,
    signedWith: result.credentialId,
  };
}

// ─── Public helpers (re-used by extended store actions) ────────────

/** Encode raw bytes as base64url (no padding) for URL params and challenges. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Serialize a set of user-facing instructions into a base64 v0 tx for portal preview. */
export async function buildPreviewTransactionBase64(params: {
  connection: Connection;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
}): Promise<string> {
  const { blockhash } = await params.connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: params.feePayer,
    recentBlockhash: blockhash,
    instructions: params.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString('base64');
}

/**
 * Drives the portal round-trip for any passkey-signed operation:
 *   - build challenge URL → open browser
 *   - wait for deep-link redirect
 *   - parse + hash clientDataJSON → return WebAuthnResponse
 */
export async function signChallengeViaPortal(params: PortalSignParams): Promise<WebAuthnResponse> {
  return decodeWebAuthnResponse(await openPortalSign(params));
}

type PortalSignParams = {
  challenge: Uint8Array;
  credentialId: string;
  portalUrl: string;
  redirectUrl: string;
  previewBase64Tx?: string;
  clusterSimulation?: 'devnet' | 'mainnet';
};

/** One portal sign, as its redirect reports it. */
async function openPortalSign(params: PortalSignParams): Promise<BrowserResult> {
  const encodedChallenge = toBase64Url(params.challenge);
  let signUrl = `${params.portalUrl}/${API_ENDPOINTS.SIGN}&message=${encodeURIComponent(
    encodedChallenge,
  )}&credentialId=${encodeURIComponent(params.credentialId)}&redirect_url=${encodeURIComponent(
    params.redirectUrl,
  )}`;

  if (params.previewBase64Tx) {
    signUrl += `&transaction=${encodeURIComponent(params.previewBase64Tx)}`;
  }
  if (params.clusterSimulation) {
    signUrl += `&clusterSimulation=${params.clusterSimulation}`;
  }

  const resultUrl = await openBrowser(signUrl, params.redirectUrl);
  return handleBrowserResult(resultUrl);
}

/**
 * Signs and sends a prebuilt list of instructions through the paymaster.
 * Used by every mutation path (passkey- or session-signed).
 */
/**
 * The paymaster for a wallet's protocol. v1 wallets keep the relayer the app
 * used before v2 (`v1ConfigPaymaster`, defaulting to the main one).
 */
export function paymasterFor(
  config: WalletConfig,
  version: ProtocolVersion,
): { paymasterUrl: string; apiKey?: string } {
  return version === 1
    ? (config.v1ConfigPaymaster ?? config.configPaymaster)
    : config.configPaymaster;
}

export async function sendInstructionsViaPaymaster(params: {
  instructions: TransactionInstruction[];
  connection: Connection;
  feePayer: PublicKey;
  config: WalletConfig;
  /** The protocol of the wallet paying through this transaction. Defaults to 2. */
  version?: ProtocolVersion;
  addressLookupTables?: AddressLookupTableAccount[];
  feeToken?: string;
  /** Optional extra signers (e.g., session Keypair for Ed25519 auth). */
  extraSigners?: Keypair[];
}): Promise<string> {
  const { blockhash } = await params.connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: params.feePayer,
    recentBlockhash: blockhash,
    instructions: params.instructions,
  }).compileToV0Message(params.addressLookupTables ?? []);
  const tx = new VersionedTransaction(msg);

  if (params.extraSigners && params.extraSigners.length > 0) {
    tx.sign(params.extraSigners);
  }

  const serialized = Buffer.from(tx.serialize()).toString('base64');
  const paymaster = paymasterFor(params.config, params.version ?? 2);
  return signAndExecuteTransaction(
    serialized,
    paymaster.paymasterUrl,
    params.feePayer.toBase58(),
    paymaster.apiKey,
    params.feeToken,
  );
}

/** Decode the portal's base64 payload into the WebAuthn shape the client expects. */
export function decodeWebAuthnResponse(result: BrowserResult): WebAuthnResponse {
  const signature = base64ToBytes(result.signature);
  const authenticatorData = base64ToBytes(result.authenticatorDataBase64);
  const clientDataJson = base64ToBytes(result.clientDataJsonBase64);
  const clientDataJsonHash = new Uint8Array(sha256.arrayBuffer(clientDataJson));
  return { signature, authenticatorData, clientDataJsonHash, clientDataJson };
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
