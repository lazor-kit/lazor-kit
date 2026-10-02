/**
 * Embedded mode's built-in screens: plain DOM `<dialog>`s, so `/core` users
 * and React users get the same ones. Drawn with `textContent` only (no HTML
 * from anywhere), themed with CSS custom properties an app sets on `:root`
 * (`--lk-accent`, `--lk-bg`, `--lk-fg`, `--lk-radius`, `--lk-font`), light or
 * dark with the system. Every control a test or an app's e2e needs has a
 * stable `data-lk` hook:
 *
 *   no-passkey  passkey-name  create  other-device  not-now  retry-wallet
 *   wallet-choice  use-wallet  none
 *   review  approve  cancel
 *
 * One sheet is open at a time; opening another closes it.
 */
import { Buffer } from 'buffer';
import type { WalletChoice } from '../wallet/confirmation';
import { CHOICE_TEXT, ensureChoiceStyles, renderWalletChoices } from '../portal/WalletChoiceView';
import type { EmbeddedUi, TxReview } from './types';

const DIALOG_ID = 'lazorkit-embedded';
const STYLE_ID = 'lazorkit-embedded-style';
/** The most a passkey's name may take, in UTF-8 bytes (what authenticators keep). */
export const MAX_NAME_BYTES = 60;

export const SHEET_TEXT = {
    noPasskeyTitle: 'No passkey on this device?',
    noPasskeyBody: "Your browser can't tell us if there's no passkey here or the sheet was closed.",
    nameLabel: 'Passkey name',
    nameHint: 'Shown when you pick a passkey.',
    create: 'Create a passkey',
    otherDevice: 'Use a passkey on another device',
    notNow: 'Not now',
    tryAgain: 'Try again',
    exists: (appName: string) => `This device already has a passkey for ${appName}. Use Continue with passkey.`,
    walletFailed: "Your passkey was created, but your wallet wasn't. Try again — you won't need a new passkey.",
    progress: {
        'creating-passkey': 'Creating passkey…',
        'other-device': 'Waiting for your other device…',
        'finding-wallet': 'Finding your wallet…',
        'one-more-check': 'Confirm once more to set up your wallet.',
        'creating-wallet': 'Creating your wallet…',
    },
    oneWallet: 'Is this your wallet?',
    reviewTitle: 'Review transaction',
    reviewSubtitle: (appName: string) => `${appName} asks your passkey to sign this.`,
    simulatedOk: 'Simulated: succeeds.',
    simulatedFailed: (reason: string) => `Simulation failed: ${reason}. Approving will likely fail.`,
    notSimulated: (reason: string) => `Not simulated: ${reason}.`,
    balance: (change: string) => `Your balance: ${change}`,
    reviewFooter: "Check the amount and recipient. The passkey prompt won't show them.",
    approve: 'Approve',
    approveAnyway: 'Approve anyway',
    cancel: 'Cancel',
    details: 'Details',
} as const;

