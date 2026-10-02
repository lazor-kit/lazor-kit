/**
 * The provider's and `createLazorkitClient`'s configuration: what it takes,
 * what a mistake in it throws at mount, and which stored wallets it restores.
 *
 * Static mistakes (no `mode`, a malformed `rpId`, Embedded on mainnet with
 * LazorKit's relayer) throw `LazorkitConfigError` as soon as the config is
 * read. Problems with the page itself (an IP address, plain http, no
 * WebAuthn) do not crash the app: they show as `availability` and as the
 * error `connect()` rejects with (see ./configure).
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { DEFAULTS } from '../../config';
import { LazorkitConfigError, type LazorkitConfigProblem } from '../errors';
import type { PaymasterConfig } from '../paymaster/paymaster';
import {
    LazorKitClient,
    PROGRAM_ID_DEVNET,
    PROGRAM_ID_MAINNET,
    legacyProgramIdFor,
} from '../program';
import type { WalletConfig, WalletInfo } from '../storage';
import type { OnConfirmWallet } from '../wallet/confirmation';
import type { EmbeddedUi, LazorkitEvent } from '../embedded/types';

interface CommonOptions {
    rpcUrl?: string;
    /**
     * Which cluster `rpcUrl` serves, when its URL does not say. Also the
     * cluster the review sheet simulates on (Embedded).
     */
    cluster?: 'mainnet' | 'devnet';
    /**
     * The relayer that pays fees (and, in Embedded mode, wallet rent) for v2
     * wallets. Embedded on mainnet requires your own (D11).
     */
    paymasterConfig?: PaymasterConfig;
    /** The relayer for wallets still on LazorKit v1. Defaults to `paymasterConfig`. */
    v1PaymasterConfig?: PaymasterConfig;
    /** How `connect` asks the user to confirm a wallet it will not adopt on its own (as in 3.x). */
    onConfirmWallet?: OnConfirmWallet;
    /** Your own Ed25519 keys (base58), as in 3.x. */
    trustedAuthorities?: string[];
    /** SPL Token mints your app receives (base58), as in 3.x. */
    watchMints?: string[];
    /** Where the SDK keeps the session and authority keys it generates, as in 3.x. */
    keyStorage?: 'auto' | 'memory';
    /** @experimental Instrumentation: ceremonies, screens, outcomes (see `LazorkitEvent`). */
    onEvent?: (event: LazorkitEvent) => void;
}

/**
 * Embedded mode: the passkey lives on your app's own `rpId`, and every
 * ceremony runs in your page. Wallets are not shared with portal apps.
 */
export interface EmbeddedOptions extends CommonOptions {
    mode: 'embedded';
    /**
     * The relying party: this page's host name, or a registrable parent of it
     * (`example.com` for `app.example.com`), in canonical form (lowercase
     * ASCII, punycode for an IDN, no trailing dot). Not an IP; `localhost` is
     * fine in development. Permanent: every passkey and wallet is bound to it,
     * so write it as a constant, never from `location`.
     */
    rpId: string;
    /** Your app's name: passkeys are named "<appName> · <short vault>", and sheets show it. */
    appName: string;
    /** Show the review sheet before every Easy `signAndSend` (default `true`). */
    confirm?: boolean;
    /** Reserved for "remember this device" (M7). Passing it logs a warning and does nothing. */
    session?: undefined;
    portalUrl?: never;
}

/** Portal mode: the hosted LazorKit portal runs every ceremony, as in 3.x. */
export interface PortalOptions extends CommonOptions {
    mode: 'portal';
    portalUrl?: string;
    rpId?: never;
    appName?: never;
    confirm?: never;
    session?: never;
}

/** The provider's props without `children`, and `createLazorkitClient`'s config. No default mode (D1). */
export type LazorkitOptions = EmbeddedOptions | PortalOptions;

/** `createLazorkitClient`'s config: the provider's props, plus Embedded screens of your own. */
export type LazorkitClientConfig = (EmbeddedOptions & { ui?: EmbeddedUi }) | (PortalOptions & { ui?: never });

const fail = (problem: LazorkitConfigProblem, message: string): never => {
    throw new LazorkitConfigError(problem, message);
};

const isIPv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
/** An IP address, v4 or v6 (bracketed or not). */
export const isIpAddress = (host: string) => isIPv4(host) || host.includes(':') || host.startsWith('[');
export const isLocalhost = (host: string) => host === 'localhost' || host.endsWith('.localhost');

