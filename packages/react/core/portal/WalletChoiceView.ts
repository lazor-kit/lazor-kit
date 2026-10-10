/**
 * The SDK's wallet chooser: what `connect` shows when it will not adopt a
 * wallet on its own (see core/wallet/resolveWallet). Drawn by
 * `DialogManager.openWalletChoice` inside the portal dialog's shell, and by
 * Embedded mode's own sheet (core/embedded/sheets), with the same copy.
 *
 * Rules the wording follows:
 * - Rows come in the order given, which is not a recommendation (balances can
 *   be topped up by anyone). Nothing is pre-selected, and no row is called
 *   verified, safe or recommended: the SDK cannot see everything a former
 *   holder of a wallet may have left on its vault.
 * - Only untrusted items are listed under "Also controlled by"; the app's
 *   `trustedAuthorities` are its own.
 * - A vault handed to another program is a warning of its own, and its row
 *   has no "Use this wallet" button (an app can still pass it as
 *   `confirmWallet`).
 */
import type { WalletChoice } from '../wallet/confirmation';

/** Names for the mints wallets are checked for (and the review sheet shows). */
export const MINT_NAMES: Record<string, string> = {
    So11111111111111111111111111111111111111112: 'wSOL',
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC (devnet)',
};

const ROLE_NAMES: Record<WalletChoice['otherAuthorities'][number]['role'], string> = {
    owner: 'Owner',
    admin: 'Admin',
    spender: 'Spender',
    unknown: 'unknown role',
};

export const CHOICE_TEXT = {
    title: 'Which wallet is yours?',
    intro: 'Anyone can add your passkey to their own wallet, so only choose a wallet you recognise.',
    notUsed:
        'Not used with this passkey yet. Continue only if you created it, for example just now or on ' +
        'the LazorKit migration page.',
    vaultHandedOver:
        "This wallet's vault was handed to another program. Your passkey can no longer move what is " +
        'in it or what is sent to it.',
    use: 'Use this wallet',
    none: 'None of these',
} as const;

/** `AbCd…WxYz`. */
export const shortAddress = (address: string) =>
    address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatSol(lamports: number): string {
    return `${(lamports / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`;
}