/** UTF-8 bytes of a passkey name. */
export const nameBytes = (name: string) => Buffer.byteLength(name, 'utf8');

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    const D = `dialog#${DIALOG_ID}`;
    style.textContent = `
    ${D} {
      --_accent: var(--lk-accent, #2f6fed); --_bg: var(--lk-bg, #ffffff); --_fg: var(--lk-fg, #1d1d1f);
      --_muted: var(--lk-muted, rgba(29,29,31,0.64)); --_border: var(--lk-border, rgba(0,0,0,0.12)); --_hover: rgba(0,0,0,0.05);
      --_radius: var(--lk-radius, 16px); --_font: var(--lk-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
      --_danger: #b42318; --_danger-bg: #fef3f2; --_warn: #6b3600; --_warn-bg: #fff4e5; --_on-accent: #ffffff;
      color-scheme: light dark; position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
      margin: 0; padding: 0; border: none; background: transparent; display: grid; place-items: center; z-index: 2147483647;
    }
    @media (prefers-color-scheme: dark) {
      ${D} { --_bg: var(--lk-bg, #1c1c1e); --_fg: var(--lk-fg, #f2f2f7); --_muted: var(--lk-muted, rgba(242,242,247,0.64));
        --_border: var(--lk-border, rgba(255,255,255,0.14)); --_hover: rgba(255,255,255,0.08); --_danger: #fda29b; --_danger-bg: rgba(240,68,56,0.14);
        --_warn: #ffd08f; --_warn-bg: rgba(255,170,60,0.12); }
    }
    ${D}:not([open]) { display: none; }
    ${D}::backdrop { background: rgba(0,0,0,0.32); }
    ${D} .lk-sheet { box-sizing: border-box; width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
      background: var(--_bg); color: var(--_fg); font-family: var(--_font); border-radius: var(--_radius); padding: 20px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 12px; font-size: 14px; line-height: 1.45; }
    ${D}[data-content="choice"] .lk-sheet { padding: 0; gap: 0; }
    @media (max-width: 480px) {
      ${D} { place-items: end center; }
      ${D} .lk-sheet { width: 100%; max-height: 85vh; border-radius: var(--_radius) var(--_radius) 0 0; }
    }
    ${D} .lk-h { font-size: 18px; font-weight: 650; margin: 0; outline: none; }
    ${D} .lk-p { margin: 0; color: var(--_muted); }
    ${D} .lk-field { display: flex; flex-direction: column; gap: 4px; }
    ${D} .lk-field input { font: inherit; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--_border); background: transparent; color: inherit; }
    ${D} .lk-hint { font-size: 12px; color: var(--_muted); }
    ${D} .lk-hint[data-over] { color: var(--_danger); }
    ${D} .lk-notice { background: var(--_warn-bg); color: var(--_warn); border-radius: 10px; padding: 8px 10px; margin: 0; }
    ${D} .lk-status { min-height: 1.45em; margin: 0; color: var(--_muted); }
    ${D} .lk-status:empty { display: none; }
    ${D} .lk-actions { display: flex; flex-direction: column; gap: 8px; }
    ${D} .lk-btn { font: inherit; font-weight: 600; border-radius: 10px; padding: 10px 12px; cursor: pointer; width: 100%;
      border: 1px solid var(--_border); background: transparent; color: var(--_fg); }
    ${D} .lk-btn:hover:not(:disabled) { background: var(--_hover); }
    ${D} .lk-btn.lk-primary { background: var(--_accent); border-color: var(--_accent); color: var(--_on-accent); }
    ${D} .lk-btn.lk-primary:hover:not(:disabled) { opacity: 0.92; background: var(--_accent); }
    ${D} .lk-btn.lk-link { border: none; font-weight: 500; color: var(--_muted); }
    ${D} .lk-btn:disabled { opacity: 0.5; cursor: default; }
    ${D} :is(button, summary, input):focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
    ${D} .lk-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    ${D} .lk-row { border: 1px solid var(--_border); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; word-break: break-word; }
    ${D} .lk-row[data-muted] { color: var(--_muted); }
    ${D} .lk-row[data-danger] { border-color: var(--_danger); background: var(--_danger-bg); color: var(--_danger); font-weight: 600; }
    ${D} .lk-row-warn { color: var(--_warn); font-size: 13px; }
    ${D} .lk-row details summary { cursor: pointer; color: var(--_muted); font-size: 12px; }
    ${D} .lk-row details div { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; word-break: break-all; color: var(--_muted); margin-top: 2px; }
    ${D} .lk-sim[data-status="failed"] { color: var(--_danger); font-weight: 600; }
    ${D} .lk-fee, ${D} .lk-foot { color: var(--_muted); font-size: 13px; margin: 0; }
    `;
    document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text: string, lk: string, variant: 'primary' | 'secondary' | 'link' = 'secondary'): HTMLButtonElement {
    const b = el('button', `lk-btn${variant === 'primary' ? ' lk-primary' : variant === 'link' ? ' lk-link' : ''}`, text);
    b.type = 'button';
    b.setAttribute('data-lk', lk);
    return b;
}

/**
 * The built-in `EmbeddedUi`. One per page is enough; `builtinEmbeddedUi()`
 * returns it.
 */
class DomSheets implements EmbeddedUi {
    private dialog: HTMLDialogElement | null = null;
    private status: HTMLElement | null = null;
    private controls: HTMLButtonElement[] = [];
    /** Answers the sheet waiting for the user with its cancel value; null when none waits. */
    private dismiss: (() => void) | null = null;

