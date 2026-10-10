/**
 * Whether passkeys can work on the page for a config. Kept apart from the
 * store, so connect can ask without importing it.
 */
import type { WalletConfig } from '../storage';
import type { Availability } from '../embedded/types';
import { hasWebAuthn } from '../embedded/webauthn';
import { LazorkitConfigError } from '../errors';
import { isIpAddress, validateRpId, warnOnce } from './validate';

/**
 * Whether passkeys can work on this page for `config`, and why not. Portal
 * mode is always `'ok'` here (the portal's own page runs the ceremony).
 * Warns once when the rpId is a parent of the page's host, or unrelated to it.
 */
export function pageAvailability(config: WalletConfig): { availability: Availability; problem?: LazorkitConfigError } {
    if (config.mode !== 'embedded' || typeof location === 'undefined') return { availability: 'ok' };
    const host = location.hostname;
    if (isIpAddress(host)) {
        return {
            availability: 'misconfigured',
            problem: new LazorkitConfigError(
                'ip-host',
                `A passkey needs a domain, not an IP address. Open this page as https://localhost${location.port ? `:${location.port}` : ''} or a real host name.`,
            ),
        };
    }
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
        return {
            availability: 'misconfigured',
            problem: new LazorkitConfigError('insecure-context', 'Passkeys need https (or http://localhost).'),
        };
    }
    const relation = validateRpId(config.rpId!, host);
    if (relation.ok && relation.warning) warnOnce(relation.warning);
    if (!hasWebAuthn()) return { availability: 'unavailable' };
    return { availability: 'ok' };
}
