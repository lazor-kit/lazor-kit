/**
 * Where the SDK keeps the session key `createSession` generates and the
 * Ed25519 authority key `addAuthority` generates: one slot each, as before.
 *
 * Releases up to 3.2 kept them in localStorage as plaintext secret keys
 * (`lazorkit-session`, `lazorkit-authority`), where any script on the page, a
 * browser extension, a session-replay tool or a look at dev tools could copy
 * them. Now, best first:
 *
 * 1. a non-extractable WebCrypto Ed25519 key in IndexedDB: it signs, and its
 *    secret never reaches JavaScript, so it cannot be copied out (a script on
 *    the page can still use it while the page is open);
 * 2. where the browser has no WebCrypto Ed25519 (iOS 16, Chrome 136 and
 *    older): the seed, sealed with AES-GCM under a non-extractable key in the
 *    same IndexedDB, and moved to (1) once the browser has Ed25519;
 * 3. where there is no IndexedDB, or the app asked for it (`keyStorage:
 *    'memory'`): this page's memory only. The key is gone on reload.
 *
 * Nothing is written in the clear. A key the caller supplies
 * (`createSession({ sessionKey })`) is never stored: only its owner has it.
 *
 * A plaintext key an earlier release left in localStorage moves on the first
 * read (and when `LazorkitProvider` mounts): it is stored as above, and the
 * plaintext deleted once that write has committed. A write or an open that
 * fails leaves the plaintext in place, to move on the next read, and the key
 * signs from memory meanwhile. Only where there is nowhere to keep it but
 * memory (no IndexedDB at all, no WebCrypto, an IndexedDB that cannot hold a
 * CryptoKey, `keyStorage: 'memory'`) is the plaintext deleted and the key kept
 * for this page.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import {
    type KeyRecord,
    type KeySlot,
    deleteRecord,
    getRecord,
    getWrapKey,
    isCryptoKey,
    openKeysDb,
    putRecord,
    wrapKeyFor,
} from './idb';
import { type KeySigner, cryptoKeySigner, keypairSigner, sealedSigner } from './signer';
import { generateEd25519, importEd25519, seal, subtle, supportsEd25519, unseal } from './webcrypto';

export type { KeySlot } from './idb';
export type { KeySigner } from './signer';

/**
 * Where the SDK keeps the keys it generates. `'auto'` (default): IndexedDB as
 * above. `'memory'`: this page only, nothing at rest; keys stored by `'auto'`
 * before are not read.
 */
export type KeyStorage = 'auto' | 'memory';

/** What the stored session key is for. */
export interface SessionKeyInfo {
    readonly sessionPda: string;
    readonly walletPda: string;
    readonly expiresAt?: string;
    readonly spendingLimits?: {
        readonly solLifetimeCap?: string;
        readonly solPerTxMax?: string;
        readonly solRecurring?: { readonly limit: string; readonly windowSlots: string };
    };
}

/** What the stored authority key is for. */
export interface AuthorityKeyInfo {
    readonly authorityPda: string;
    readonly walletPda: string;
    readonly role?: number;
}

interface SlotInfo {
    session: SessionKeyInfo;
    authority: AuthorityKeyInfo;
}

/** A key the SDK generated, to register on chain and then `saveKey`. */
export interface NewKey {
    readonly signer: KeySigner;
    readonly material: KeyMaterial;
}

type KeyMaterial = { readonly privateKey: CryptoKey } | { readonly seed: Uint8Array };

export interface StoredKey<S extends KeySlot> {
    readonly signer: KeySigner;
    readonly info: SlotInfo[S];
}

/** The localStorage entries releases up to 3.2 kept the keys in, as plaintext. */
export const LEGACY_STORAGE_KEYS: Record<KeySlot, string> = {
    session: 'lazorkit-session',
    authority: 'lazorkit-authority',
};

/** A key kept in this page's memory. */
interface MemoryKey {
    readonly signer: KeySigner;
    readonly info: unknown;
    /**
     * A key `saveKey` could not store this time (IndexedDB failed, not
     * missing): stored on a later read once IndexedDB works, unless a newer key
     * is there by then.
     */
    readonly unsaved?: { readonly key: NewKey; readonly createdAt: number };
}

