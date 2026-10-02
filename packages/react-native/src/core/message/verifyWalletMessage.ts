/**
 * Which wallet signed a message: `verifySignedMessage` with the passkey's key
 * read from the chain, never taken from the client.
 *
 * Keep this file the same in @lazorkit/wallet and
 * @lazorkit/wallet-mobile-adapter, except for the `../program` import path.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
import { LazorKitClient, PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET, v2Client } from '../../program';
import { isSignedMessageClientData, verifySignedMessage, type VerifySignedMessageParams } from './signedMessage';

export interface VerifyWalletMessageParams extends Omit<VerifySignedMessageParams, 'publicKey' | 'rpId'> {
    /** A connection to the cluster the wallet lives on. */
    readonly connection: Connection;
    /** The wallet the signer claims: its vault address, or its wallet PDA (`smartWallet`). */
    readonly wallet: string | PublicKey;
    /** The passkey's credential id, base64, as `wallet.credentialId`. */
    readonly credentialId: string;
    /**
     * The relying party the passkey was created under, e.g. `portal.lazor.sh`
     * (the portal's hostname). The authority stores its hash, and the
     * signature's authenticatorData must carry it.
     */
    readonly rpId: string;
    /**
     * The cluster, for a connection whose URL does not say (an app's own
     * proxy, most keyed provider URLs). Without it the program is picked as
     * the SDK picks it for `connection`: a cluster pinned with
     * `registerCluster`, else what the URL says, else mainnet.
     */
    readonly cluster?: 'mainnet' | 'devnet';
}

/**
 * Whether `wallet` signed `message`: `true` only when the passkey signature
 * verifies (as `verifySignedMessage` checks it, `rpId` included) against the
 * key stored on chain in an Owner authority of `wallet` for `credentialId`,
 * created under `rpId`, on LazorKit v2 or v1, and `wallet`'s account still
 * exists. A key the client sends is never used, so a signature by any other
 * passkey is `false`, whatever wallet it names.
 *
 * Reads the chain: one `getProgramAccounts` per program (as connect does,
 * which some RPC providers rate-limit or refuse; use an endpoint that allows
 * it) and one `getAccountInfo`. Rejects when the chain cannot be read; treat
 * that as not verified. Malformed input is `false`.
 */
export async function verifyWalletMessage(params: VerifyWalletMessageParams): Promise<boolean> {
    let claimed: PublicKey;
    let credentialIdHash: Uint8Array;
    try {
        claimed = new PublicKey(params.wallet);
        const rawId = Buffer.from(params.credentialId, 'base64');
        if (rawId.length === 0 || typeof params.rpId !== 'string' || !params.rpId) return false;
        credentialIdHash = new Uint8Array(sha256.arrayBuffer(rawId));
        // Nothing to look up for a reply that is not over this message.
        if (!isSignedMessageClientData(params.clientDataJsonBase64, params.message)) return false;
    } catch {
        return false;
    }

    const { connection, rpId, cluster } = params;
    const client = cluster
        ? new LazorKitClient(connection, cluster === 'devnet' ? PROGRAM_ID_DEVNET : PROGRAM_ID_MAINNET)
        : v2Client(connection);
    const candidates = await client.findPasskeyWalletCandidates({ credentialIdHash, rpId });
    for (const candidate of candidates) {
        if (!candidate.walletPda.equals(claimed) && !candidate.vaultPda.equals(claimed)) continue;
        const verified = verifySignedMessage({
            message: params.message,
            signature: params.signature,
            clientDataJsonBase64: params.clientDataJsonBase64,
            authenticatorDataBase64: params.authenticatorDataBase64,
            signedPayload: params.signedPayload,
            origin: params.origin,
            publicKey: candidate.publicKey,
            rpId,
        });
        if (!verified) continue;
        // A migrated v1 wallet is closed but can leave its authorities behind.
        const account = await connection.getAccountInfo(candidate.walletPda);
        if (account && account.owner.equals(candidate.programId)) return true;
    }
    return false;
}
