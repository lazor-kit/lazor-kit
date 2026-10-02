/**
 * `createLazorkitClient`: the wallet without React. One per page, over the
 * page's one store, which `LazorkitProvider` uses too.
 *
 * A second call with an equivalent config returns the same client. One that
 * changes what decides where funds go or who is trusted (mode, rpId,
 * paymaster, RPC or cluster, portal, trusted keys, watched mints, the review
 * sheet, the screens, `onConfirmWallet`) throws
 * `LazorkitConfigError('reconfigured')`, unless it passes `{ replace: true }`:
 * a widget calling it with a partial config must not switch the relayer,
 * approve every send on the page or settle the wallet chooser.
 */
import type { WalletInfo } from '../storage';
import type { ActionCallbacks, ConnectOptions, DisconnectOptions, SignAndSendPayload, SignMessageOptions, WalletState } from '../types';
import type { SignMessageResult, SignedMessageInput } from '../message/signedMessage';
import { createOwnershipChallenge } from '../message/ownershipProof';
import { LazorkitConfigError } from '../errors';
import { connectAction, signMessageAction } from '../wallet/actions';
import { reportOutcome } from '../wallet/utils';
import { startConditional } from '../embedded/webauthn';
import type { Availability, Step, WalletStatus } from '../embedded/types';
import { configureStore, currentConfig } from './configure';
import { walletStore } from './store';
import { type LazorkitClientConfig, resolveConfig } from './validate';

export interface LazorkitClientState {
    status: WalletStatus;
    step: Step | null;
    /** The vault: the address the user's funds live at (base58). */
    address: string | null;
    wallet: WalletInfo | null;
    error: Error | null;
    availability: Availability;
}

export interface LazorkitClient {
    getState(): LazorkitClientState;
    /** Called on every change of the state; returns the unsubscribe. */
    subscribe(listener: (state: LazorkitClientState) => void): () => void;
    connect(options?: ConnectOptions): Promise<WalletInfo>;
    disconnect(options?: DisconnectOptions): Promise<void>;
    /** Resolves with the signature once the transaction is confirmed. */
    signAndSend(payload: SignAndSendPayload): Promise<string>;
    /** The same as `signAndSend`. */
    signAndSendTransaction(payload: SignAndSendPayload): Promise<string>;
    signMessage(message: SignedMessageInput, options?: SignMessageOptions): Promise<SignMessageResult>;
    /**
     * Embedded: passkey autofill in an `autocomplete="username webauthn"`
     * field. A passkey picked there connects as "Continue with passkey" would.
     * `null` where the browser has no autofill, in portal mode, or while a
     * wallet is connected.
     */
    startAutofill(): { stop(): void } | null;
    /**
     * The 3.x advanced actions (sessions, authorities, deferred execution),
     * unchanged, until their hooks ship in a later 4.x.
     */
    readonly legacy: Pick<
        WalletState,
        | 'createSession'
        | 'revokeSession'
        | 'signAndSendWithSession'
        | 'addAuthority'
        | 'removeAuthority'
        | 'signAndSendWithAuthority'
        | 'authorizeAndExecute'
        | 'authorizeDeferred'
        | 'executeDeferred'
    >;
}

/** `status` from the store's flags: signing beats connecting beats connected. */
export function deriveStatus(state: Pick<WalletState, 'wallet' | 'isConnecting' | 'isSigning'>): WalletStatus {
    if (state.isSigning && state.wallet) return 'signing';
    if (state.isConnecting) return 'connecting';
    if (state.wallet) return 'connected';
    return 'disconnected';
}

export function clientStateOf(state: WalletState): LazorkitClientState {
    return {
        status: deriveStatus(state),
        step: state.step,
        address: state.wallet?.vaultPda ?? null,
        wallet: state.wallet,
        error: state.error,
        availability: state.availability,
    };
}

/** What may not change under a page's existing client without `replace`, compared by content. */
const GUARDED = [
    'mode',
    'rpId',
    'paymasterConfig',
    'v1PaymasterConfig',
    'rpcUrl',
    'cluster',
    'portalUrl',
    'trustedAuthorities',
    'watchMints',
    'confirm',
] as const;
/**
 * The same, compared by identity: JSON drops functions, and these can answer
 * the review sheet (`ui.reviewTransaction`) or the chooser for the user.
 */
