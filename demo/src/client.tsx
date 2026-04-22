import { useState, useEffect, useCallback } from "react";
import { useWallet, LazorKitClient } from "../../packages/ts-sdk";
import type { SpendingLimits } from "../../packages/ts-sdk";
import { SystemProgram, PublicKey, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Buffer } from "buffer";

const RPC = "https://api.devnet.solana.com";
const connection = new Connection(RPC);
const sdkClient = new LazorKitClient(connection);

const RECIPIENT = new PublicKey('7Pkkhm8YeoBXFGKHTJXJ8ckdYiqtPdVWMefEVqK5vXed');
const TRANSFER_LAMPORTS = 0.3 * LAMPORTS_PER_SOL;
const SOL = 1_000_000_000;

const ROLE_LABELS: Record<number, string> = { 0: 'Owner', 1: 'Admin', 2: 'Spender' };
const TYPE_LABELS: Record<number, string> = { 0: 'Ed25519', 1: 'Passkey (secp256r1)' };

interface AuthorityEntry {
    authorityPda: string;
    authorityType: number;
    role: number;
    credential: string;
}

interface StoredSession {
    secretKey: number[];
    publicKey: string;
    sessionPda: string;
    walletPda: string;
    expiresAt: string;
    spendingLimits?: {
        solLifetimeCap?: string;
        solPerTxMax?: string;
        solRecurring?: { limit: string; windowSlots: string };
    };
}

interface LocalAuthorityInfo { publicKey: string; authorityPda: string; role: number; }

function loadSession(): StoredSession | null {
    try { const r = localStorage.getItem('lazorkit-session'); return r ? JSON.parse(r) : null; } catch { return null; }
}
function loadLocalAuthority(): LocalAuthorityInfo | null {
    try { const r = localStorage.getItem('lazorkit-authority'); return r ? JSON.parse(r) : null; } catch { return null; }
}
function buf2hex(b: Uint8Array) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
function lamportsToSol(l: string) { return (Number(l) / SOL).toFixed(6) + ' SOL'; }

// ── Spending limit form state ─────────────────────────────────────────

interface LimitForm {
    enabled: boolean;
    lifetimeSol: string;       // SOL units
    perTxSol: string;          // SOL units
    recurringSol: string;      // SOL units
    recurringWindowSlots: string;
}

const EMPTY_FORM: LimitForm = {
    enabled: false,
    lifetimeSol: '',
    perTxSol: '',
    recurringSol: '',
    recurringWindowSlots: '216000', // ~1 day
};

function formToSpendingLimits(form: LimitForm): SpendingLimits | undefined {
    if (!form.enabled) return undefined;
    const limits: SpendingLimits = {};
    const cap = parseFloat(form.lifetimeSol);
    if (!isNaN(cap) && cap > 0) limits.solLifetimeCap = BigInt(Math.round(cap * SOL));
    const perTx = parseFloat(form.perTxSol);
    if (!isNaN(perTx) && perTx > 0) limits.solPerTxMax = BigInt(Math.round(perTx * SOL));
    const rec = parseFloat(form.recurringSol);
    const win = parseInt(form.recurringWindowSlots);
    if (!isNaN(rec) && rec > 0 && !isNaN(win) && win > 0) {
        limits.solRecurring = { limit: BigInt(Math.round(rec * SOL)), windowSlots: BigInt(win) };
    }
    if (!limits.solLifetimeCap && !limits.solPerTxMax && !limits.solRecurring) return undefined;
    return limits;
}

type TxVersion = 'legacy' | 'v0';

function loadPendingDeferred(): string | null {
    return localStorage.getItem('lazorkit-deferred') || null;
}

