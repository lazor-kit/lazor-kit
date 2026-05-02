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
import { LazorKitClient, readAuthorityPubkey, type WebAuthnResponse } from '../../program';
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
  const client = new LazorKitClient(connection);
  const rpId = config.rpId ?? DEFAULTS.RP_ID;

  /**
   * Ensures the smart wallet exists on-chain, creating it if needed.
   */
  const saveWallet = async (data: WalletInfo): Promise<WalletInfo> => {
    setLoading(true);
    try {
      const credentialIdHash = new Uint8Array(
        sha256.arrayBuffer(Buffer.from(data.credentialId, 'base64'))
      );

      const existing = await client.findWalletsByAuthority(credentialIdHash, 'secp256r1');
      if (existing.length > 0) {
        const [found] = existing;
        // Cross-device recovery: the passkey the portal reported may differ
        // slightly from what was registered on first sign-up (e.g. when the
        // user is authenticating on a secondary device with an iCloud-synced
        // passkey). The on-chain Authority account is the source of truth —
        // read the pubkey from there and persist it so later sign flows never
        // rely on a stale client-side cache.
        let passkeyPubkey = data.passkeyPubkey;
        try {
          const onchainPubkey = await readAuthorityPubkey(connection, found.authorityPda);
          passkeyPubkey = Array.from(onchainPubkey);
        } catch (err) {
          logger.error(
            'Failed to read on-chain passkey pubkey during recovery; falling back to portal-reported bytes',
            err,
            { authorityPda: found.authorityPda.toBase58() },
          );
        }
        return {
          ...data,
          passkeyPubkey,
          smartWallet: found.vaultPda.toBase58(),
          walletPda: found.walletPda.toBase58(),
          walletDevice: found.authorityPda.toBase58(),
        };
      }

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
export async function sendInstructionsViaPaymaster(params: {
  instructions: TransactionInstruction[];
  connection: Connection;
  feePayer: PublicKey;
  config: WalletConfig;
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
  return signAndExecuteTransaction(
    serialized,
    params.config.configPaymaster.paymasterUrl,
    params.feePayer.toBase58(),
    params.config.configPaymaster.apiKey,
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
