/**
 * Which on-chain wallet is this passkey's own.
 *
 * Finding wallets by credential-id hash is not enough to answer that. The hash
 * is public — it sits in every authority account the passkey has ever touched —
 * and `CreateWallet`/`AddAuthority` take any owner without that owner's
 * consent. Anyone can therefore create a wallet that lists a victim's
 * credential next to *their own* public key, on v1 or v2, and a wallet picked
 * by hash alone would show the victim an address the attacker can spend from.
 *
 * So a candidate counts only if the passkey is proven to hold its key:
 *   1. its authority is Owner rank and was created for this portal's relying
 *      party (rpIdHash at offset 113 — the same layout in v1 and v2);
 *   2. its stored public key (offset 80) equals the key the portal reported,
 *      or — when the portal reported none, or it matches no candidate — the
 *      passkey signs a fresh challenge and the signature verifies against it.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';
import { ROLE_OWNER, type ProtocolVersion, v1Client, v2Client } from '../program';

export interface OwnedCandidate {
    version: ProtocolVersion;
    walletPda: PublicKey;
    authorityPda: PublicKey;
    /** The compressed secp256r1 key stored on the authority. */
    pubkey: Uint8Array;
}

/** A passkey assertion over a challenge this code chose. */
export interface OwnershipProof {
    challenge: Uint8Array;
    signature: Uint8Array;
    authenticatorData: Uint8Array;
    clientDataJson: Uint8Array;
}

const PUBKEY = [80, 113] as const;
const RP_ID_HASH = [113, 145] as const;

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sha = (bytes: Uint8Array | string) => new Uint8Array(sha256.arrayBuffer(bytes));

/**
 * Owner-rank wallets on either protocol that list this credential under this
 * relying party, v2 first. Not yet proof of anything — see the module doc.
 */
export async function findOwnedCandidates(
    connection: Connection,
    credentialHash: Uint8Array,
    rpId: string,
): Promise<OwnedCandidate[]> {
    const rpIdHash = sha(rpId);
    const out: OwnedCandidate[] = [];
    for (const [version, client] of [[2, v2Client(connection)], [1, v1Client(connection)]] as const) {
        const found = (await client.findWalletsByAuthority(credentialHash, 'secp256r1')).filter(
            (w) => w.role === ROLE_OWNER,
        );
        if (!found.length) continue;
        const infos = await connection.getMultipleAccountsInfo(found.map((w) => w.authorityPda));
        found.forEach((w, i) => {
            const data = infos[i]?.data;
            if (!data || data.length < RP_ID_HASH[1]) return;
            if (!equal(new Uint8Array(data.subarray(...RP_ID_HASH)), rpIdHash)) return;
            out.push({
                version,
                walletPda: w.walletPda,
                authorityPda: w.authorityPda,
                pubkey: new Uint8Array(data.subarray(...PUBKEY)),
            });
        });
    }
    return out;
}

/** The candidates whose stored key the passkey's signature verifies against. */
export function provenCandidates(
    candidates: OwnedCandidate[],
    proof: OwnershipProof,
    rpId: string,
): OwnedCandidate[] {
    // The assertion must be over our challenge and for this relying party —
    // otherwise it proves nothing about now.
    let clientData: { type?: string; challenge?: string };
    try {
        clientData = JSON.parse(Buffer.from(proof.clientDataJson).toString('utf8'));
    } catch {
        return [];
    }
    const expected = Buffer.from(proof.challenge)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    if (clientData.type !== 'webauthn.get' || clientData.challenge !== expected) return [];
    if (!equal(proof.authenticatorData.subarray(0, 32), sha(rpId))) return [];

    const signed = new Uint8Array(proof.authenticatorData.length + 32);
    signed.set(proof.authenticatorData, 0);
    signed.set(sha(proof.clientDataJson), proof.authenticatorData.length);
    const digest = sha(signed);
    return candidates.filter((c) => {
        try {
            return p256.verify(proof.signature, digest, c.pubkey, { lowS: false });
        } catch {
            return false;
        }
    });
}

/**
 * The passkey's own wallet among the candidates, or null when it has none.
 * Asks for a proof signature only when the portal-reported key settles
 * nothing. v2 wins over v1 once both are proven the user's.
 */
export async function chooseOwnWallet(params: {
    candidates: OwnedCandidate[];
    reportedPubkey?: Uint8Array;
    rpId: string;
    prove: () => Promise<OwnershipProof>;
}): Promise<OwnedCandidate | null> {
    const { candidates, reportedPubkey, rpId, prove } = params;
    if (!candidates.length) return null;
    let own = reportedPubkey?.length ? candidates.filter((c) => equal(c.pubkey, reportedPubkey)) : [];
    if (!own.length) own = provenCandidates(candidates, await prove(), rpId);
    return own.find((c) => c.version === 2) ?? own[0] ?? null;
}
