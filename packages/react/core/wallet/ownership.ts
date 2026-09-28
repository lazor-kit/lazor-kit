/**
 * Which on-chain wallet is this passkey's own.
 *
 * Finding wallets by credential-id hash is not enough to answer that. The hash
 * is public — it sits in every authority account the passkey has ever touched —
 * and `CreateWallet`/`AddAuthority` take any owner without that owner's
 * consent, on v1 and v2 alike. So anyone can:
 *   - create a wallet listing a victim's credential next to *their own* key, or
 *   - create a wallet of their own and add the victim's real passkey to it as
 *     a second Owner, keeping their own Owner, an Admin, a session or a pending
 *     deferred execution to spend with.
 * Either would show the victim an address the attacker can drain.
 *
 * So a wallet is adopted automatically only when:
 *   1. its authority for this credential is Owner rank, created for this
 *      portal's relying party, and stores the key the passkey is proven to
 *      hold (the portal-reported key, or a fresh signature over our challenge);
 *   2. that passkey is the wallet's ONLY authority, and nothing else can spend
 *      from it — no live session, no unexpired deferred execution.
 * A proven wallet that others can also spend from is never adopted silently:
 * the app must confirm it (`confirmWallet`), because on chain an authority the
 * user added and one an attacker added look the same.
 *
 * Offsets are the same in v1 and v2: authority — type@1, role@2, wallet@16,
 * credential@48, pubkey@80, rpIdHash@113; session — wallet@8, expires_at@72;
 * deferred execution — wallet@72, expires_at@168.
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

/**
 * The passkey holds these wallets' keys, but other keys can spend from each of
 * them too. Adopting one needs the app to confirm it: call connect again with
 * `confirmWallet` set to the chosen wallet's address.
 */
export class WalletNeedsConfirmationError extends Error {
    constructor(
        readonly candidates: {
            wallet: string;
            version: ProtocolVersion;
            /** Authorities on the wallet besides this passkey. */
            otherAuthorities: number;
            liveSessions: number;
            pendingDeferred: number;
        }[],
    ) {
        super(
            'This passkey is on a wallet that other keys can also spend from. On chain, a key you ' +
                'added looks the same as one someone else added, so it is not adopted automatically. ' +
                'Confirm the wallet (connect with confirmWallet) if you recognise it.',
        );
        this.name = 'WalletNeedsConfirmationError';
    }
}

const DISC = {
    2: { authority: 0x22, session: 0x23, deferred: 0x24 },
    1: { authority: 2, session: 3, deferred: 4 },
} as const;

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sha = (bytes: Uint8Array | string) => new Uint8Array(sha256.arrayBuffer(bytes));
/** A memcmp filter in base64, which needs no base58 codec. */
const memcmp = (offset: number, bytes: Uint8Array) => ({
    memcmp: { offset, bytes: Buffer.from(bytes).toString('base64'), encoding: 'base64' as const },
});

/**
 * Owner-rank passkey authorities, on either protocol, that name this credential
 * under this relying party — read straight from `getProgramAccounts` with both
 * filters, so there is no second fetch to overflow however many exist. Not yet
 * proof of anything — see the module doc.
 */
