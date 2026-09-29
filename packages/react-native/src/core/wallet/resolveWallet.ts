/**
 * Which on-chain wallet is this passkey's own — or none yet.
 *
 * Finding wallets by credential-id hash is not enough to answer that. The hash
 * is public (it sits in every authority account the passkey has touched), and
 * `CreateWallet` / `AddAuthority` / `TransferOwnership` take any key without
 * its owner's consent, on v1 and v2 alike. So anyone can list a victim's
 * credential beside their own key, add the victim's real passkey to a wallet
 * they still spend from, or hand the passkey a wallet they have already
 * rigged. The rule for what is adopted without asking the user lives in
 * `@lazorkit/sdk-legacy` (`pickOwnWallet`); this is the wallet adapter's side
 * of it: prove, describe, pick, and ask the user when the pick is not clear.
 *
 * Only for a fresh connect. A stored wallet, or a sign action, never comes
 * through here.
 */
import {
  pickOwnWallet,
  recoverPasskeyPublicKeys,
  resolvePasskeyPublicKey,
  selectWalletByAddress,
  verifyOwnershipProof,
  type LazorKitClient,
  type OwnershipProof,
  type WalletFacts,
} from '@lazorkit/sdk-legacy';
import {
  type ConfirmWalletHandler,
  type ConfirmWalletRequest,
  type OnConfirmWallet,
  WalletConfirmationDeclinedError,
  WalletNeedsConfirmationError,
} from '../../types';
import { toWalletChoice } from './walletChoice';
import { connectAbandoned, notOffered } from './confirmation';

export interface ResolveWalletParams {
  /** The v2 client for the cluster; it also scans the v1 deployment paired with it. */
  client: Pick<LazorKitClient, 'findPasskeyWalletCandidates' | 'describeWalletCandidates'>;
  credentialId: string;
  credentialIdHash: Uint8Array;
  rpId: string;
  /**
   * The passkey's assertion over a challenge chosen here. Asked for only when
   * there are candidates to prove, and told which, so that an assertion the
   * connect reply carried is used only if it proves something. The caller
   * keeps it for creating a wallet, so the passkey signs at most once per
   * connect.
   */
  prove: (candidates: readonly { publicKey: Uint8Array }[]) => Promise<OwnershipProof>;
  trustedAuthorities?: readonly string[];
  watchMints?: readonly string[];
  onConfirmWallet: OnConfirmWallet;
  /** The user's pick, by vault or wallet PDA. It must be a proven wallet. */
  confirmWallet?: string;
  /** Draws the built-in chooser (`onConfirmWallet: 'builtin'`). */
  openChooser?: (request: ConfirmWalletRequest) => Promise<{ wallet: string } | null>;
  /** Keeps the candidates for a later `confirmWallet` (`onConfirmWallet: 'throw'`). */
  remember?: (facts: WalletFacts[]) => void;
  /**
   * Told when the wait for the user's answer starts (`true`) and ends
   * (`false`). That wait has no time limit.
   */
  onAsking?: (asking: boolean) => void;
  /**
   * Aborted by `disconnect`: then nothing is remembered or asked any more,
   * and this rejects with `PortalCancelledError`.
   */
  signal?: AbortSignal;
}

/**
 * The passkey's wallet, or `null` when it has no live wallet it is proven to
 * hold a key of — create one then.
 *
 * Throws, never guesses: an RPC failure while describing the wallets is an
 * error, not "no wallet"; a `confirmWallet` that is not a proven wallet is an
 * error, not ignored; the user choosing none is
 * `WalletConfirmationDeclinedError`.
 */