export type RpIdCheck =
    | { ok: true; warning?: string }
    | { ok: false; problem: 'bad-rp-id' | 'ip-rp-id'; message: string };

/**
 * Whether `rpId` can be an Embedded relying party, and, given the page's
 * `hostname`, whether this page can use it. Syntax only, plus the relation to
 * the host: the browser enforces the registrable-domain rule itself (its
 * refusal is `LazorkitConfigError('rp-id-refused')`).
 */
export function validateRpId(rpId: string, hostname?: string): RpIdCheck {
    if (typeof rpId !== 'string' || rpId.length === 0) {
        return { ok: false, problem: 'bad-rp-id', message: 'rpId is a bare host name, e.g. app.example.com.' };
    }
    if (rpId.includes('://') || /[\s/?#@\\]/.test(rpId) || /^[^:]+:\d+$/.test(rpId)) {
        return {
            ok: false,
            problem: 'bad-rp-id',
            message: `rpId "${rpId}" is not a bare host name: no scheme, port, path or user. Use e.g. app.example.com.`,
        };
    }
    if (isIpAddress(rpId)) {
        return { ok: false, problem: 'ip-rp-id', message: `rpId "${rpId}" is an IP address. A passkey needs a domain name.` };
    }
    let canonical: string;
    try {
        canonical = new URL(`https://${rpId}`).hostname;
    } catch {
        return { ok: false, problem: 'bad-rp-id', message: `rpId "${rpId}" is not a host name.` };
    }
    if (canonical !== rpId || rpId.endsWith('.')) {
        // The rpId's bytes are hashed into the wallet's Owner when it is
        // created, and every signature must carry the same hash: a form the
        // browser or a password manager would normalise could leave a wallet
        // that never signs.
        return {
            ok: false,
            problem: 'bad-rp-id',
            message: `rpId "${rpId}" is not in canonical form. Use "${canonical.replace(/\.$/, '')}": lowercase ASCII (punycode for an international name), with no trailing dot.`,
        };
    }
    if (hostname === undefined || hostname === rpId) return { ok: true };
    if (hostname.endsWith(`.${rpId}`)) {
        return {
            ok: true,
            warning:
                `rpId ${rpId} is a parent of ${hostname}: every subdomain of ${rpId} can sign for every wallet. ` +
                'Use the page\'s own host unless that is intended.',
        };
    }
    return {
        ok: true,
        warning:
            `rpId ${rpId} is not this page's host (${hostname}) or a parent of it. It works only if ` +
            `https://${rpId}/.well-known/webauthn lists this origin (Related Origins).`,
    };
}

/** The v2 program the config's cluster runs: `cluster` if given, else what the RPC URL says, else mainnet. */
export function v2ProgramIdFor(rpcUrl: string | undefined, cluster: 'mainnet' | 'devnet' | undefined): PublicKey {
    if (cluster) return cluster === 'devnet' ? PROGRAM_ID_DEVNET : PROGRAM_ID_MAINNET;
    try {
        return new LazorKitClient(new Connection(rpcUrl || DEFAULTS.RPC_ENDPOINT)).programId;
    } catch {
        return PROGRAM_ID_MAINNET;
    }
}

/** The v2 and v1 program ids of the config's cluster: the only programs an Embedded record may name. */
export function programIdsFor(config: Pick<WalletConfig, 'rpcUrl' | 'cluster'>): string[] {
    const v2 = v2ProgramIdFor(config.rpcUrl, config.cluster);
    return [v2.toBase58(), legacyProgramIdFor(v2).toBase58()];
}

const warned = new Set<string>();
/** A configuration warning, once per page. */
export function warnOnce(message: string): void {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`[LazorKit] ${message}`);
}

/**
 * The store's config for these options. Throws `LazorkitConfigError` for a
 * static mistake: no `mode`; Embedded without `rpId` or `appName`, or with a
 * malformed or IP `rpId`; Embedded on mainnet without the app's own
 * `paymasterConfig` (D11), or on a `localhost` rpId.
 */
