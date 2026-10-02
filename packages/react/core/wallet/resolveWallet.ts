/**
 * A fresh connect: which on-chain wallet a passkey should use when nothing is
 * stored for it yet. Stored wallets and signing never come here.
 *
 * Finding wallets by credential-id hash answers nothing on its own. The hash
 * is public — it sits in every authority account the passkey has touched —
 * and `CreateWallet` / `AddAuthority` / `TransferOwnership` take any owner
 * without that owner's consent, on v1 and v2 alike. So anyone can list a
 * victim's passkey on a wallet they still control, or hand them one whose
 * vault they have already given away. What this module does about it:
 *   1. keeps only the wallets whose stored key the passkey is proven to hold
 *      (the key the portal reported, or an assertion over a challenge chosen
 *      here — sdk-legacy's `verifyOwnershipProof`);
 *   2. describes who else can spend from each (`describeWalletCandidates`),
 *      counting the app's `trustedAuthorities` as its own;
 *   3. adopts one only when sdk-legacy's `pickOwnWallet` does — the one
 *      wallet this passkey has signed for, with nothing untrusted able to
 *      spend from it — and otherwise asks the user (`onConfirmWallet`);
 *   4. creates a v2 wallet only when the passkey is proven to hold none, for
 *      the passkey's own key: the one the portal reports for a passkey it
 *      registered just now, or once an assertion verifies against it — else
 *      the one recovered from two of the passkey's assertions (sdk-legacy's
 *      `resolvePasskeyPublicKey`).
 *
 * One implementation for the store's `connect` and the wallet-adapter's, so
 * the two cannot drift.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
    pickOwnWallet,
    recoverPasskeyPublicKeys,
    resolvePasskeyPublicKey,
    selectWalletByAddress,
    verifyOwnershipProof,
    v2Client,
    type OwnershipProof,
    type PasskeyWalletCandidate,
    type WalletFacts,
} from '../program';
// Domain-separated (`tag || 32 random bytes`), never sdk-legacy's bare 32.
import { createOwnershipChallenge } from '../message/ownershipProof';
import { PortalCancelledError, type DialogManager, type PortalAssertion } from '../portal';
import type { WalletInfo } from '../storage';
import { getCredentialHash, getPasskeyPublicKey, getPortalRpId } from './utils';
import {
    WalletConfirmationDeclinedError,
    WalletNeedsConfirmationError,
    toWalletChoice,
    type OnConfirmWallet,
    type WalletChoice,
} from './confirmation';

/** How long a `'throw'` offer can be confirmed without opening the portal again. */
const OFFER_TTL_MS = 2 * 60 * 1000;

/**
 * The wallets the last `'throw'` connect offered. They were described after a
 * proof in this same JS context, so `connect({ confirmWallet })` may adopt one
 * of them without a second passkey prompt. Kept in memory only.
 */
interface Offer {
    credentialId: string;
    accountName?: string;
    facts: WalletFacts[];
    at: number;
    /** The RPC and relying party they were found with; any other connect starts over. */
    endpoint: string;
    rpId: string;
}
let offer: Offer | null = null;

/** Forget a pending `'throw'` offer — on disconnect, and before any new portal connect. */
export function clearPendingConfirmation(): void {
    offer = null;
}

function rememberOffer(next: Offer): void {
    offer = next;
    setTimeout(() => {
        if (offer === next) offer = null;
    }, OFFER_TTL_MS);
}

/**
 * The wallet `confirmWallet` names among the pending offer's, taking the offer.
 * `null` when there is no live offer for this RPC and portal. Throws when there
 * is one and `confirmWallet` names none of its wallets.
 */
function takeOffer(confirmWallet: string, endpoint: string, rpId: string) {
    const current = offer;
    if (!current) return null;
    if (Date.now() - current.at > OFFER_TTL_MS) {
        offer = null;
        return null;
    }
    if (current.endpoint !== endpoint || current.rpId !== rpId) return null;
    const chosen = selectWalletByAddress(current.facts, confirmWallet);
    if (!chosen) throw notOffered(confirmWallet, current.facts);
    offer = null;
    return { credentialId: current.credentialId, accountName: current.accountName, facts: chosen };
}

/**
 * What a connect rejects with once `disconnect` has abandoned it. The same
 * type as the user closing the portal, so an app treats both as a cancel.
 */
export function connectAbandoned(): PortalCancelledError {
    return new PortalCancelledError('disconnect was called while connecting, so no wallet was connected.');
}