/** Keys kept for this page only: where they could not be stored, or `keyStorage: 'memory'`. */
const inMemory = new Map<KeySlot, MemoryKey>();

// ─── Generate, save, load, forget ───────────────────────────────────────────

/** A new key: a non-extractable WebCrypto Ed25519 key where the browser has one, else a `Keypair`. */
export async function generateKey(): Promise<NewKey> {
    if (await supportsEd25519()) {
        const key = await generateEd25519();
        if (key) {
            return {
                signer: cryptoKeySigner(new PublicKey(key.publicKey), key.privateKey),
                material: { privateKey: key.privateKey },
            };
        }
    }
    const keypair = Keypair.generate();
    return { signer: keypairSigner(keypair), material: { seed: keypair.secretKey.slice(0, 32) } };
}

/**
 * Keeps `key` in `slot`, in place of what the slot held (a plaintext key an
 * earlier release left included). Never throws: called once the key is
 * registered on chain, so a key that cannot be stored is kept for this page,
 * with a warning, and the action still succeeds.
 */
export async function saveKey<S extends KeySlot>(
    storage: KeyStorage,
    slot: S,
    key: NewKey,
    info: SlotInfo[S],
): Promise<'indexeddb' | 'memory'> {
    // First, so that a migration running in another tab does not write the
    // old key over this one (see `migrateSlot`).
    removeLegacy(slot);
    if (storage === 'memory') {
        inMemory.set(slot, { signer: key.signer, info });
        return 'memory';
    }
    const createdAt = Date.now();
    // Kept for this page. Stored on a later read when IndexedDB failed this
    // time; not when it never can (no IndexedDB or WebCrypto, or an IndexedDB
    // that cannot hold the key).
    const keepForPage = (error: unknown, later: boolean): 'memory' => {
        inMemory.set(slot, { signer: key.signer, info, ...(later ? { unsaved: { key, createdAt } } : {}) });
        console.warn(
            later
                ? `[LazorKit] The new ${slot} key could not be stored yet; it signs from this page's memory, and is stored on a later use:`
                : `[LazorKit] The new ${slot} key could not be stored, and is kept for this page only:`,
            error,
        );
        return 'memory';
    };
    let db: IDBDatabase | null;
    try {
        db = await openKeysDb();
    } catch (error) {
        return keepForPage(error, true);
    }
    if (!db) return keepForPage(new Error('IndexedDB is not available'), false);
    if ('seed' in key.material && !subtle()) return keepForPage(new Error('WebCrypto is not available'), false);
    try {
        await putRecord(db, await toRecord(db, slot, key, info, createdAt));
        inMemory.delete(slot);
        return 'indexeddb';
    } catch (error) {
        return keepForPage(error, !isCannotHold(error));
    }
}

/**
 * The key in `slot`, or null when there is none. Moves a plaintext key an
 * earlier release left in localStorage first.
 */
export async function loadKey<S extends KeySlot>(storage: KeyStorage, slot: S): Promise<StoredKey<S> | null> {
    await migrateSlot(storage, slot);
    const remembered = inMemory.get(slot);
    if (remembered) {
        if (remembered.unsaved && storage !== 'memory') await storeUnsaved(slot, remembered);
        return remembered as StoredKey<S>;
    }
    if (storage === 'memory') return null;

    // An open that fails rejects: the key may well be there, so this is not "no key".
    const db = await openKeysDb();
    if (!db) return null;
    const record = await getRecord(db, slot);
    if (!isKeyRecord(record, slot)) return null;
    const publicKey = new PublicKey(record.publicKey);
    const info = record.info as unknown as SlotInfo[S];
    if (record.privateKey) return { signer: cryptoKeySigner(publicKey, record.privateKey), info };

    const wrapKey = await getWrapKey(db);
    if (!wrapKey) return null; // Its sealing key is gone: the seed cannot be opened.
    const sealed = record.sealed!;
    // The browser has Ed25519 now: move the seed into a non-extractable key.
    const upgraded = (await supportsEd25519()) ? await upgradeSealed(db, record, wrapKey) : null;
    return { signer: upgraded ?? sealedSigner(publicKey, wrapKey, sealed, sealContext(slot, record.publicKey)), info };
}