export async function resolveWallet(params: ResolveWalletParams): Promise<WalletFacts | null> {
  const { client, credentialId, credentialIdHash, rpId, confirmWallet } = params;

  const candidates = await client.findPasskeyWalletCandidates({ credentialIdHash, rpId });
  // The hash is public; a candidate counts only if the passkey just signed
  // our challenge with the key stored on it.
  const proven = candidates.length ? verifyOwnershipProof(candidates, await params.prove(candidates), rpId) : [];
  // Always called, with no candidates too: it also rejects a malformed
  // trustedAuthorities / watchMints entry, so a bad config fails every fresh
  // connect instead of only a returning user's. A failed read throws — a
  // connect error, never "no wallet".
  const facts = await client.describeWalletCandidates(proven, {
    trustedKeys: [...(params.trustedAuthorities ?? [])],
    watchMints: [...(params.watchMints ?? [])],
  });

  if (confirmWallet !== undefined) {
    const chosen = selectWalletByAddress(facts, confirmWallet);
    if (!chosen) throw notOffered(confirmWallet, facts);
    return chosen;
  }

  // None proven, or all of them dead (a migrated v1 wallet leaves authorities behind).
  if (!facts.length) return null;

  const { adopt, needsConfirmation } = pickOwnWallet(facts);
  if (adopt) return adopt;

  // Disconnected while the chain was read: no candidates that outlive the
  // disconnect, no chooser for a connect nobody waits for.
  if (params.signal?.aborted) throw connectAbandoned();
  const request: ConfirmWalletRequest = {
    credentialId,
    candidates: needsConfirmation.map((f) => toWalletChoice(f)),
  };
  const handler = params.onConfirmWallet;
  if (handler === 'throw') {
    params.remember?.(needsConfirmation);
    throw new WalletNeedsConfirmationError(credentialId, request.candidates);
  }
  let ask: ConfirmWalletHandler;
  if (handler === 'builtin') {
    if (!params.openChooser) {
      throw new Error('No built-in wallet chooser is available here; pass onConfirmWallet.');
    }
    ask = params.openChooser;
  } else {
    ask = handler;
  }
  let answer: { wallet: string } | null;
  params.onAsking?.(true);
  try {
    answer = await ask(request);
  } finally {
    params.onAsking?.(false);
  }
  // `disconnect` closes the chooser with no answer; that is not the user declining.
  if (params.signal?.aborted) throw connectAbandoned();
  if (!answer) throw new WalletConfirmationDeclinedError();
  if (typeof answer.wallet !== 'string') {
    throw new Error('onConfirmWallet must resolve with { wallet: <vault or wallet address> } or null.');
  }
  const chosen = selectWalletByAddress(needsConfirmation, answer.wallet);
  if (!chosen) throw notOffered(answer.wallet, needsConfirmation);
  return chosen;
}

export interface KeyToCreateParams {
  rpId: string;
  /** The key the connect reply reported, if any (not evidence: any app can send that deep link on Android). */
  reported?: Uint8Array;
  /** The assertion the connect reply carried, over the connect URL's challenge, if any. */
  connectProof?: OwnershipProof;
  /** The connect's ownership proof — the same one the wallet lookup used, made now if it was not needed there. */
  prove: () => Promise<OwnershipProof>;
  /** One more portal sign over a fresh challenge, with the connect reply's credential. */
  signFresh: () => Promise<OwnershipProof>;
}

/**
 * The key to create a wallet for, once the passkey is proven to hold none.
 * Never a key that no assertion from this connect verifies against: a wallet
 * for a key the passkey does not hold can never sign, and whatever reaches
 * its vault is stuck.
 *
 *   - The reported key, when the proof verifies against it: the same one
 *     proof the lookup uses, so no prompt beyond what a connect costs today.
 *   - Otherwise — no key reported (a sign-in on another device), or not this
 *     passkey's (a portal that answers with a key from its own storage, even
 *     another passkey's) — the key recovered from two of the passkey's
 *     assertions over challenges chosen here (sdk-legacy's
 *     `resolvePasskeyPublicKey`): the proof, and the connect reply's
 *     assertion when it is over the connect challenge. With fewer than two,
 *     or two that pin nothing, the portal signs exactly one more fresh
 *     challenge; that sign is the one extra prompt this costs.
 *
 * Throws, creating nothing, when the key still cannot be pinned.
 *
 * Trust: a recovered key is whoever made these assertions. They come back in
 * redirects, like the reported key and the proof, over challenges chosen here
 * and sent only in the portal URL opened in the browser: an app that merely
 * fires a deep link into the redirect scheme cannot sign them. One that can
 * also receive the scheme's links (Android lets several apps claim a custom
 * scheme) sees the portal's redirects and their challenges, and could answer
 * in its place — the same trust the reported-key check has always placed in
 * the redirect. Recovery adds none.
 */
export async function keyToCreate(params: KeyToCreateParams): Promise<Uint8Array> {
  const { rpId, reported, connectProof } = params;
  const proof = await params.prove();
  if (reported?.length === 33 && verifyOwnershipProof([{ publicKey: reported }], proof, rpId).length) {
    return reported;
  }
  const proofs: OwnershipProof[] = [];
  if (connectProof && connectProof !== proof && recoverPasskeyPublicKeys(connectProof, rpId).length) {
    proofs.push(connectProof);
  }
  proofs.push(proof);
  let key = resolvePasskeyPublicKey(proofs, rpId);
  if (!key) {
    proofs.push(await params.signFresh());
    key = resolvePasskeyPublicKey(proofs, rpId);
  }
  if (!key) {
    throw new Error(
      "This passkey has no wallet yet, and its public key could not be determined: the portal did not report " +
        "this passkey's key, and its signatures did not pin one. Nothing was created.",
    );
  }
  return key;
}