/** A `confirmWallet` (or a chooser's answer) that names none of the wallets offered. Never ignored. */
function notOffered(address: string, offered: WalletFacts[]): Error {
    const vaults = offered.map((f) => f.vaultPda.toBase58());
    return new Error(
        `${address} is not a wallet this passkey is proven to hold, so no wallet was connected. ` +
            (vaults.length
                ? `Pass the vault (or wallet) address of one of: ${vaults.join(', ')}.`
                : 'This passkey holds no wallet that could be confirmed.'),
    );
}

export interface ResolveOwnWalletParams {
    connection: Connection;
    rpId: string;
    /** The passkey's credential id (base64), from the connect reply. */
    credentialId: string;
    /** The public key the portal reported, if any. Only a 33-byte compressed key counts. */
    reportedPubkey?: Uint8Array;
    /**
     * The connect reply's `kind`. `created`: the passkey was registered just
     * now, so the reported key is its own. `asserted`: it signed in, and the
     * reported key came from the portal's storage — not evidence.
     */
    kind?: 'created' | 'asserted';
    /** The assertion the connect reply carried, over the challenge the connect URL asked for. */
    connectProof?: OwnershipProof;
    /**
     * One portal sign over `challenge`, with the connect reply's credential —
     * and the credential the portal says it signed with, when it says.
     * Called at most once per connect for the ownership proof, and once more
     * only to recover the key of a passkey that has no wallet yet.
     */
    signChallenge: (challenge: Uint8Array) => Promise<Omit<OwnershipProof, 'challenge'> & { credentialId?: string }>;
    trustedAuthorities?: readonly string[];
    watchMints?: readonly string[];
    onConfirmWallet?: OnConfirmWallet;
    /** The user's choice, made earlier: a vault or wallet address. */
    confirmWallet?: string;
    /** The SDK's chooser, for `onConfirmWallet: 'builtin'`. */
    chooseWallet: (choices: WalletChoice[]) => Promise<{ wallet: string } | null>;
    /** Kept with a `'throw'` offer, so a later `confirmWallet` connect can report it. */
    accountName?: string;
    /** Aborted by `disconnect`: then nothing is offered or asked any more. */
    signal?: AbortSignal;
}

/** A proven wallet to use, or the key to create one for (the passkey is proven to hold no live wallet). */
export type OwnWallet = { adopt: WalletFacts } | { create: Uint8Array };

/** An ownership proof; from a portal sign, also the credential the portal said it signed with, if it said. */
type PortalProof = OwnershipProof & { readonly signedWith?: string };

/**
 * Steps 2–7 of a fresh connect, after the portal replied: find, prove,
 * describe, pick, confirm — or say which key to create a wallet for.
 */
export async function resolveOwnWallet(p: ResolveOwnWalletParams): Promise<OwnWallet> {
    const reported = p.reportedPubkey?.length === 33 ? p.reportedPubkey : undefined;
    const client = v2Client(p.connection);
    const candidates = await client.findPasskeyWalletCandidates({
        credentialIdHash: getCredentialHash(p.credentialId),
        rpId: p.rpId,
    });

    // At most one proof per connect, shared by the wallet choice and creation:
    // the connect reply's own assertion when it proves anything at all, else
    // one portal sign over a fresh challenge. (Creating a wallet for a passkey
    // whose key the portal cannot report takes one more: see keyToCreate.)
    const provable: { publicKey: Uint8Array }[] = [...candidates];
    if (reported) provable.push({ publicKey: reported });
    let proof: PortalProof | undefined =
        p.connectProof && verifyOwnershipProof(provable, p.connectProof, p.rpId).length
            ? p.connectProof
            : undefined;
    const signFresh = async (): Promise<PortalProof> => {
        const challenge = createOwnershipChallenge();
        const { credentialId: signedWith, ...assertion } = await p.signChallenge(challenge);
        return { challenge, ...assertion, signedWith };
    };
    const prove = async (): Promise<PortalProof> => {
        if (!proof) proof = await signFresh();
        return proof;
    };

    let proven: PasskeyWalletCandidate[] = [];
    if (candidates.length) {
        // The reported key settles which candidates are this passkey's, as it
        // always has on web (the reply is origin-checked) — unless an assertion
        // is in hand, or the portal says it signed in: then the key it reports
        // comes from its own storage and may be another passkey's.
        if (!proof && reported && p.kind !== 'asserted') {
            proven = candidates.filter((c) => bytesEqual(c.publicKey, reported));
        }
        if (!proven.length) proven = verifyOwnershipProof(candidates, await prove(), p.rpId);
    }

    // Always called: it also rejects a malformed trustedAuthorities / watchMints
    // entry. A failed read throws — a connect error, never "no wallet".
    const facts = await client.describeWalletCandidates(proven, {
        trustedKeys: [...(p.trustedAuthorities ?? [])],
        watchMints: [...(p.watchMints ?? [])],
    });

    if (p.confirmWallet) {
        const chosen = selectWalletByAddress(facts, p.confirmWallet);
        if (!chosen) throw notOffered(p.confirmWallet, facts);
        return { adopt: chosen };
    }

    const { adopt, needsConfirmation } = pickOwnWallet(facts);
    if (adopt) return { adopt };
    if (needsConfirmation.length) return { adopt: await confirmWithUser(needsConfirmation, p) };
    return { create: await keyToCreate(p, reported, prove, signFresh) };
}