export function resolveConfig(options: LazorkitClientConfig): WalletConfig {
    const input = (options ?? {}) as CommonOptions & {
        mode?: unknown;
        rpId?: string;
        appName?: string;
        confirm?: boolean;
        session?: unknown;
        portalUrl?: string;
        ui?: EmbeddedUi;
    };
    if (input.mode !== 'embedded' && input.mode !== 'portal') {
        fail(
            'no-mode',
            'LazorkitProvider needs mode="embedded" or mode="portal". 3.x apps: add mode="portal" to keep existing wallets.',
        );
    }
    const rpcUrl = input.rpcUrl || DEFAULTS.RPC_ENDPOINT;
    const paymasterConfig = input.paymasterConfig ?? { paymasterUrl: DEFAULTS.PAYMASTER_URL };
    const common = {
        paymasterConfig,
        v1PaymasterConfig: input.v1PaymasterConfig,
        rpcUrl,
        cluster: input.cluster,
        onConfirmWallet: input.onConfirmWallet,
        trustedAuthorities: input.trustedAuthorities,
        watchMints: input.watchMints,
        keyStorage: input.keyStorage ?? 'auto',
        onEvent: input.onEvent,
    };
    if (input.mode === 'portal') {
        return { mode: 'portal', portalUrl: input.portalUrl || DEFAULTS.PORTAL_URL, ...common };
    }

    if (!input.rpId) fail('no-rp-id', 'mode="embedded" needs rpId: this page\'s host name, e.g. rpId="app.example.com".');
    if (!input.appName || typeof input.appName !== 'string') {
        fail('no-app-name', 'mode="embedded" needs appName: your app\'s name, as passkeys and sheets show it.');
    }
    const rpId = input.rpId as string;
    const syntax = validateRpId(rpId);
    if (!syntax.ok) fail(syntax.problem, syntax.message);

    const mainnet = v2ProgramIdFor(rpcUrl, input.cluster).equals(PROGRAM_ID_MAINNET);
    if (mainnet && !input.paymasterConfig) {
        fail(
            'mainnet-paymaster',
            'On mainnet, embedded mode needs your own paymaster (paymasterConfig). The LazorKit relayer is for devnet ' +
                'and testing. (A devnet app on an RPC URL that does not say devnet: pass cluster="devnet".)',
        );
    }
    if (mainnet && isLocalhost(rpId)) {
        fail(
            'localhost-mainnet',
            `rpId "${rpId}" on mainnet: every local dev server on every port shares it and could ask for signatures. ` +
                'Use your app\'s domain.',
        );
    }
    if (mainnet && /(^|\.)lazorkit\.com$/i.test(hostOf(paymasterConfig.paymasterUrl))) {
        warnOnce('paymasterConfig points at a LazorKit relayer on mainnet. Embedded production apps pay rent through their own relayer (D11).');
    }
    if (input.session !== undefined) {
        warnOnce('The session prop is reserved for "remember this device" (a later 4.x release). It does nothing yet.');
    }
    return {
        mode: 'embedded',
        rpId,
        appName: input.appName as string,
        confirm: input.confirm ?? true,
        ui: input.ui,
        portalUrl: DEFAULTS.PORTAL_URL,
        ...common,
    };
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/**
 * A stored wallet record this config may restore, or null. Embedded: only a
 * record Embedded mode wrote, for this rpId, on this cluster's v1 or v2
 * program. Portal: anything but an Embedded record (portal records carry no
 * mode, as before).
 */
export function acceptStoredWallet(record: unknown, config: WalletConfig, programIds: string[]): WalletInfo | null {
    const r = record as Partial<WalletInfo> | null | undefined;
    if (!r || typeof r !== 'object' || typeof r.smartWallet !== 'string' || typeof r.credentialId !== 'string') return null;
    if (config.mode === 'embedded') {
        return r.mode === 'embedded' && r.rpId === config.rpId && typeof r.programId === 'string' && programIds.includes(r.programId)
            ? (r as WalletInfo)
            : null;
    }
    return r.mode === 'embedded' ? null : (r as WalletInfo);
}

/**
 * Two configs are the same: every value equal (objects and lists by
 * content), every function the same function.
 */
export function sameConfig(a: object, b: object): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const x = (a as Record<string, unknown>)[key];
        const y = (b as Record<string, unknown>)[key];
        if (x === y) continue;
        if (typeof x === 'function' || typeof y === 'function' || holdsFunctions(x) || holdsFunctions(y)) return false;
        if (JSON.stringify(x) !== JSON.stringify(y)) return false;
    }
    return true;
}

/** An object with methods (an `EmbeddedUi`): compared by identity, as JSON cannot see them. */
const holdsFunctions = (value: unknown) =>
    typeof value === 'object' && value !== null && Object.values(value).some((v) => typeof v === 'function');