export async function findOwnedCandidates(
    connection: Connection,
    credentialHash: Uint8Array,
    rpId: string,
): Promise<OwnedCandidate[]> {
    const out: OwnedCandidate[] = [];
    for (const [version, client] of [[2, v2Client(connection)], [1, v1Client(connection)]] as const) {
        const found = await connection.getProgramAccounts(client.programId, {
            filters: [
                memcmp(0, Uint8Array.from([DISC[version].authority, 1])),
                memcmp(48, credentialHash),
                memcmp(113, sha(rpId)),
            ],
        });
        for (const { pubkey, account } of found) {
            const data = account.data;
            if (data.length < 145 || data[2] !== ROLE_OWNER) continue;
            out.push({
                version,
                walletPda: new PublicKey(data.subarray(16, 48)),
                authorityPda: pubkey,
                pubkey: new Uint8Array(data.subarray(80, 113)),
            });
        }
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

/** Who else can spend from a wallet: its other authorities, live sessions, pending deferred executions. */
async function othersOn(
    connection: Connection,
    candidate: OwnedCandidate,
    slot: bigint,
): Promise<{ otherAuthorities: number; liveSessions: number; pendingDeferred: number }> {
    const program = candidate.version === 2 ? v2Client(connection).programId : v1Client(connection).programId;
    const disc = DISC[candidate.version];
    const wallet = candidate.walletPda.toBytes();
    const scan = (d: number, walletOffset: number) =>
        connection.getProgramAccounts(program, {
            filters: [memcmp(0, Uint8Array.from([d])), memcmp(walletOffset, wallet)],
        });
    const expiresAt = (data: Buffer, offset: number) =>
        data.length >= offset + 8 ? data.readBigUInt64LE(offset) : 0n;
    const [authorities, sessions, deferred] = await Promise.all([
        scan(disc.authority, 16),
        scan(disc.session, 8),
        scan(disc.deferred, 72),
    ]);
    return {
        otherAuthorities: authorities.filter((a) => !a.pubkey.equals(candidate.authorityPda)).length,
        liveSessions: sessions.filter((x) => expiresAt(x.account.data, 72) > slot).length,
        pendingDeferred: deferred.filter((x) => expiresAt(x.account.data, 168) > slot).length,
    };
}

/**
 * The passkey's own wallet among the candidates, or null when it has none.
 *
 * Asks for a proof signature only when the portal-reported key settles
 * nothing (`trustReportedKey: false` always asks). Of the wallets the passkey
 * is proven to hold, one it controls alone is adopted — a live v1 wallet ahead
 * of a v2 one (a v1 wallet still standing has not been migrated, so the funds
 * are there), then the one with the most SOL. A wallet others can also spend
 * from is adopted only when `confirmWallet` names it; otherwise this throws
 * `WalletNeedsConfirmationError`.
 */
export async function chooseOwnWallet(params: {
    connection: Connection;
    candidates: OwnedCandidate[];
    reportedPubkey?: Uint8Array;
    trustReportedKey?: boolean;
    rpId: string;
    prove: () => Promise<OwnershipProof>;
    confirmWallet?: string;
}): Promise<OwnedCandidate | null> {
    const { connection, candidates, reportedPubkey, rpId, prove, confirmWallet } = params;
    if (!candidates.length) return null;
    const trust = params.trustReportedKey ?? true;
    let proven =
        trust && reportedPubkey?.length ? candidates.filter((c) => equal(c.pubkey, reportedPubkey)) : [];
    if (!proven.length) proven = provenCandidates(candidates, await prove(), rpId);
    if (!proven.length) return null;

    const slot = BigInt(await connection.getSlot());
    const assessed = await Promise.all(
        proven.map(async (c) => ({ c, others: await othersOn(connection, c, slot) })),
    );
    const confirmed = confirmWallet && assessed.find((a) => a.c.walletPda.toBase58() === confirmWallet);
    if (confirmed) return confirmed.c;

    const alone = assessed.filter(
        (a) => !a.others.otherAuthorities && !a.others.liveSessions && !a.others.pendingDeferred,
    );
    if (alone.length) {
        const balances = await connection.getMultipleAccountsInfo(
            alone.map((a) =>
                (a.c.version === 2 ? v2Client(connection) : v1Client(connection)).findVault(a.c.walletPda)[0],
            ),
        );
        const ranked = alone
            .map((a, i) => ({ c: a.c, lamports: balances[i]?.lamports ?? 0 }))
            .sort((x, y) => (x.c.version !== y.c.version ? x.c.version - y.c.version : y.lamports - x.lamports));
        return ranked[0]!.c;
    }
    throw new WalletNeedsConfirmationError(
        assessed.map((a) => ({ wallet: a.c.walletPda.toBase58(), version: a.c.version, ...a.others })),
    );
}
