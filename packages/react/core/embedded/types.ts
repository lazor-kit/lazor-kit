/**
 * Types shared by Embedded mode, the store and the Easy API. Types only, so
 * any module can import them without a cycle.
 */
import type { WalletChoice } from '../wallet/confirmation';

/** What `useWallet().status` says, derived from the store's flags. */
export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'signing';

/**
 * The fine-grained phase of the call that is running, for a button's label
 * (see `useWalletStatus`). `null` when nothing runs.
 */
export type Step =
    | 'checking-passkey'
    | 'no-passkey'
    | 'creating-passkey'
    | 'other-device'
    | 'finding-wallet'
    | 'choose-wallet'
    | 'one-more-check'
    | 'creating-wallet'
    | 'reviewing'
    | 'preparing'
    | 'awaiting-passkey'
    | 'submitted';

/**
 * Whether passkeys can work on this page: `'unavailable'` (no WebAuthn here,
 * e.g. an in-app browser view), `'misconfigured'` (an IP address, plain http).
 */
export type Availability = 'ok' | 'unavailable' | 'misconfigured';

/** How a connect ended up with its wallet. */
export type ConnectHow = 'restored' | 'created' | 'adopted' | 'confirmed' | 'recovered';

/** Which WebAuthn call a ceremony is. */
export type CeremonyKind =
    | 'get'
    | 'get:immediate'
    | 'get:hybrid'
    | 'get:autofill'
    | 'get:recover'
    | 'get:sign'
    | 'get:message'
    | 'create';

/**
 * @experimental What the SDK reports to the provider's `onEvent`: each passkey
 * ceremony (start, then end with its outcome and duration), each sheet the
 * user has to act on, how a connect ended, and each transaction once it is
 * submitted and once it is confirmed. For metrics; the shape may change
 * before 4.0 is final.
 */
export type LazorkitEvent =
    | { type: 'ceremony'; kind: CeremonyKind; phase: 'start' }
    | {
          type: 'ceremony';
          kind: CeremonyKind;
          phase: 'end';
          outcome: 'ok' | 'not-allowed' | 'invalid-state' | 'error';
          ms: number;
      }
    | { type: 'screen'; name: 'no-passkey' | 'choose-wallet' | 'review-transaction'; phase: 'open' | 'close' }
    | { type: 'connected'; how: ConnectHow; signatures: string[] }
    | { type: 'submitted' | 'confirmed'; signature: string };

/** One line of the review sheet. Plain text: rendered with `textContent` only. */
export interface TxReviewRow {
    kind:
        | 'transfer'
        | 'token-transfer'
        | 'create-token-account'
        | 'compute-budget'
        | 'memo'
        | 'gives-control'
        | 'unrecognized';
    /** The line itself, e.g. "Send 0.5 SOL to 9xQe…". */
    text: string;
    /** Full addresses and other details, shown expanded on request. */
    details?: string[];
    /** A warning about this line, e.g. the recipient is not a token account of this mint. */
    warning?: string;
    /** The line hands someone else control of the vault or its tokens. */
    danger?: boolean;
    /** Shown muted (compute budget). */
    muted?: boolean;
}

/** What the review sheet shows before a passkey signs (D14). */
export interface TxReview {
    appName: string;
    rows: TxReviewRow[];
    simulation:
        | { status: 'ok'; balanceChange?: string }
        | { status: 'failed'; reason: string }
        | { status: 'skipped'; reason: string };
    /** "Network fee: paid by <appName>". */
    feeLine: string;
}

/**
 * The screens Embedded mode shows. The built-in implementation draws them as
 * DOM `<dialog>`s with stable `data-lk` hooks; an app can pass its own
 * (`ui` in `createLazorkitClient`). Each returns once the user acts.
 */
export interface EmbeddedUi {
    /**
     * No passkey was returned (none here, or the sheet was closed: the browser
     * does not say which). `notice`: `'exists'` after the authenticator said
     * it already holds one of this app's passkeys; `'wallet-failed'` after the
     * passkey was created but its wallet was not (offer `'retry-wallet'`).
     */
    noPasskey(ctx: {
        appName: string;
        suggestedName: string;
        notice?: 'exists' | 'wallet-failed';
    }): Promise<
        | { action: 'create'; name: string }
        | { action: 'other-device' }
        | { action: 'not-now' }
        | { action: 'retry-wallet' }
    >;
    /** What is happening now, for a sheet that is still open; `null` clears it. */
    progress(step: 'creating-passkey' | 'other-device' | 'finding-wallet' | 'one-more-check' | 'creating-wallet' | null): void;
    /** "Is this your wallet?": the chosen wallet's address, or `null` for none. */
    chooseWallet(choices: WalletChoice[]): Promise<{ wallet: string } | null>;
    /** The review sheet: `true` to approve. */
    reviewTransaction(review: TxReview): Promise<boolean>;
    /** Close whatever is open. */
    close(): void;
}