/** In the user's locale: the time for today, date and time this year, the date after that; `null` when not a date. */
export function formatWhen(ms: number, now: number): string | null {
    const at = new Date(ms);
    if (Number.isNaN(at.getTime())) return null;
    const today = new Date(now);
    const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (at.toDateString() === today.toDateString()) return time;
    if (at.getFullYear() === today.getFullYear()) {
        return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
    }
    return at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const mintName = (mint: string | null) => (mint ? (MINT_NAMES[mint] ?? shortAddress(mint)) : 'unknown mint');

/** The "Also controlled by" items: untrusted only, counted. */
export function alsoControlledBy(choice: WalletChoice, now: number = Date.now()): string[] {
    const items: string[] = [];
    const authorities = choice.otherAuthorities.filter((a) => !a.trusted);
    const passkeys = authorities.filter((a) => a.type === 'passkey').length;
    if (passkeys) items.push(plural(passkeys, 'other passkey', 'other passkeys'));
    for (const role of ['owner', 'admin', 'spender', 'unknown'] as const) {
        const keys = authorities.filter((a) => a.type === 'key' && a.role === role).length;
        if (keys) items.push(`${plural(keys, 'backend key', 'backend keys')} (${ROLE_NAMES[role]})`);
    }

    const sessions = choice.liveSessions.filter((s) => !s.trusted);
    if (sessions.length) {
        const label = plural(sessions.length, 'session key', 'session keys');
        const expiries = sessions.map((s) => s.approxExpiresAt);
        const latest = expiries.includes(null) ? null : Math.max(...(expiries as number[]));
        const when = latest === null ? null : formatWhen(latest, now);
        if (!when) items.push(`${label}, expiry unknown`);
        else items.push(sessions.length === 1 ? `${label} until ~${when}` : `${label}, the last until ~${when}`);
    }

    // Never trusted, and possibly the user's own half-finished transaction: not "someone else's".
    if (choice.pendingDeferred.length) {
        items.push(plural(choice.pendingDeferred.length, 'pending transaction', 'pending transactions'));
    }

    const grants = choice.tokenGrants.filter((g) => !g.trusted);
    const ofKind = (kind: WalletChoice['tokenGrants'][number]['kind']) => grants.filter((g) => g.kind === kind);
    const delegates = ofKind('delegate').length;
    if (delegates) items.push(plural(delegates, 'token spending approval', 'token spending approvals'));
    const closable = ofKind('closeAuthority').length;
    if (closable) items.push(plural(closable, 'token account someone else can close', 'token accounts someone else can close'));
    const handed = ofKind('owner');
    if (handed.length) {
        const mints = [...new Set(handed.map((g) => mintName(g.mint)))].join(', ');
        items.push(
            `${plural(handed.length, 'token account', 'token accounts')} handed to someone else (${mints})`,
        );
    }
    const unreadable = ofKind('unreadable').length;
    if (unreadable) items.push(plural(unreadable, 'unreadable token account', 'unreadable token accounts'));
    return items;
}

/** Full addresses behind the summary, for the expandable detail. */
export function choiceDetails(choice: WalletChoice, now: number = Date.now()): { label: string; addresses: string[] }[] {
    const lines: { label: string; addresses: string[] }[] = [{ label: 'Wallet account', addresses: [choice.wallet] }];
    for (const a of choice.otherAuthorities) {
        if (a.trusted) continue;
        if (a.type === 'passkey') {
            const portal = a.sameRelyingParty === false ? ', another site' : '';
            lines.push({ label: `Other passkey (${ROLE_NAMES[a.role]}${portal})`, addresses: [a.address] });
        } else {
            lines.push({
                label: `Backend key (${ROLE_NAMES[a.role]}): key, then its authority account`,
                addresses: a.key ? [a.key, a.address] : [a.address],
            });
        }
    }
    for (const s of choice.liveSessions) {
        if (s.trusted) continue;
        const when = s.approxExpiresAt === null ? null : formatWhen(s.approxExpiresAt, now);
        lines.push({
            label: `Session key${when ? ` until ~${when}` : ', expiry unknown'}: key, then its account`,
            addresses: s.sessionKey ? [s.sessionKey, s.address] : [s.address],
        });
    }
    for (const d of choice.pendingDeferred) {
        lines.push({ label: 'Pending transaction', addresses: [d.address] });
    }
    for (const g of choice.tokenGrants) {
        if (g.trusted) continue;
        const what = {
            delegate: 'Token spending approval',
            closeAuthority: 'Token account someone else can close',
            owner: 'Token account handed to someone else',
            unreadable: 'Unreadable token account',
        }[g.kind];
        const mint = g.kind === 'unreadable' ? '' : ` (${mintName(g.mint)})`;
        lines.push({
            label: g.grantee ? `${what}${mint}: account, then who holds it` : `${what}${mint}`,
            addresses: g.grantee ? [g.tokenAccount, g.grantee] : [g.tokenAccount],
        });
    }
    return lines;
}

const STYLE_ID = 'lazorkit-choice-style';
// The portal dialog's shell, and Embedded mode's own (../embedded/sheets).
const SCOPE = 'dialog:is(#lazorkit-dialog, #lazorkit-embedded)[data-content="choice"]';

/** Palette and layout for the chooser, light or dark with the system. */
export function ensureChoiceStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
    ${SCOPE} {
      color-scheme: light dark;
      --lk-bg: #fcfcfc; --lk-fg: #202020; --lk-muted: rgba(32,32,32,0.68);
      --lk-border: rgba(0,0,0,0.12); --lk-card: #ffffff; --lk-hover: rgba(0,0,0,0.06);
      --lk-warn-bg: #fff4e5; --lk-warn-fg: #6b3600; --lk-warn-border: rgba(170,90,0,0.35);
      --lk-btn-bg: #202020; --lk-btn-fg: #fcfcfc; --lk-focus: #2f6fed;
      --background-color-th_base: var(--lk-bg);
      --background-color-th_frame: var(--lk-bg);
      --text-color-th_base: var(--lk-fg);
      --border-color-th_frame: var(--lk-border);
    }
    @media (prefers-color-scheme: dark) {
      ${SCOPE} {
        --lk-bg: #191919; --lk-fg: #eeeeee; --lk-muted: rgba(238,238,238,0.65);
        --lk-border: rgba(255,255,255,0.12); --lk-card: #222222; --lk-hover: rgba(255,255,255,0.10);
        --lk-warn-bg: rgba(255,170,60,0.12); --lk-warn-fg: #ffd08f; --lk-warn-border: rgba(255,170,60,0.40);
        --lk-btn-bg: #eeeeee; --lk-btn-fg: #191919; --lk-focus: #8ab4ff;
      }
    }
    ${SCOPE} :is(button, summary):focus-visible { outline: 2px solid var(--lk-focus) !important; outline-offset: 2px; }
    ${SCOPE} .lk-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 16px 12px; box-sizing: border-box; }
    ${SCOPE} .lk-title { font-size: 18px; font-weight: 650; margin: 8px 0 6px; outline: none; }
    ${SCOPE} .lk-intro { font-size: 13px; line-height: 1.45; color: var(--lk-muted); margin: 0 0 12px; }
    ${SCOPE} .lk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    ${SCOPE} .lk-row { border: 1px solid var(--lk-border); border-radius: 12px; background: var(--lk-card); padding: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.4; }
    ${SCOPE} .lk-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    ${SCOPE} .lk-short { font-weight: 650; font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    ${SCOPE} .lk-tag { font-size: 11px; border: 1px solid var(--lk-border); border-radius: 999px; padding: 1px 8px; color: var(--lk-muted); }
    ${SCOPE} .lk-full { display: flex; align-items: flex-start; gap: 6px; }
    ${SCOPE} .lk-addr { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; word-break: break-all; user-select: all; -webkit-user-select: all; color: var(--lk-muted); flex: 1 1 auto; min-width: 0; }
    ${SCOPE} .lk-copy { flex: 0 0 auto; font: inherit; font-size: 11px; background: transparent; color: var(--lk-fg); border: 1px solid var(--lk-border); border-radius: 6px; padding: 1px 8px; cursor: pointer; }
    ${SCOPE} .lk-copy:hover { background: var(--lk-hover); }
    ${SCOPE} .lk-warn { background: var(--lk-warn-bg); color: var(--lk-warn-fg); border: 1px solid var(--lk-warn-border); border-radius: 8px; padding: 8px 10px; }
    ${SCOPE} .lk-row p { margin: 0; }
    ${SCOPE} .lk-note, ${SCOPE} .lk-also { color: var(--lk-muted); }
    ${SCOPE} .lk-details summary { cursor: pointer; color: var(--lk-muted); font-size: 12px; border-radius: 4px; }
    ${SCOPE} .lk-details dl { margin: 6px 0 0; }
    ${SCOPE} .lk-details dt { font-size: 12px; margin-top: 6px; }
    ${SCOPE} .lk-details dd { margin: 2px 0 0; }
    ${SCOPE} .lk-use, ${SCOPE} .lk-none { font: inherit; font-size: 14px; font-weight: 600; border-radius: 10px; padding: 9px 12px; cursor: pointer; width: 100%; }
    ${SCOPE} .lk-use { margin-top: 4px; background: var(--lk-btn-bg); color: var(--lk-btn-fg); border: 1px solid var(--lk-btn-bg); }
    ${SCOPE} .lk-use:hover { opacity: 0.9; }
    ${SCOPE} .lk-footer { flex: 0 0 auto; padding: 10px 16px 14px; border-top: 1px solid var(--lk-border); }
    ${SCOPE} .lk-none { background: transparent; color: var(--lk-fg); border: 1px solid var(--lk-border); }
    ${SCOPE} .lk-none:hover { background: var(--lk-hover); }
  `;
    document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * The chooser's content: title, intro, one row per choice and the footer.
 * `onPick` gets the chosen wallet, or `null` for "None of these". `titleText`
 * replaces the default title ("Is this your wallet?" for one candidate, in
 * Embedded mode).
 */
export function renderWalletChoices(
    choices: WalletChoice[],
    onPick: (wallet: string | null) => void,
    titleText: string = CHOICE_TEXT.title,
): { body: HTMLElement; footer: HTMLElement; title: HTMLElement } {
    const now = Date.now();
    const body = el('div', 'lk-body');
    const title = el('h2', 'lk-title', titleText);
    title.id = 'lazorkit-choice-title';
    title.tabIndex = -1;
    const intro = el('p', 'lk-intro', CHOICE_TEXT.intro);
    intro.id = 'lazorkit-choice-intro';
    body.append(title, intro);

    const list = el('ul', 'lk-list');
    list.setAttribute('aria-label', 'Wallets this passkey is on');
    choices.forEach((choice) => list.appendChild(renderRow(choice, now, onPick)));
    body.appendChild(list);

    const footer = el('div', 'lk-footer');
    const none = el('button', 'lk-none', CHOICE_TEXT.none);
    none.type = 'button';
    none.setAttribute('data-lk', 'none');
    none.addEventListener('click', () => onPick(null));
    footer.appendChild(none);
    return { body, footer, title };
}

function renderRow(choice: WalletChoice, now: number, onPick: (wallet: string | null) => void): HTMLLIElement {
    const row = el('li', 'lk-row');
    const short = shortAddress(choice.vault);
    row.setAttribute('aria-label', `Wallet ${short}`);

    // First, and on its own: no trusted key makes this one safe.
    if (!choice.vaultIsSystemAccount) {
        const warn = el('p', 'lk-warn', CHOICE_TEXT.vaultHandedOver);
        warn.setAttribute('role', 'note');
        row.appendChild(warn);
    }

    const head = el('div', 'lk-head');
    head.appendChild(el('span', 'lk-short', short));
    if (choice.version === 1) head.appendChild(el('span', 'lk-tag', 'Legacy (v1)'));
    row.appendChild(head);

    const full = el('div', 'lk-full');
    const addr = el('span', 'lk-addr', choice.vault);
    addr.title = 'Vault address';
    full.appendChild(addr);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        const copy = el('button', 'lk-copy', 'Copy');
        copy.type = 'button';
        copy.setAttribute('aria-label', `Copy vault address ${short}`);
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(choice.vault).then(
                () => {
                    copy.textContent = 'Copied';
                    setTimeout(() => (copy.textContent = 'Copy'), 1500);
                },
                () => {
                    // Clipboard refused (permissions, insecure context): the address stays selectable.
                },
            );
        });
        full.appendChild(copy);
    }
    row.appendChild(full);

    const sol = formatSol(choice.lamports);
    row.appendChild(
        el('div', 'lk-balance', choice.vaultIsSystemAccount ? `Balance: ${sol}` : `Holds ${sol} your passkey cannot move`),
    );

    if (choice.signatureCount === 0) row.appendChild(el('p', 'lk-note', CHOICE_TEXT.notUsed));
    const also = alsoControlledBy(choice, now);
    if (also.length) row.appendChild(el('p', 'lk-also', `Also controlled by: ${also.join(' · ')}`));

    const details = el('details', 'lk-details');
    details.appendChild(el('summary', undefined, 'Addresses'));
    const dl = el('dl');
    for (const line of choiceDetails(choice, now)) {
        dl.appendChild(el('dt', undefined, line.label));
        for (const address of line.addresses) {
            const dd = el('dd');
            dd.appendChild(el('span', 'lk-addr', address));
            dl.appendChild(dd);
        }
    }
    details.appendChild(dl);
    row.appendChild(details);

    // Maintainer's decision: a vault handed to another program cannot be
    // chosen here. `confirmWallet` can still name it.
    if (choice.vaultIsSystemAccount) {
        const use = el('button', 'lk-use', CHOICE_TEXT.use);
        use.type = 'button';
        use.setAttribute('data-lk', 'use-wallet');
        use.setAttribute('aria-label', `${CHOICE_TEXT.use}: ${short}`);
        use.addEventListener('click', () => onPick(choice.wallet));
        row.appendChild(use);
    }
    return row;
}