    /** A fresh dialog: whatever was open closes, its question answered as dismissed. */
    private open(content: string, lk: string, labelledBy: HTMLElement): { dialog: HTMLDialogElement; sheet: HTMLDivElement } {
        this.close();
        ensureStyles();
        const dialog = document.createElement('dialog');
        dialog.id = DIALOG_ID;
        dialog.setAttribute('data-content', content);
        dialog.setAttribute('data-lk', lk);
        dialog.setAttribute('aria-labelledby', (labelledBy.id ||= `lk-title-${content}`));
        const sheet = el('div', 'lk-sheet');
        dialog.appendChild(sheet);
        dialog.addEventListener('cancel', (event) => {
            // Escape: answer as dismissed, if a question is open; otherwise
            // (a ceremony is running) stay.
            event.preventDefault();
            this.dismiss?.();
        });
        let pressedOutside = false;
        dialog.addEventListener('pointerdown', (event) => {
            pressedOutside = event.target === dialog;
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog && pressedOutside) this.dismiss?.();
            pressedOutside = false;
        });
        document.body.appendChild(dialog);
        this.dialog = dialog;
        return { dialog, sheet };
    }

    private show(dialog: HTMLDialogElement, focus: HTMLElement): void {
        try {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        } catch {
            dialog.setAttribute('open', '');
        }
        focus.focus?.();
    }

    noPasskey(ctx: Parameters<EmbeddedUi['noPasskey']>[0]): ReturnType<EmbeddedUi['noPasskey']> {
        const title = el('h2', 'lk-h', SHEET_TEXT.noPasskeyTitle);
        title.tabIndex = -1;
        const { dialog, sheet } = this.open('no-passkey', 'no-passkey', title);
        sheet.append(title, el('p', 'lk-p', SHEET_TEXT.noPasskeyBody));
        if (ctx.notice) {
            const notice = el('p', 'lk-notice', ctx.notice === 'exists' ? SHEET_TEXT.exists(ctx.appName) : SHEET_TEXT.walletFailed);
            notice.setAttribute('role', 'status');
            sheet.appendChild(notice);
        }
        this.status = el('p', 'lk-status');
        this.status.setAttribute('aria-live', 'polite');

        return new Promise((resolve) => {
            let answered = false;
            const answer = (choice: Awaited<ReturnType<EmbeddedUi['noPasskey']>>) => {
                if (answered) return;
                answered = true;
                this.dismiss = null;
                // The sheet stays, its buttons off, while the choice runs.
                this.controls.forEach((c) => (c.disabled = true));
                resolve(choice);
            };
            this.dismiss = () => {
                answer({ action: 'not-now' });
                this.close();
            };
            const actions = el('div', 'lk-actions');
            if (ctx.notice === 'wallet-failed') {
                const retry = button(SHEET_TEXT.tryAgain, 'retry-wallet', 'primary');
                retry.addEventListener('click', () => answer({ action: 'retry-wallet' }));
                const later = button(SHEET_TEXT.notNow, 'not-now', 'link');
                later.addEventListener('click', () => this.dismiss?.());
                actions.append(retry, later);
                this.controls = [retry, later];
                sheet.append(this.status!, actions);
                this.show(dialog, title);
                return;
            }
            const field = el('label', 'lk-field');
            const input = el('input');
            input.type = 'text';
            input.value = ctx.suggestedName;
            input.setAttribute('data-lk', 'passkey-name');
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('aria-describedby', 'lk-name-hint');
            const hint = el('span', 'lk-hint', SHEET_TEXT.nameHint);
            hint.id = 'lk-name-hint';
            field.append(el('span', undefined, SHEET_TEXT.nameLabel), input, hint);
            const create = button(SHEET_TEXT.create, 'create', 'primary');
            const other = button(SHEET_TEXT.otherDevice, 'other-device');
            const later = button(SHEET_TEXT.notNow, 'not-now', 'link');
            const check = () => {
                const name = input.value.trim();
                const over = nameBytes(name) > MAX_NAME_BYTES;
                create.disabled = name.length === 0 || over;
                if (over) hint.setAttribute('data-over', '');
                else hint.removeAttribute('data-over');
                hint.textContent = over ? `Too long: at most ${MAX_NAME_BYTES} bytes.` : SHEET_TEXT.nameHint;
            };
            input.addEventListener('input', check);
            check();
            create.addEventListener('click', () => {
                if (!create.disabled) answer({ action: 'create', name: input.value.trim() });
            });
            other.addEventListener('click', () => answer({ action: 'other-device' }));
            later.addEventListener('click', () => this.dismiss?.());
            actions.append(create, other, later);
            this.controls = [create, other, later];
            sheet.append(field, this.status!, actions);
            this.show(dialog, title);
        });
    }

    progress(step: Parameters<EmbeddedUi['progress']>[0]): void {
        if (!this.status) return;
        this.status.textContent = step ? SHEET_TEXT.progress[step] : '';
    }

    chooseWallet(choices: WalletChoice[]): Promise<{ wallet: string } | null> {
        ensureChoiceStyles();
        return new Promise((resolve) => {
            let answered = false;
            const settle = (wallet: string | null) => {
                if (answered) return;
                answered = true;
                this.dismiss = null;
                this.close();
                resolve(wallet === null ? null : { wallet });
            };
            const { body, footer, title } = renderWalletChoices(
                choices,
                settle,
                choices.length === 1 ? SHEET_TEXT.oneWallet : CHOICE_TEXT.title,
            );
            const { dialog, sheet } = this.open('choice', 'wallet-choice', title);
            dialog.setAttribute('aria-describedby', 'lazorkit-choice-intro');
            this.dismiss = () => settle(null);
            sheet.append(body, footer);
            this.show(dialog, title);
        });
    }

    reviewTransaction(review: TxReview): Promise<boolean> {
        const title = el('h2', 'lk-h', SHEET_TEXT.reviewTitle);
        title.tabIndex = -1;
        const { dialog, sheet } = this.open('review', 'review', title);
        sheet.append(title, el('p', 'lk-p', SHEET_TEXT.reviewSubtitle(review.appName)));

        const rows = el('ul', 'lk-rows');
        rows.setAttribute('aria-label', 'What this transaction does');
        for (const row of review.rows) {
            const li = el('li', 'lk-row');
            li.setAttribute('data-kind', row.kind);
            if (row.danger) li.setAttribute('data-danger', '');
            if (row.muted) li.setAttribute('data-muted', '');
            li.appendChild(el('span', undefined, row.text));
            if (row.warning) li.appendChild(el('span', 'lk-row-warn', row.warning));
            if (row.details?.length) {
                const details = el('details');
                details.appendChild(el('summary', undefined, SHEET_TEXT.details));
                row.details.forEach((line) => details.appendChild(el('div', undefined, line)));
                li.appendChild(details);
            }
            rows.appendChild(li);
        }
        sheet.appendChild(rows);

        const sim = review.simulation;
        const simLine = el(
            'p',
            'lk-p lk-sim',
            sim.status === 'ok'
                ? SHEET_TEXT.simulatedOk
                : sim.status === 'failed'
                  ? SHEET_TEXT.simulatedFailed(sim.reason)
                  : SHEET_TEXT.notSimulated(sim.reason),
        );
        simLine.setAttribute('data-status', sim.status);
        sheet.appendChild(simLine);
        if (sim.status === 'ok' && sim.balanceChange) sheet.appendChild(el('p', 'lk-p', SHEET_TEXT.balance(sim.balanceChange)));
        sheet.append(el('p', 'lk-fee', review.feeLine), el('p', 'lk-foot', SHEET_TEXT.reviewFooter));

        return new Promise((resolve) => {
            let answered = false;
            const answer = (ok: boolean) => {
                if (answered) return;
                answered = true;
                this.dismiss = null;
                this.close();
                resolve(ok);
            };
            this.dismiss = () => answer(false);
            const failed = sim.status === 'failed';
            const approve = button(failed ? SHEET_TEXT.approveAnyway : SHEET_TEXT.approve, 'approve', failed ? 'secondary' : 'primary');
            const cancel = button(SHEET_TEXT.cancel, 'cancel', failed ? 'primary' : 'secondary');
            approve.addEventListener('click', () => answer(true));
            cancel.addEventListener('click', () => answer(false));
            const actions = el('div', 'lk-actions');
            actions.append(...(failed ? [cancel, approve] : [approve, cancel]));
            this.controls = [approve, cancel];
            sheet.appendChild(actions);
            // The title, not a button: Enter must not approve.
            this.show(dialog, title);
        });
    }

    close(): void {
        const dismiss = this.dismiss;
        this.dismiss = null;
        dismiss?.();
        const dialog = this.dialog;
        this.dialog = null;
        this.status = null;
        this.controls = [];
        if (!dialog) return;
        try {
            if (dialog.open) dialog.close();
        } catch {
            // Not modal in this environment.
        }
        dialog.remove();
    }
}

let sheets: DomSheets | null = null;

/** The SDK's own screens (one set per page). */
export function builtinEmbeddedUi(): EmbeddedUi {
    if (typeof document === 'undefined') {
        throw new Error('Embedded mode draws its screens in a page: pass ui to createLazorkitClient where there is no document.');
    }
    return (sheets ??= new DomSheets());
}