/** Ask the user which of `offered` is theirs, the way `onConfirmWallet` says. */
async function confirmWithUser(offered: WalletFacts[], p: ResolveOwnWalletParams): Promise<WalletFacts> {
    // Disconnected while the chain was read: no offer that outlives the
    // disconnect, no chooser for a connect nobody waits for.
    if (p.signal?.aborted) throw connectAbandoned();
    const now = Date.now();
    const choices = offered.map((f) => toWalletChoice(f, now));
    const handler = p.onConfirmWallet ?? 'builtin';

    if (handler === 'throw') {
        rememberOffer({
            credentialId: p.credentialId,
            accountName: p.accountName,
            facts: offered,
            at: now,
            endpoint: p.connection.rpcEndpoint,
            rpId: p.rpId,
        });
        throw new WalletNeedsConfirmationError(p.credentialId, choices);
    }

    let answer: { wallet: string } | null;
    if (handler === 'builtin') {
        answer = await p.chooseWallet(choices);
    } else if (typeof handler === 'function') {
        answer = await handler({ credentialId: p.credentialId, candidates: choices });
    } else {
        throw new Error(`onConfirmWallet must be 'builtin', 'throw' or a function, not ${String(handler)}.`);
    }

    if (answer == null) throw new WalletConfirmationDeclinedError();
    if (typeof answer.wallet !== 'string') {
        throw new Error('onConfirmWallet must resolve with { wallet: <vault or wallet address> } or null.');
    }
    const chosen = selectWalletByAddress(offered, answer.wallet);
    if (!chosen) throw notOffered(answer.wallet, offered);
    return chosen;
}

/**
 * The key to create a wallet for. Never one that no assertion from this
 * connect has shown to be the signer's, and never another passkey's: the
 * wallet is created under this credential, and a wallet whose key the passkey
 * does not hold can never sign — whatever reaches its vault is stuck.
 *
 *   - Registered just now (`kind: 'created'`): the reported key, as the
 *     portal's own (origin-checked) reply gives it. No prompt beyond the connect.
 *   - Otherwise the reported key, once the proof verifies against it. The
 *     same one proof the wallet lookup uses, so no prompt beyond today's.
 *   - Otherwise — no key reported, or not this passkey's (the portal reports
 *     one from its own storage, and falls back to another passkey's) — the
 *     key recovered from two of the passkey's assertions over challenges
 *     chosen here: the proof, and the connect reply's assertion or one more
 *     portal sign. That extra sign is the one prompt this costs.
 *
 * A portal sign that names another credential than the connect's made its
 * signature with another passkey, so it settles no key for this one: the
 * connect fails, creating nothing.
 */
async function keyToCreate(
    p: ResolveOwnWalletParams,
    reported: Uint8Array | undefined,
    prove: () => Promise<PortalProof>,
    signFresh: () => Promise<PortalProof>,
): Promise<Uint8Array> {
    if (reported && p.kind === 'created') return reported;
    const proof = await prove();
    refuseOtherPasskey(proof, p.credentialId);
    if (reported && verifyOwnershipProof([{ publicKey: reported }], proof, p.rpId).length) return reported;
    return recoverOwnKey(p, proof, signFresh);
}

