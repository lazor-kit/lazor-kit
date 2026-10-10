/**
 * Embedded mode's stand-in for the portal dialog: the same methods the
 * actions call (`openSign`, `openApproval`, `openSignMessage`,
 * `openWalletChoice`, `destroy`), done with WebAuthn in the app's own page. The actions do not
 * change between modes; `createDialogManager` picks this or the portal's
 * `DialogManager` by `config.mode`.
 *
 * Every signature is a `get()` pinned to the connected passkey
 * (`allowCredentials` = its credential), and returns what a portal sign
 * returns: the 64-byte low-S r ‖ s, clientDataJSON, authenticatorData,
 * `signedPayload` = authenticatorData ‖ SHA-256(clientDataJSON), and the
 * credential that signed. A reply from another credential is refused
 * (`PasskeyMismatchError`); a closed sheet is `UserRejectedError`.
 */
import type { ApprovalRequest } from '@lazorkit/sdk-legacy/approval';
import type { SignResult } from '../portal';
import type { WalletConfig } from '../storage';
import type { WalletChoice } from '../wallet/confirmation';
import { UserRejectedError } from '../errors';
import { isSignedMessageClientData, signedMessageChallenge, type SignedMessageInput } from '../message/signedMessage';
import { screen } from './events';
import { builtinEmbeddedUi } from './sheets';
import type { CeremonyKind, EmbeddedUi, TxReview } from './types';
import { type Assertion, assertPinned, derToLowS, fromB64, fromB64Url, isDomError, sha256Bytes, toB64 } from './webauthn';

/** The UI a config uses: the app's own, or the SDK's sheets. */
export function embeddedUiFor(config: WalletConfig): EmbeddedUi {
    return config.ui ?? builtinEmbeddedUi();
}

/** An assertion as a portal sign reply has it. */
export function signResultOf(assertion: Assertion): SignResult {
    const signedPayload = new Uint8Array(assertion.authenticatorData.length + 32);
    signedPayload.set(assertion.authenticatorData, 0);
    signedPayload.set(sha256Bytes(assertion.clientDataJson), assertion.authenticatorData.length);
    return {
        signature: toB64(derToLowS(assertion.signature)),
        clientDataJsonBase64: toB64(assertion.clientDataJson),
        authenticatorDataBase64: toB64(assertion.authenticatorData),
        signedPayload: toB64(signedPayload),
        credentialId: toB64(assertion.rawId),
    };
}

/** A ceremony's refusal as the SDK reports it: a closed sheet, or a disconnect, is the user's (or app's) no. */
export function rejectionOf(error: unknown): unknown {
    if (isDomError(error, 'NotAllowedError')) return new UserRejectedError('passkey-closed');
    if (isDomError(error, 'AbortError')) return new UserRejectedError('abandoned');
    return error;
}

export class EmbeddedPrompt {
    private readonly controller = new AbortController();

    constructor(private readonly config: WalletConfig) {}

    /**
     * The passkey signs `challenge` (base64url, a challenge a LazorKit client
     * computed). The preview transaction and simulation cluster the portal
     * takes are not used: Embedded mode's review runs before the challenge
     * exists (see ../embedded/review).
     */
    async openSign(
        challenge: string,
        _transaction: string,
        credentialId: string,
        _clusterSimulation?: 'devnet' | 'mainnet',
    ): Promise<SignResult> {
        return signResultOf(await this.pinned('get:sign', fromB64Url(challenge), credentialId));
    }

    /**
     * A typed approval (CreateSession, RevokeSession, RemoveAuthority): the
     * passkey signs `challenge`, the one prepared with `request`, at the
     * prepared slot and counter. With no portal there is no `typed` block in
     * the reply, so the action checks the signature against the request
     * itself (`bindingForReply` → `verifyApprovalReply`) exactly as it checks
     * a portal's, and finalizes with what it prepared. The request is not
     * shown yet: Embedded mode has no review sheet for these three.
     */
    async openApproval(challenge: string, credentialId: string, _request: ApprovalRequest): Promise<SignResult> {
        return this.openSign(challenge, '', credentialId);
    }

    /**
     * The passkey signs `signedMessageChallenge(message)`, never the message's
     * bytes: the 3.3 format, which `verifyWalletMessage` checks.
     */
    async openSignMessage(message: SignedMessageInput, credentialId: string): Promise<SignResult> {
        const result = signResultOf(await this.pinned('get:message', signedMessageChallenge(message), credentialId));
        if (!isSignedMessageClientData(result.clientDataJsonBase64, message)) {
            throw new Error('The passkey did not sign this message: its reply is over another challenge.');
        }
        return result;
    }

    /** The wallet chooser ("Is this your wallet?"). */
    openWalletChoice(choices: WalletChoice[]): Promise<{ wallet: string } | null> {
        return screen(this.config, 'choose-wallet', () => embeddedUiFor(this.config).chooseWallet(choices));
    }

    /** The review sheet (D14): `true` to approve. */
    reviewTransaction(review: TxReview): Promise<boolean> {
        return screen(this.config, 'review-transaction', () => embeddedUiFor(this.config).reviewTransaction(review));
    }

    /** Aborts a ceremony still open. */
    destroy(): void {
        this.controller.abort();
    }

    private async pinned(kind: CeremonyKind, challenge: Uint8Array, credentialId: string): Promise<Assertion> {
        try {
            return await assertPinned(this.config, kind, {
                rpId: this.config.rpId!,
                challenge,
                credentialId: fromB64(credentialId),
                signal: this.controller.signal,
            });
        } catch (error) {
            throw rejectionOf(error);
        }
    }
}