const GUARDED_BY_IDENTITY = ['ui', 'onConfirmWallet'] as const;

let client: LazorkitClient | null = null;
/** The last client state handed out, so `getState` is stable between changes (for `useSyncExternalStore`). */
let lastState: { from: WalletState; state: LazorkitClientState } | null = null;

function stateOf(store: WalletState): LazorkitClientState {
    if (lastState?.from === store) return lastState.state;
    const state = clientStateOf(store);
    lastState = { from: store, state };
    return state;
}

/** Connect with a passkey already picked in autofill (not on the public store: only `startAutofill` makes one). */
function connectPicked(assertion: Parameters<typeof connectAction>[3]): Promise<WalletInfo> {
    const { getState, setState } = walletStore;
    return reportOutcome(undefined, () => connectAction(getState, setState, undefined, assertion));
}

/** The page's client, over the store as it is configured now. */
export function getLazorkitClient(): LazorkitClient {
    if (client) return client;
    const store = walletStore;
    client = {
        getState: () => stateOf(store.getState()),
        subscribe: (listener) => store.subscribe((state) => listener(stateOf(state))),
        connect: (options) => store.getState().connect(options),
        disconnect: (options) => store.getState().disconnect(options),
        signAndSend: (payload) => store.getState().signAndSendTransaction(payload),
        signAndSendTransaction: (payload) => store.getState().signAndSendTransaction(payload),
        signMessage: (message, options) =>
            typeof message === 'string'
                ? store.getState().signMessage(message, options)
                : reportOutcome(options, () => signMessageAction(store.getState, store.setState, message)),
        startAutofill: () => {
            const { config, wallet, isConnecting } = store.getState();
            if (config.mode !== 'embedded' || wallet || isConnecting) return null;
            const challenge = createOwnershipChallenge();
            return startConditional(config, {
                rpId: config.rpId!,
                challenge,
                onAssertion: (assertion) => {
                    void connectPicked({ assertion, challenge }).catch(() => {
                        // Reported through the store's `error`, as any connect is.
                    });
                },
            });
        },
        legacy: {
            createSession: (p) => store.getState().createSession(p),
            revokeSession: (p) => store.getState().revokeSession(p),
            signAndSendWithSession: (p) => store.getState().signAndSendWithSession(p),
            addAuthority: (p) => store.getState().addAuthority(p),
            removeAuthority: (pda, o) => store.getState().removeAuthority(pda, o),
            signAndSendWithAuthority: (p) => store.getState().signAndSendWithAuthority(p),
            authorizeAndExecute: (p) => store.getState().authorizeAndExecute(p),
            authorizeDeferred: (p) => store.getState().authorizeDeferred(p),
            executeDeferred: (p) => store.getState().executeDeferred(p),
        },
    };
    return client;
}

/**
 * The page's wallet client, configured with `config` (the provider's props,
 * without `children`). Throws `LazorkitConfigError` for a static mistake (see
 * `resolveConfig`), and `'reconfigured'` when the page is already configured
 * differently and `replace` is not set.
 */
export function createLazorkitClient(config: LazorkitClientConfig, options: { replace?: boolean } = {}): LazorkitClient {
    const resolved = resolveConfig(config);
    const current = currentConfig();
    if (current && !options.replace) {
        const changed: string[] = [
            ...GUARDED.filter((key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(resolved[key] ?? null)),
            ...GUARDED_BY_IDENTITY.filter((key) => (current[key] ?? null) !== (resolved[key] ?? null)),
        ];
        if (changed.length) {
            throw new LazorkitConfigError(
                'reconfigured',
                `This page's wallet is already configured with another ${changed.join(', ')}. There is one wallet per ` +
                    'page: reuse its client (getLazorkitClient(), useLazorkitClient()), or pass { replace: true } to ' +
                    'reconfigure it on purpose.',
            );
        }
    }
    configureStore(resolved);
    return getLazorkitClient();
}

/** The callbacks every action takes, for apps that call the client directly. */
export type { ActionCallbacks };