/**
 * The passkey's public key, from its assertions: each names its signer up to
 * a few candidate keys, and two over different challenges pin it
 * (`resolvePasskeyPublicKey`). `proof` is the one already made; the connect
 * reply's assertion counts too when it is over the connect challenge. With
 * fewer than two, or two that pin nothing, the portal signs exactly one more
 * fresh challenge, with the connect reply's credential.
 *
 * Which passkey: an assertion names its signer's key, never its credential,
 * so what ties the key to the credential the wallet is created under is the
 * portal's word — the connect reply's assertion (made by the sign-in that
 * gave the credential), or a sign reply that names the credential it signed
 * with (the portal signs with the one the sign URL names, as its only
 * `allowCredentials` entry, and says so). All the assertions share the one
 * key, so one of them tied is enough. With none tied, nothing is created: the
 * key could be another passkey's, and this credential could never sign for it.
 *
 * Trust: the key is whoever made these assertions. Here they come from the
 * portal, and a reply counts only from the portal's origin (DialogManager
 * checks `event.origin`) — the channel the reported key and the credential
 * have always come through, so this trusts the portal no more than before.
 * Throws, creating nothing, when the key still cannot be pinned.
 */
async function recoverOwnKey(
    p: ResolveOwnWalletParams,
    proof: PortalProof,
    signFresh: () => Promise<PortalProof>,
): Promise<Uint8Array> {
    const { rpId, connectProof, credentialId } = p;
    const proofs: PortalProof[] = [];
    if (connectProof && connectProof !== proof && recoverPasskeyPublicKeys(connectProof, rpId).length) {
        proofs.push(connectProof);
    }
    proofs.push(proof);
    const tied = (pr: PortalProof) =>
        pr === connectProof || (pr.signedWith !== undefined && sameCredential(pr.signedWith, credentialId));
    // Another sign would come from the same portal, and name no more.
    if (!proofs.some(tied)) {
        throw new Error(
            "This passkey has no wallet yet, and its public key could not be determined: the portal did not " +
                "report this passkey's key, and did not say which passkey made its signatures, so no key can be " +
                'tied to this one. No wallet was created. Create a new passkey with "Create new account".',
        );
    }
    let key = resolvePasskeyPublicKey(proofs, rpId);
    if (!key) {
        const fresh = await signFresh();
        refuseOtherPasskey(fresh, credentialId);
        proofs.push(fresh);
        key = resolvePasskeyPublicKey(proofs, rpId);
    }
    if (!key) {
        throw new Error(
            "This passkey has no wallet yet, and its public key could not be determined: the portal did not " +
                "report this passkey's key, and its signatures did not pin one. No wallet was created. " +
                'Try again, or create a new passkey with "Create new account".',
        );
    }
    return key;
}

/** Throws when a portal sign says it was made with another passkey than `credentialId`. */
function refuseOtherPasskey(proof: PortalProof, credentialId: string): void {
    if (proof.signedWith === undefined || sameCredential(proof.signedWith, credentialId)) return;
    throw new Error(
        'The portal signed with another passkey than the one that connected, so its signature says nothing ' +
            "about this passkey's key. No wallet was created. Try again.",
    );
}

/** Whether two base64 credential ids are the same credential. */
function sameCredential(a: string, b: string): boolean {
    const x = Buffer.from(a, 'base64');
    return x.length > 0 && bytesEqual(x, Buffer.from(b, 'base64'));
}

/** What `connectFreshWallet` needs of the portal dialog. */
export type PortalDialog = Pick<DialogManager, 'openConnect' | 'openSign' | 'openWalletChoice' | 'destroy'>;

export interface ConnectFreshWalletParams {
    connection: Connection;
    portalUrl: string;
    trustedAuthorities?: readonly string[];
    watchMints?: readonly string[];
    onConfirmWallet?: OnConfirmWallet;
    confirmWallet?: string;
    /** A dialog for the portal; made only when the portal is needed. */
    openPortal: () => PortalDialog;
    /** Create and land a v2 wallet owned by this passkey; resolve with its wallet PDA. */
    createWallet: (owner: {
        credentialIdHash: Uint8Array;
        compressedPubkey: Uint8Array;
        rpId: string;
    }) => Promise<PublicKey>;
    /**
     * Aborted by `disconnect`: the portal or chooser closes at once, and the
     * connect rejects with `connectAbandoned()` instead of offering, creating
     * or returning a wallet.
     */
    signal?: AbortSignal;
}