export function Client() {
    const {
        wallet, isLoading,
        connect, disconnect,
        signAndSendTransaction, signMessage, verifyMessage,
        createSession, revokeSession, signAndSendWithSession,
        addAuthority, removeAuthority, signAndSendWithAuthority,
        authorizeAndExecute, authorizeDeferred, executeDeferred,
    } = useWallet();

    const [log, setLog] = useState<string[]>([]);
    const [session, setSession] = useState<StoredSession | null>(loadSession);
    const [localAuth, setLocalAuth] = useState<LocalAuthorityInfo | null>(loadLocalAuthority);
    const [authorities, setAuthorities] = useState<AuthorityEntry[]>([]);
    const [loadingAuth, setLoadingAuth] = useState(false);
    const [limitForm, setLimitForm] = useState<LimitForm>(EMPTY_FORM);
    const [showLimitForm, setShowLimitForm] = useState(false);
    const [txVersion, setTxVersion] = useState<TxVersion>('v0');
    const [pendingDeferred, setPendingDeferred] = useState<string | null>(loadPendingDeferred);
    const [msgText, setMsgText] = useState('Hello LazorKit');
    const [msgResult, setMsgResult] = useState<{ signature: string; signedPayload: string } | null>(null);
    const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

    const addLog = (msg: string) =>
        setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 29)]);

    const vaultPda = wallet?.vaultPda
        ? new PublicKey(wallet.vaultPda)
        : wallet?.smartWallet
            ? sdkClient.findVault(new PublicKey(wallet.smartWallet))[0]
            : null;

    const walletPda = wallet?.smartWallet ? new PublicKey(wallet.smartWallet) : null;

    const refreshAuthorities = useCallback(async () => {
        if (!walletPda) return;
        setLoadingAuth(true);
        try {
            const list = await sdkClient.listAuthorities(walletPda);
            setAuthorities(list.map(a => ({
                authorityPda: a.authorityPda.toBase58(),
                authorityType: a.authorityType,
                role: a.role,
                credential: buf2hex(a.credential),
            })));
        } catch (e: any) { addLog(`Load authorities error: ${e.message}`); }
        finally { setLoadingAuth(false); }
    }, [walletPda?.toBase58()]);

    useEffect(() => {
        setSession(loadSession());
        setLocalAuth(loadLocalAuthority());
        if (walletPda) refreshAuthorities();
    }, [wallet?.smartWallet]);

    // ── Passkey ────────────────────────────────────────────────────────

    const handleConnect = async () => {
        try {
            const w = await connect();
            addLog(`Connected — vault: ${sdkClient.findVault(new PublicKey(w.smartWallet))[0].toBase58().slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleDisconnect = async () => { await disconnect(); addLog('Disconnected'); };

    const handleAirdrop = async () => {
        if (!vaultPda) return;
        try {
            const sig = await connection.requestAirdrop(vaultPda, 10_000_000);
            await connection.confirmTransaction(sig);
            const bal = await connection.getBalance(vaultPda);
            addLog(`Airdrop OK — vault: ${bal} lamports`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const transferIx = () => SystemProgram.transfer({
        fromPubkey: vaultPda!,
        toPubkey: RECIPIENT,
        lamports: TRANSFER_LAMPORTS,
    });

    const handleTransferPasskey = async () => {
        if (!vaultPda) return;
        try {
            const sig = await signAndSendTransaction({
                instructions: [transferIx()],
                transactionOptions: { txVersion },
            });
            addLog(`Transfer (passkey, ${txVersion}) — ${sig.slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    // ── Sign / Verify Message ───────────────────────────────────────────

    const handleSignMessage = async () => {
        try {
            const result = await signMessage(msgText);
            setMsgResult(result);
            setVerifyResult(null);
            addLog(`Signed message — sig: ${result.signature.slice(0, 20)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleVerifyMessage = async () => {
        if (!msgResult || !wallet) return;
        try {
            const ok = await verifyMessage({
                signedPayload: new Uint8Array(Buffer.from(msgResult.signedPayload, 'base64')),
                signature: new Uint8Array(Buffer.from(msgResult.signature, 'base64')),
                publicKey: new Uint8Array(wallet.passkeyPubkey),
            });
            setVerifyResult(ok);
            addLog(`Verify message → ${ok ? 'OK' : 'FAIL'}`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    // ── Session ────────────────────────────────────────────────────────

    const handleCreateSession = async () => {
        const spendingLimits = formToSpendingLimits(limitForm);
        try {
            await createSession({ expiresInSlots: 50000n, spendingLimits });
            setSession(loadSession());
            setShowLimitForm(false);
            const limitsDesc = spendingLimits
                ? [
                    spendingLimits.solLifetimeCap ? `lifetime ${Number(spendingLimits.solLifetimeCap) / SOL} SOL` : '',
                    spendingLimits.solPerTxMax ? `per-tx ${Number(spendingLimits.solPerTxMax) / SOL} SOL` : '',
                    spendingLimits.solRecurring ? `recurring ${Number(spendingLimits.solRecurring.limit) / SOL} SOL/${spendingLimits.solRecurring.windowSlots} slots` : '',
                ].filter(Boolean).join(', ')
                : 'unrestricted';
            addLog(`Session created — limits: ${limitsDesc}`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const makeSessionTransfer = async (n: number) => {
        if (!vaultPda) return;
        try {
            const sig = await signAndSendWithSession({
                instructions: [transferIx()],
                transactionOptions: { txVersion },
            });
            addLog(`Transfer #${n} (session, ${txVersion}) — ${sig.slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleRevokeSession = async () => {
        try { await revokeSession(); setSession(null); addLog('Session revoked'); }
        catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    // ── Authority ──────────────────────────────────────────────────────

    const handleAddAuthority = async () => {
        try {
            const { authorityPda } = await addAuthority();
            setLocalAuth(loadLocalAuthority());
            await refreshAuthorities();
            addLog(`Authority added — PDA: ${authorityPda.slice(0, 12)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleRemoveAuthority = async (targetPda: string) => {
        try {
            await removeAuthority(targetPda);
            await refreshAuthorities();
            if (localAuth?.authorityPda === targetPda) { localStorage.removeItem('lazorkit-authority'); setLocalAuth(null); }
            addLog(`Authority removed — ${targetPda.slice(0, 12)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const makeAuthorityTransfer = async (n: number) => {
        if (!vaultPda) return;
        try {
            const sig = await signAndSendWithAuthority({
                instructions: [transferIx()],
                transactionOptions: { txVersion },
            });
            addLog(`Transfer #${n} (authority, ${txVersion}) — ${sig.slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    // ── Deferred ───────────────────────────────────────────────────────

    const handleAuthorizeAndExecute = async () => {
        if (!vaultPda) return;
        try {
            const sig = await authorizeAndExecute({
                instructions: [transferIx()],
                transactionOptions: { txVersion },
            });
            addLog(`Authorize+Execute (atomic, ${txVersion}) — TX2: ${sig.slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleAuthorizeDeferred = async () => {
        if (!vaultPda) return;
        try {
            const { signature, deferredPayload } = await authorizeDeferred({
                instructions: [transferIx()],
                transactionOptions: { txVersion },
            });
            localStorage.setItem('lazorkit-deferred', deferredPayload);
            setPendingDeferred(deferredPayload);
            addLog(`Deferred TX1 authorized (${txVersion}) — ${signature.slice(0, 16)}… · payload ${deferredPayload.length}B`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleExecuteDeferred = async () => {
        if (!pendingDeferred) return;
        try {
            const sig = await executeDeferred({
                deferredPayload: pendingDeferred,
                transactionOptions: { txVersion },
            });
            localStorage.removeItem('lazorkit-deferred');
            setPendingDeferred(null);
            addLog(`Deferred TX2 executed (${txVersion}) — ${sig.slice(0, 16)}…`);
        } catch (e: any) { addLog(`Error: ${e.message}`); }
    };

    const handleClearDeferred = () => {
        localStorage.removeItem('lazorkit-deferred');
        setPendingDeferred(null);
        addLog('Cleared pending deferred payload');
    };

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <div style={{ fontFamily: 'monospace', maxWidth: 740, margin: '24px auto', padding: '0 16px', color: '#e4e4e7' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
                <h2 style={{ color: '#a78bfa', margin: 0 }}>LazorKit Full Demo</h2>
                {/* Tx version toggle */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: '#94a3b8' }}>
                    <span>txVersion:</span>
                    {(['v0', 'legacy'] as TxVersion[]).map(v => (
                        <button
                            key={v}
                            onClick={() => setTxVersion(v)}
                            style={{
                                background: txVersion === v ? '#a78bfa' : '#1c1c1c',
                                color: txVersion === v ? '#0b0b12' : '#94a3b8',
                                border: '1px solid ' + (txVersion === v ? '#a78bfa' : '#27272a'),
                                borderRadius: 4,
                                padding: '3px 8px',
                                fontSize: 10,
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                            }}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Wallet info */}
            {wallet && (
                <Card color="#1e1b4b">
                    <Row label="Vault PDA (send SOL here)" value={vaultPda?.toBase58() ?? '—'} highlight />
                    <Row label="Wallet PDA (internal)" value={wallet.smartWallet} dim />
                    {wallet.accountName && <Row label="Account" value={wallet.accountName} />}
                </Card>
            )}

            {/* Session info */}
            {session && (
                <Card color="#0c2340">
                    <b style={{ color: '#38bdf8' }}>Active Session Key</b>
                    <Row label="Key" value={session.publicKey} dim />
                    <Row label="Session PDA" value={session.sessionPda} dim />
                    <Row label="Expires slot" value={session.expiresAt} />
                    {session.spendingLimits && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e3a5f' }}>
                            <span style={{ color: '#facc15', fontSize: 11 }}>Spending Limits</span>
                            {session.spendingLimits.solLifetimeCap && (
                                <Row label="Lifetime cap" value={lamportsToSol(session.spendingLimits.solLifetimeCap)} />
                            )}
                            {session.spendingLimits.solPerTxMax && (
                                <Row label="Per-tx max" value={lamportsToSol(session.spendingLimits.solPerTxMax)} />
                            )}
                            {session.spendingLimits.solRecurring && (
                                <Row
                                    label="Recurring"
                                    value={`${lamportsToSol(session.spendingLimits.solRecurring.limit)} / ${session.spendingLimits.solRecurring.windowSlots} slots`}
                                />
                            )}
                        </div>
                    )}
                </Card>
            )}

            {/* Local authority */}
            {localAuth && (
                <Card color="#0c2a1a">
                    <b style={{ color: '#4ade80' }}>Local Ed25519 Authority (stored)</b>
                    <Row label="Key" value={localAuth.publicKey} dim />
                    <Row label="Authority PDA" value={localAuth.authorityPda} dim />
                    <Row label="Role" value={ROLE_LABELS[localAuth.role] ?? String(localAuth.role)} />
                </Card>
            )}

            {/* On-chain authority list */}
            {wallet && (
                <Card color="#1c1c1c">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <b style={{ color: '#f59e0b' }}>
                            On-chain Authorities {loadingAuth ? '(loading…)' : `(${authorities.length})`}
                        </b>
                        <Btn onClick={refreshAuthorities} disabled={isLoading} color="#78350f" small>Refresh</Btn>
                    </div>
                    {authorities.length === 0 && !loadingAuth && (
                        <div style={{ color: '#52525b', fontSize: 11 }}>No authorities found</div>
                    )}
                    {authorities.map(a => (
                        <div key={a.authorityPda} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 11 }}>
                            <span style={{ color: '#f59e0b', minWidth: 52 }}>[{ROLE_LABELS[a.role] ?? a.role}]</span>
                            <span style={{ color: '#94a3b8', minWidth: 72 }}>{TYPE_LABELS[a.authorityType]}</span>
                            <span style={{ color: '#64748b', flex: 1 }}>{a.authorityPda.slice(0, 20)}…</span>
                            {a.role !== 0 && (
                                <Btn onClick={() => handleRemoveAuthority(a.authorityPda)} disabled={isLoading} color="#7f1d1d" small>
                                    Remove
                                </Btn>
                            )}
                        </div>
                    ))}
                </Card>
            )}

            {/* Action groups */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0' }}>

                {/* Passkey group */}
                <Group label="Passkey">
                    <Btn onClick={handleConnect} disabled={!!wallet || isLoading}>Connect</Btn>
                    <Btn onClick={handleDisconnect} disabled={!wallet || isLoading} color="#374151">Disconnect</Btn>
                    <Btn onClick={handleAirdrop} disabled={!wallet || isLoading} color="#0369a1">Airdrop</Btn>
                    <Btn onClick={handleTransferPasskey} disabled={!wallet || isLoading}>Transfer</Btn>
                </Group>

                {/* Session key group */}
                <Group label="Session Key">
                    <Btn onClick={() => setShowLimitForm(v => !v)} disabled={!wallet || isLoading} color="#6d28d9">
                        {showLimitForm ? 'Hide Limits' : 'Set Limits…'}
                    </Btn>
                    <Btn onClick={handleCreateSession} disabled={!wallet || isLoading} color="#7c3aed">Create Session</Btn>
                    <Btn onClick={() => makeSessionTransfer(1)} disabled={!session || isLoading} color="#2563eb">Transfer #1</Btn>
                    <Btn onClick={() => makeSessionTransfer(2)} disabled={!session || isLoading} color="#2563eb">Transfer #2</Btn>
                    <Btn onClick={() => makeSessionTransfer(3)} disabled={!session || isLoading} color="#2563eb">Transfer #3</Btn>
                    <Btn onClick={handleRevokeSession} disabled={!session || !wallet || isLoading} color="#dc2626">Revoke</Btn>
                </Group>

                {/* Authority group */}
                <Group label="Ed25519 Authority">
                    <Btn onClick={handleAddAuthority} disabled={!wallet || isLoading} color="#7c3aed">Add Authority</Btn>
                    <Btn onClick={() => makeAuthorityTransfer(1)} disabled={!localAuth || isLoading} color="#059669">Transfer #1</Btn>
                    <Btn onClick={() => makeAuthorityTransfer(2)} disabled={!localAuth || isLoading} color="#059669">Transfer #2</Btn>
                    <Btn onClick={() => makeAuthorityTransfer(3)} disabled={!localAuth || isLoading} color="#059669">Transfer #3</Btn>
                </Group>

                {/* Deferred group — atomic + split */}
                <Group label="Deferred">
                    <Btn onClick={handleAuthorizeAndExecute} disabled={!wallet || isLoading} color="#b45309">
                        Authorize + Execute (atomic)
                    </Btn>
                    <div style={{ height: 6 }} />
                    <Btn onClick={handleAuthorizeDeferred} disabled={!wallet || isLoading} color="#a16207">
                        1. Authorize Deferred
                    </Btn>
                    <Btn onClick={handleExecuteDeferred} disabled={!pendingDeferred || isLoading} color="#166534">
                        2. Execute Deferred {pendingDeferred && '●'}
                    </Btn>
                    {pendingDeferred && (
                        <Btn onClick={handleClearDeferred} disabled={isLoading} color="#7f1d1d" small>
                            Clear Pending
                        </Btn>
                    )}
                    <div style={{ fontSize: 10, color: '#78716c', marginTop: 4, lineHeight: 1.4 }}>
                        Atomic: TX1+TX2 in one call.<br />
                        Split: TX1 saves payload, TX2 submits later.
                    </div>
                </Group>

                {/* Sign/verify message group */}
                <Group label="Message Signing">
                    <Input
                        value={msgText}
                        onChange={setMsgText}
                        placeholder="message"
                        wide
                    />
                    <Btn onClick={handleSignMessage} disabled={!wallet || isLoading} color="#4f46e5">
                        Sign Message
                    </Btn>
                    <Btn onClick={handleVerifyMessage} disabled={!msgResult || isLoading} color="#0891b2">
                        Verify
                    </Btn>
                    {msgResult && (
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, wordBreak: 'break-all' }}>
                            sig: {msgResult.signature.slice(0, 32)}…
                            {verifyResult !== null && (
                                <div style={{ color: verifyResult ? '#4ade80' : '#f87171', marginTop: 2 }}>
                                    → verify: {verifyResult ? 'OK' : 'FAIL'}
                                </div>
                            )}
                        </div>
                    )}
                </Group>
            </div>

            {/* Pending deferred payload card */}
            {pendingDeferred && (
                <Card color="#1c1410">
                    <b style={{ color: '#fbbf24' }}>Pending Deferred Payload</b>
                    <Row label="Size" value={`${pendingDeferred.length} bytes`} />
                    <Row label="Preview" value={pendingDeferred.slice(0, 80) + '…'} dim />
                    <div style={{ fontSize: 10, color: '#78716c', marginTop: 4 }}>
                        Saved in localStorage (`lazorkit-deferred`). Click "2. Execute Deferred" to submit TX2.
                    </div>
                </Card>
            )}

            {/* Spending limit form — shown below action groups */}
            {showLimitForm && (
                <Card color="#1a0f2e">
                    <b style={{ color: '#c084fc' }}>Spending Limits for Next Session</b>
                    <p style={{ color: '#78716c', fontSize: 10, margin: '4px 0 10px' }}>
                        Leave a field empty to skip that limit. All SOL values in SOL (not lamports).
                    </p>

                    <label style={labelStyle}>
                        <input
                            type="checkbox"
                            checked={limitForm.enabled}
                            onChange={e => setLimitForm(f => ({ ...f, enabled: e.target.checked }))}
                            style={{ marginRight: 6 }}
                        />
                        Enable spending limits
                    </label>

                    {limitForm.enabled && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <FormRow label="Lifetime SOL cap">
                                <Input
                                    value={limitForm.lifetimeSol}
                                    onChange={v => setLimitForm(f => ({ ...f, lifetimeSol: v }))}
                                    placeholder="e.g. 0.5"
                                />
                                <Hint>Session becomes invalid once total spent ≥ this value</Hint>
                            </FormRow>

                            <FormRow label="Max SOL per tx">
                                <Input
                                    value={limitForm.perTxSol}
                                    onChange={v => setLimitForm(f => ({ ...f, perTxSol: v }))}
                                    placeholder="e.g. 0.01"
                                />
                                <Hint>Each execute is rejected if it tries to move more than this</Hint>
                            </FormRow>

                            <FormRow label="Recurring SOL limit">
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <Input
                                        value={limitForm.recurringSol}
                                        onChange={v => setLimitForm(f => ({ ...f, recurringSol: v }))}
                                        placeholder="SOL limit"
                                    />
                                    <Input
                                        value={limitForm.recurringWindowSlots}
                                        onChange={v => setLimitForm(f => ({ ...f, recurringWindowSlots: v }))}
                                        placeholder="slots (e.g. 216000)"
                                        wide
                                    />
                                </div>
                                <Hint>Resets every N slots (~1 day ≈ 216 000 slots on devnet)</Hint>
                            </FormRow>

                            {/* Preview */}
                            {formToSpendingLimits(limitForm) && (
                                <div style={{ background: '#2d1a54', padding: '6px 10px', borderRadius: 6, fontSize: 10, color: '#c084fc' }}>
                                    Will apply:{' '}
                                    {[
                                        limitForm.lifetimeSol && `lifetime ${limitForm.lifetimeSol} SOL`,
                                        limitForm.perTxSol && `per-tx ${limitForm.perTxSol} SOL`,
                                        limitForm.recurringSol && `${limitForm.recurringSol} SOL / ${limitForm.recurringWindowSlots} slots`,
                                    ].filter(Boolean).join(' · ')}
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            )}

            {/* Log */}
            <div style={{ background: '#09090b', border: '1px solid #27272a', padding: 12, borderRadius: 8, fontSize: 11, maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
                <div style={{ color: '#52525b', marginBottom: 4 }}>Log</div>
                {log.length === 0 && <span style={{ color: '#3f3f46' }}>No events yet.</span>}
                {log.map((l, i) => (
                    <div key={i} style={{ color: l.includes('Error') ? '#f87171' : '#86efac', marginBottom: 2 }}>{l}</div>
                ))}
            </div>

            {isLoading && <div style={{ marginTop: 6, color: '#facc15', fontSize: 11 }}>Processing…</div>}
        </div>
    );
}

// ── UI components ─────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#d1d5db', display: 'flex', alignItems: 'center' };

function Card({ children, color = '#111' }: { children: React.ReactNode; color?: string }) {
    return (
        <div style={{ background: color, border: '1px solid #27272a', borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 12 }}>
            {children}
        </div>
    );
}

function Row({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
    return (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
            <span style={{ color: '#6b7280', minWidth: 160, flexShrink: 0, fontSize: 11 }}>{label}:</span>
            <span style={{
                fontFamily: 'monospace', fontSize: 10,
                color: highlight ? '#a78bfa' : dim ? '#64748b' : '#d1d5db',
                wordBreak: 'break-all',
            }}>{value}</span>
        </div>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ border: '1px solid #27272a', borderRadius: 8, padding: '8px 12px', flex: '1 1 150px', minWidth: 150 }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>{label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
        </div>
    );
}

function Btn({ onClick, disabled, color = '#16a34a', children, small }: {
    onClick: () => void; disabled?: boolean; color?: string; children: React.ReactNode; small?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={disabled} style={{
            background: disabled ? '#1c1c1c' : color,
            color: disabled ? '#3f3f46' : '#fff',
            border: '1px solid ' + (disabled ? '#27272a' : 'transparent'),
            borderRadius: 6,
            padding: small ? '3px 8px' : '5px 10px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: small ? 10 : 12,
        }}>
            {children}
        </button>
    );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ color: '#9ca3af', fontSize: 10, marginBottom: 3 }}>{label}</div>
            {children}
        </div>
    );
}

function Input({ value, onChange, placeholder, wide }: { value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean }) {
    return (
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                background: '#09090b', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 8px',
                color: '#e4e4e7', fontSize: 11, width: wide ? 140 : 100, outline: 'none',
            }}
        />
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <div style={{ color: '#52525b', fontSize: 10, marginTop: 2 }}>{children}</div>;
}
