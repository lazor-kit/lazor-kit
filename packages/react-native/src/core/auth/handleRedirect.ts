/**
 * LazorKit Wallet Mobile Adapter - Auth Redirect Handler
 *
 * Responsible for parsing the passkey authentication redirect coming back
 * from the LazorKit portal and converting it into a WalletInfo object.
 */

import { WalletInfo } from '../../types';
import type { OwnershipProof } from '../../program';
import { logger } from '../logger';
import { portalErrorOf } from '../browser/parseResult';
import { Buffer } from 'buffer';

/**
 * Parses the authentication redirect URL and returns wallet data.
 *
 * @param url - Redirect URL provided by the portal after passkey auth.
 * @returns WalletInfo or null when validation fails.
 * @throws the portal's own error, when it reported one (`error=<text>`).
 */
export const handleAuthRedirect = (url: string): WalletInfo | null => {
  const portalError = portalErrorOf(url);
  if (portalError) throw portalError;
  try {
    const parsed = new URL(url);
    let passkeyPubkey: number[];
    // Basic validation
    if (parsed.searchParams.get('success') !== 'true') {
      logger.error('Auth redirect failed: success parameter is not true', { url });
      return null;
    }
    if (!parsed.searchParams.get('credentialId')) {
      logger.error('Auth redirect failed: missing credentialId', { url });
      return null;
    }

    if (!parsed.searchParams.get('publicKey')) {
      passkeyPubkey = []
    } else {
      passkeyPubkey = Array.from(
        Buffer.from(parsed.searchParams.get('publicKey') || '', 'base64')
      );
    }

    return {
      credentialId: parsed.searchParams.get('credentialId') || '',
      passkeyPubkey,
      expo: parsed.searchParams.get('expo') || '',
      platform: parsed.searchParams.get('platform') || '',
      smartWallet: '',
      walletPda: '',
      walletDevice: '',
    };
  } catch (err) {
    logger.error('Failed to parse redirect URL:', err, { url });
    return null;
  }
};

/**
 * The assertion a connect reply carries when the portal signed the
 * `challenge` the connect URL asked for — the same fields, base64 like a sign
 * reply's — as an ownership proof over that challenge. `undefined` when the
 * reply has none (a portal that ignores the parameter).
 *
 * Whatever the reply says about itself (`kind`, the reported key) is not
 * trusted: on Android any app can send a deep link into this scheme. Only
 * `verifyOwnershipProof` decides what this proves.
 */
export const readConnectAssertion = (url: string, challenge: Uint8Array): OwnershipProof | undefined => {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  const signature = params.get('signature');
  const clientDataJson = params.get('clientDataJSONReturn');
  const authenticatorData = params.get('authenticatorDataReturn');
  if (!signature || !clientDataJson || !authenticatorData) return undefined;
  return {
    challenge,
    signature: new Uint8Array(Buffer.from(signature, 'base64')),
    authenticatorData: new Uint8Array(Buffer.from(authenticatorData, 'base64')),
    clientDataJson: new Uint8Array(Buffer.from(clientDataJson, 'base64')),
  };
};
