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
  TransactionOptions,
  WalletActions,
  WalletConfig,
  WalletInfo,
} from '../../types';
import {
  type ProtocolVersion,
  type WebAuthnResponse,
  clientFor,
  v2Client,
  versionOf,
} from '../../program';
import { chooseOwnWallet, findOwnedCandidates } from './ownership';
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

  /**
   * Ensures the smart wallet exists on-chain, creating it if needed.
   */
  const saveWallet = async (data: WalletInfo, redirectUrl?: string): Promise<WalletInfo> => {
    setLoading(true);
    try {
      const credentialIdHash = new Uint8Array(
        sha256.arrayBuffer(Buffer.from(data.credentialId, 'base64'))
      );

      // Where this passkey's wallet lives — proven, not guessed from the public
      // credential hash (see ./ownership). A v1 wallet made before LazorKit v2
      // keeps being used as it is: a fresh v2 wallet would show that user an
      // empty account while their funds sit in the v1 one. Only a passkey that
      // owns neither gets a new, v2, wallet.
      const reported = new Uint8Array(data.passkeyPubkey ?? []);
      const own = await chooseOwnWallet({
        candidates: await findOwnedCandidates(connection, credentialIdHash, rpId),
        reportedPubkey: reported.length === 33 ? reported : undefined,
        rpId,
        prove: async () => {
          if (!redirectUrl) {
            throw new Error('Proving which wallet is this passkey\'s needs a redirectUrl for the portal');
          }
          const challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
          const response = await signChallengeViaPortal({
            challenge,
            credentialId: data.credentialId,
            portalUrl: config.portalUrl,
            redirectUrl,
          });
          return {
            challenge,
            signature: response.signature,
            authenticatorData: response.authenticatorData,
            clientDataJson: response.clientDataJson,
          };
        },
      });
      if (own) {
        const client = clientFor(own.version, connection);
        const [vault] = client.findVault(own.walletPda);
        return {
          ...data,
          // The key on chain, which the passkey has just been shown to hold.
          passkeyPubkey: Array.from(own.pubkey),
          smartWallet: vault.toBase58(),
          walletPda: own.walletPda.toBase58(),
          walletDevice: own.authorityPda.toBase58(),
          protocolVersion: own.version,
        };
      }
      const client = v2Client(connection);

      const compressedPubkey = new Uint8Array(data.passkeyPubkey);
      if (compressedPubkey.length !== 33) {
        throw new Error(
          `Unexpected passkey pubkey length: ${compressedPubkey.length}, expected 33 bytes (compressed secp256r1)`,
        );
      }

      const feePayer = await getFeePayer(
        config.configPaymaster.paymasterUrl,
        config.configPaymaster.apiKey,
      );

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

      return {
        ...data,
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

  return { saveWallet, executeWallet };
};

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
export async function signChallengeViaPortal(params: {
  challenge: Uint8Array;
  credentialId: string;
  portalUrl: string;
  redirectUrl: string;
  previewBase64Tx?: string;
  clusterSimulation?: 'devnet' | 'mainnet';
}): Promise<WebAuthnResponse> {
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
  const browserResult = handleBrowserResult(resultUrl);
  return decodeWebAuthnResponse(browserResult);
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