/**
 * Forgets the key in `slot` when `matches` its info: the session revoked, the
 * authority removed. Never throws: called once that has landed.
 */
export async function forgetKey<S extends KeySlot>(
    storage: KeyStorage,
    slot: S,
    matches: (info: SlotInfo[S]) => boolean,
): Promise<void> {
    try {
        const remembered = inMemory.get(slot);
        if (remembered && matches(remembered.info as SlotInfo[S])) inMemory.delete(slot);
        const raw = readLegacy(slot);
        const legacy = raw === null ? null : parseLegacy(slot, raw);
        if (raw !== null && legacy && matches(legacy.info as unknown as SlotInfo[S])) removeLegacy(slot, raw);
        if (storage === 'memory') return;
        const db = await openKeysDb();
        if (!db) return;
        await deleteRecord(db, slot, (current) => isKeyRecord(current, slot) && matches(current.info as unknown as SlotInfo[S]));
    } catch (error) {
        console.warn(`[LazorKit] The ${slot} key could not be deleted:`, error);
    }
}

/**
 * Moves the plaintext keys an earlier release left in localStorage. Run when
 * `LazorkitProvider` mounts, so they do not wait for the next session or
 * authority send. Never throws.
 */
export async function migrateLegacyKeys(storage: KeyStorage): Promise<void> {
    await Promise.all([migrateSlot(storage, 'session'), migrateSlot(storage, 'authority')]);
}

// ─── Moving a plaintext key out of localStorage ─────────────────────────────

const migrations = new Map<KeySlot, Promise<void>>();

/** One migration per slot at a time on this page. Never rejects. */
function migrateSlot(storage: KeyStorage, slot: KeySlot): Promise<void> {
    let running = migrations.get(slot);
    if (!running) {
        running = migrate(storage, slot)
            .catch((error) => {
                console.warn(`[LazorKit] The ${slot} key in localStorage could not be moved yet:`, error);
            })
            .finally(() => migrations.delete(slot));
        migrations.set(slot, running);
    }
    return running;
}

async function migrate(storage: KeyStorage, slot: KeySlot): Promise<void> {
    const raw = readLegacy(slot);
    if (raw === null) return;
    const legacy = parseLegacy(slot, raw);
    if (!legacy) {
        // Not a key this SDK wrote: left as it is, and no key is read from it.
        warnOnce(`legacy-${slot}`, `[LazorKit] localStorage '${LEGACY_STORAGE_KEYS[slot]}' is not a key this SDK wrote; it was left as it is.`);
        return;
    }
    try {
        const key = await keyFromSeed(legacy.seed, legacy.publicKey);
        // Serves this page while the plaintext stays, unless the entry has
        // changed meanwhile (a key saved since, or `forgetStoredKeys`).
        const serveFromMemory = () => {
            if (readLegacy(slot) === raw) inMemory.set(slot, { signer: key.signer, info: legacy.info });
        };
        // Nowhere to keep it but memory. The plaintext goes all the same: the
        // key serves this page, and the session or authority stays on chain
        // with no one holding its key (the passkey's owner is unaffected).
        const keepInMemoryOnly = () => {
            serveFromMemory();
            removeLegacy(slot, raw);
        };

        let db: IDBDatabase | null = null;
        if (storage !== 'memory') {
            try {
                db = await openKeysDb();
            } catch (error) {
                // IndexedDB is there but did not open this time (a lost
                // connection, a full disk, a timeout): the plaintext stays,
                // to move on the next read, and the key serves this page.
                serveFromMemory();
                throw error;
            }
        }
        // A seed is stored sealed, which takes WebCrypto (a secure context).
        if (!db || ('seed' in key.material && !subtle())) return keepInMemoryOnly();

        // Written only while localStorage still holds this entry, checked in
        // the write's own transaction: a key saved since (here or in another
        // tab, which removes the entry first) is not overwritten.
        const stillThere = () => readLegacy(slot) === raw;
        let wrote: boolean;
        try {
            try {
                wrote = await putRecord(db, await toRecord(db, slot, key, legacy.info), stillThere);
            } catch (error) {
                // This IndexedDB cannot hold an Ed25519 CryptoKey: seal the seed instead.
                if (!isCannotHold(error) || !('privateKey' in key.material)) throw error;
                const sealed: NewKey = { signer: key.signer, material: { seed: legacy.seed } };
                wrote = await putRecord(db, await toRecord(db, slot, sealed, legacy.info), stillThere);
            }
        } catch (error) {
            // It cannot hold a CryptoKey at all: as with no IndexedDB.
            if (isCannotHold(error)) {
                warnOnce(`cannot-hold-${slot}`, `[LazorKit] IndexedDB here cannot keep the ${slot} key; it is kept for this page only: ${String(error)}`);
                return keepInMemoryOnly();
            }
            // Not stored this time: the plaintext stays, to move on the next
            // read, and the key serves this page meanwhile.
            serveFromMemory();
            throw error;
        }
        if (!wrote) return;
        removeLegacy(slot, raw);
        // The memory copy of this key (an earlier attempt's) is not needed now.
        if (inMemory.get(slot)?.signer.publicKey.equals(key.signer.publicKey)) inMemory.delete(slot);
    } finally {
        legacy.seed.fill(0);
    }
}