/**
 * Connect when nothing is stored: take up a pending `'throw'` offer that
 * `confirmWallet` names, or open the portal and resolve the passkey's wallet,
 * creating one when it has none. The caller saves the result — after checking
 * `signal` itself, since a disconnect can land between this returning and the
 * save.
 */
export async function connectFreshWallet(p: ConnectFreshWalletParams): Promise<WalletInfo> {
    const rpId = getPortalRpId(p.portalUrl);
    if (p.signal?.aborted) throw connectAbandoned();
    if (p.confirmWallet) {
        const offered = takeOffer(p.confirmWallet, p.connection.rpcEndpoint, rpId);
        if (offered) return walletInfo(offered.facts, offered.credentialId, offered.accountName);
    }
    clearPendingConfirmation();

    const dialog = p.openPortal();
    const close = () => dialog.destroy();
    p.signal?.addEventListener('abort', close);
    try {
        const challenge = createOwnershipChallenge();
        const reply = await dialog.openConnect({ challenge: toBase64Url(challenge) });
        const own = await resolveOwnWallet({
            connection: p.connection,
            rpId,
            credentialId: reply.credentialId,
            reportedPubkey: reply.publicKey ? getPasskeyPublicKey(reply.publicKey) : undefined,
            kind: reply.kind,
            connectProof: reply.assertion ? { challenge, ...decodeAssertion(reply.assertion) } : undefined,
            signChallenge: async (c) => {
                const signed = await dialog.openSign(toBase64Url(c), '', reply.credentialId);
                return { ...decodeAssertion(signed), credentialId: signed.credentialId };
            },
            trustedAuthorities: p.trustedAuthorities,
            watchMints: p.watchMints,
            onConfirmWallet: p.onConfirmWallet,
            confirmWallet: p.confirmWallet,
            chooseWallet: (choices) => dialog.openWalletChoice(choices),
            accountName: reply.accountName,
            signal: p.signal,
        });
        if (p.signal?.aborted) throw connectAbandoned();
        if ('adopt' in own) return walletInfo(own.adopt, reply.credentialId, reply.accountName);

        // Persisted as created, never looked up again: a wallet this passkey
        // has not signed for yet would come back for confirmation.
        const walletPda = await p.createWallet({
            credentialIdHash: getCredentialHash(reply.credentialId),
            compressedPubkey: own.create,
            rpId,
        });
        // Too late to stop the creation; it is simply not connected. The next
        // connect offers it ("Not used with this passkey yet").
        if (p.signal?.aborted) throw connectAbandoned();
        const [vault] = v2Client(p.connection).findVault(walletPda);
        return {
            ...baseInfo(reply.credentialId, own.create, reply.accountName),
            smartWallet: walletPda.toBase58(),
            vaultPda: vault.toBase58(),
            protocolVersion: 2,
        };
    } catch (error) {
        // Once abandoned, whatever the closed dialog made of it (a
        // PortalCancelledError, the chooser's null) is reported as the abandon.
        throw p.signal?.aborted ? connectAbandoned() : error;
    } finally {
        p.signal?.removeEventListener('abort', close);
        dialog.destroy();
    }
}

function walletInfo(facts: WalletFacts, credentialId: string, accountName?: string): WalletInfo {
    return {
        // The key on chain, which the passkey is proven to hold.
        ...baseInfo(credentialId, facts.publicKey, accountName),
        // smartWallet = walletPda (internal authority account), NOT vaultPda:
        // actions derive the vault from it with the wallet's own protocol.
        smartWallet: facts.walletPda.toBase58(),
        vaultPda: facts.vaultPda.toBase58(),
        protocolVersion: facts.version,
    };
}

function baseInfo(credentialId: string, passkeyPubkey: Uint8Array, accountName?: string) {
    return {
        credentialId,
        passkeyPubkey: Array.from(passkeyPubkey),
        expo: 'web',
        platform: typeof navigator === 'undefined' ? '' : navigator.platform,
        walletDevice: '',
        accountName,
    };
}

/** An assertion in the portal's reply, decoded like a sign reply. */
function decodeAssertion(a: PortalAssertion): Omit<OwnershipProof, 'challenge'> {
    return {
        signature: new Uint8Array(Buffer.from(a.signature, 'base64')),
        authenticatorData: new Uint8Array(Buffer.from(a.authenticatorDataBase64, 'base64')),
        clientDataJson: new Uint8Array(Buffer.from(a.clientDataJsonBase64, 'base64')),
    };
}

/** URL-safe base64 without padding — the portal's challenge format. */
function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
