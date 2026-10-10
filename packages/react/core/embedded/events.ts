/**
 * The provider's `onEvent`: one call per thing worth counting (see
 * `LazorkitEvent`). What the app's handler throws is logged and changes
 * nothing.
 */
import type { WalletConfig } from '../storage';
import type { CeremonyKind, LazorkitEvent } from './types';

export function emit(config: Pick<WalletConfig, 'onEvent'> | undefined, event: LazorkitEvent): void {
    const handler = config?.onEvent;
    if (!handler) return;
    try {
        handler(event);
    } catch (error) {
        console.error('[LazorKit] onEvent threw:', error);
    }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The outcome a ceremony's error reports as. */
function outcomeOf(error: unknown): 'not-allowed' | 'invalid-state' | 'error' {
    const name = (error as { name?: unknown })?.name;
    if (name === 'NotAllowedError') return 'not-allowed';
    if (name === 'InvalidStateError') return 'invalid-state';
    return 'error';
}

/** Runs one WebAuthn call, reporting its start and its end (outcome, duration). */
export async function ceremony<T>(
    config: Pick<WalletConfig, 'onEvent'> | undefined,
    kind: CeremonyKind,
    run: () => Promise<T>,
): Promise<T> {
    emit(config, { type: 'ceremony', kind, phase: 'start' });
    const started = now();
    try {
        const result = await run();
        emit(config, { type: 'ceremony', kind, phase: 'end', outcome: 'ok', ms: now() - started });
        return result;
    } catch (error) {
        emit(config, { type: 'ceremony', kind, phase: 'end', outcome: outcomeOf(error), ms: now() - started });
        throw error;
    }
}

/** Runs one screen the user acts on, reporting when it opens and closes. */
export async function screen<T>(
    config: Pick<WalletConfig, 'onEvent'> | undefined,
    name: 'no-passkey' | 'choose-wallet' | 'review-transaction',
    run: () => Promise<T>,
): Promise<T> {
    emit(config, { type: 'screen', name, phase: 'open' });
    try {
        return await run();
    } finally {
        emit(config, { type: 'screen', name, phase: 'close' });
    }
}