/** A key `saveKey` could not store, stored now if IndexedDB works, unless a newer key is there. Never throws. */
async function storeUnsaved(slot: KeySlot, entry: MemoryKey): Promise<void> {
    const { key, createdAt } = entry.unsaved!;
    try {
        const db = await openKeysDb();
        if (!db) return;
        await putRecord(
            db,
            await toRecord(db, slot, key, entry.info as object, createdAt),
            (current) => !isKeyRecord(current, slot) || current.createdAt < createdAt,
        );
        // Stored, or a newer key (another tab's) is: either way, read from IndexedDB from now on.
        if (inMemory.get(slot) === entry) inMemory.delete(slot);
    } catch (error) {
        if (isCannotHold(error) && inMemory.get(slot) === entry) inMemory.set(slot, { signer: entry.signer, info: entry.info });
        warnOnce(`unsaved-${slot}`, `[LazorKit] The ${slot} key still could not be stored; it signs from this page's memory: ${String(error)}`);
    }
}

interface LegacyKey {
    readonly seed: Uint8Array;
    readonly publicKey: PublicKey;
    readonly info: Record<string, unknown>;
}

/** A localStorage entry as releases up to 3.2 wrote it, or null for anything else. */
function parseLegacy(slot: KeySlot, raw: string): LegacyKey | null {
    try {
        const entry = JSON.parse(raw);
        const secretKey = entry?.secretKey;
        if (
            !Array.isArray(secretKey) ||
            secretKey.length !== 64 ||
            !secretKey.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        ) {
            return null;
        }
        // Checks the second half is the seed's public key.
        const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        if (entry.publicKey !== undefined && entry.publicKey !== keypair.publicKey.toBase58()) return null;
        const walletPda = base58(entry.walletPda);
        let info: Record<string, unknown>;
        if (slot === 'session') {
            const sessionPda = base58(entry.sessionPda);
            if (!sessionPda || !walletPda) return null;
            info = { sessionPda, walletPda, expiresAt: entry.expiresAt, spendingLimits: entry.spendingLimits };
        } else {
            const authorityPda = base58(entry.authorityPda);
            if (!authorityPda || !walletPda) return null;
            info = { authorityPda, walletPda, role: entry.role };
        }
        return { seed: keypair.secretKey.slice(0, 32), publicKey: keypair.publicKey, info: dropUndefined(info) };
    } catch {
        return null;
    }
}

// ─── Records ────────────────────────────────────────────────────────────────

async function keyFromSeed(seed: Uint8Array, publicKey: PublicKey): Promise<NewKey> {
    if (await supportsEd25519()) {
        const privateKey = await importEd25519(seed, publicKey.toBytes());
        if (privateKey) return { signer: cryptoKeySigner(publicKey, privateKey), material: { privateKey } };
    }
    const keypair = Keypair.fromSeed(seed);
    return { signer: keypairSigner(keypair), material: { seed: keypair.secretKey.slice(0, 32) } };
}

async function toRecord(
    db: IDBDatabase,
    slot: KeySlot,
    key: NewKey,
    info: object,
    createdAt = Date.now(),
): Promise<KeyRecord> {
    const publicKey = key.signer.publicKey.toBase58();
    const base = { slot, v: 1 as const, publicKey, info: { ...info } as Record<string, unknown>, createdAt };
    if ('privateKey' in key.material) return { ...base, privateKey: key.material.privateKey };
    const wrapKey = await wrapKeyFor(db);
    return { ...base, sealed: await seal(wrapKey, key.material.seed, sealContext(slot, publicKey)) };
}

/** Binds a sealed seed to its slot and public key: a record moved to another slot or key does not open. */
function sealContext(slot: KeySlot, publicKey: string): string {
    return `lazorkit-keys/v1/${slot}/${publicKey}`;
}

/** A sealed seed as a non-extractable Ed25519 key, rewritten in place unless the slot changed meanwhile. */
async function upgradeSealed(db: IDBDatabase, record: KeyRecord, wrapKey: CryptoKey): Promise<KeySigner | null> {
    try {
        const publicKey = new PublicKey(record.publicKey);
        const seed = await unseal(wrapKey, record.sealed!, sealContext(record.slot, record.publicKey));
        const privateKey = await importEd25519(seed, publicKey.toBytes());
        seed.fill(0);
        if (!privateKey) return null;
        const { sealed: _sealed, ...rest } = record;
        await putRecord(db, { ...rest, privateKey }, (current) => isKeyRecord(current, record.slot) && current.publicKey === record.publicKey && !!current.sealed);
        return cryptoKeySigner(publicKey, privateKey);
    } catch {
        return null; // It still signs sealed.
    }
}

function isKeyRecord(value: unknown, slot: KeySlot): value is KeyRecord {
    const record = value as KeyRecord | undefined;
    if (!record || typeof record !== 'object' || record.slot !== slot || record.v !== 1) return false;
    if (typeof record.publicKey !== 'string' || !base58(record.publicKey)) return false;
    if (!record.info || typeof record.info !== 'object' || !base58(record.info.walletPda)) return false;
    if (!base58(slot === 'session' ? record.info.sessionPda : record.info.authorityPda)) return false;
    if (record.privateKey !== undefined) return isCryptoKey(record.privateKey);
    const sealed = record.sealed;
    return !!sealed && sealed.iv instanceof Uint8Array && sealed.ct instanceof Uint8Array;
}

// ─── localStorage ───────────────────────────────────────────────────────────

function localStore(): Storage | undefined {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        return undefined;
    }
}

function readLegacy(slot: KeySlot): string | null {
    try {
        return localStore()?.getItem(LEGACY_STORAGE_KEYS[slot]) ?? null;
    } catch {
        return null;
    }
}

/** Removes the slot's plaintext entry; with `raw`, only while it still holds that. */
function removeLegacy(slot: KeySlot, raw?: string): void {
    try {
        const store = localStore();
        if (!store) return;
        if (raw !== undefined && store.getItem(LEGACY_STORAGE_KEYS[slot]) !== raw) return;
        store.removeItem(LEGACY_STORAGE_KEYS[slot]);
    } catch {
        // Storage blocked: there is no entry to remove either.
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** IndexedDB refused the value itself (a CryptoKey it cannot clone): trying again will not help. */
function isCannotHold(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === 'DataCloneError';
}

function base58(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        return new PublicKey(value).toBase58() === value ? value : null;
    } catch {
        return null;
    }
}

function dropUndefined(info: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined));
}

const warned = new Set<string>();
function warnOnce(id: string, message: string): void {
    if (warned.has(id)) return;
    warned.add(id);
    console.warn(message);
}
