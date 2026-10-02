/**
 * The IndexedDB database the SDK keeps its keys in: `lazorkit-keys`, store
 * `keys` (one record per slot) and store `meta` (the AES-GCM key that seals
 * seeds where WebCrypto has no Ed25519). Same origin rules as localStorage.
 *
 * Every write waits for its transaction to commit (`durability: 'strict'`
 * where the browser has it), so a caller acts on a write only once it is
 * stored. A conditional write checks its condition and writes in one
 * transaction: readwrite transactions on a store run one at a time, across
 * tabs too.
 */
import type { Sealed } from './webcrypto';
import { generateWrapKey } from './webcrypto';

export const DB_NAME = 'lazorkit-keys';
const DB_VERSION = 1;
const KEYS = 'keys';
const META = 'meta';
const WRAP_KEY = 'wrap-key';

export type KeySlot = 'session' | 'authority';

/** A key as stored. Never holds a secret in the clear. */
export interface KeyRecord {
    readonly slot: KeySlot;
    readonly v: 1;
    /** base58 */
    readonly publicKey: string;
    /** A non-extractable Ed25519 key. */
    readonly privateKey?: CryptoKey;
    /** Or the seed, sealed under the `meta` store's AES-GCM key. */
    readonly sealed?: Sealed;
    /** What the key is for: no secret. */
    readonly info: Record<string, unknown>;
    readonly createdAt: number;
}

/** How long an open may take before it counts as failed (Safari can leave one pending for ever). */
const OPEN_TIMEOUT_MS = 5_000;
/** How long a transaction may take before it counts as failed. */
const TRANSACTION_TIMEOUT_MS = 10_000;

let opening: Promise<IDBDatabase | null> | undefined;

/**
 * The database. Resolves null only where IndexedDB is not there at all (SSR,
 * storage blocked for the page, Firefox's older private windows): nothing can
 * be kept at rest here, now or later. Rejects where it is there but did not
 * open this time (a lost connection, a full disk, an open that does not
 * finish within `OPEN_TIMEOUT_MS`): the next call tries again.
 */
export function openKeysDb(): Promise<IDBDatabase | null> {
    if (!opening) {
        const attempt = openOnce();
        opening = attempt;
        const forget = () => {
            if (opening === attempt) opening = undefined;
        };
        attempt.then((db) => db ?? forget(), forget);
    }
    return opening;
}

function openOnce(): Promise<IDBDatabase | null> {
    return new Promise<IDBDatabase | null>((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
            if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            return resolve(null); // SecurityError where storage is blocked
        }
        let done = false;
        const timer = setTimeout(() => {
            done = true;
            reject(namedError('TimeoutError', `IndexedDB '${DB_NAME}' did not open within ${OPEN_TIMEOUT_MS} ms`));
        }, OPEN_TIMEOUT_MS);
        const finish = (settle: () => void) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            settle();
        };
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'slot' });
            if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        };
        request.onsuccess = () => {
            const db = request.result;
            if (done) {
                db.close(); // Opened after its timeout: a later call opens its own.
                return;
            }
            // Another tab deleting or upgrading the database: let it, and open afresh next time.
            db.onversionchange = () => {
                db.close();
                opening = undefined;
            };
            db.onclose = () => {
                opening = undefined;
            };
            finish(() => resolve(db));
        };
        request.onerror = () => {
            const error = request.error;
            // Firefox before 115 refuses IndexedDB in a private window this
            // way: not there, for good. Anything else may work next time.
            finish(() =>
                error?.name === 'InvalidStateError' || error?.name === 'SecurityError'
                    ? resolve(null)
                    : reject(error ?? new Error(`IndexedDB '${DB_NAME}' could not be opened`)),
            );
        };
        // Blocked by another tab's connection: it closes on `versionchange`,
        // and the timeout covers one that does not.
    });
}

function namedError(name: string, message: string): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

function transaction(db: IDBDatabase, stores: string[], mode: IDBTransactionMode): IDBTransaction {
    return mode === 'readwrite'
        ? db.transaction(stores, mode, { durability: 'strict' })
        : db.transaction(stores, mode);
}

/**
 * Runs `body` in a request callback of `tx` and settles when `tx` commits
 * (with `value()`), or rejects when it fails. What `body` throws (a value
 * that cannot be stored, say) aborts the transaction, and is the rejection.
 */
function committed<T>(tx: IDBTransaction, value: () => T): { promise: Promise<T>; guard: (body: () => void) => void } {
    let failure: unknown;
    const promise = new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            failure ??= namedError('TimeoutError', `IndexedDB transaction did not finish within ${TRANSACTION_TIMEOUT_MS} ms`);
            reject(failure);
            try {
                tx.abort();
            } catch {
                // Already finished.
            }
        }, TRANSACTION_TIMEOUT_MS);
        tx.oncomplete = () => {
            clearTimeout(timer);
            resolve(value());
        };
        tx.onerror = () => {
            clearTimeout(timer);
            reject(failure ?? tx.error ?? new Error('IndexedDB transaction failed'));
        };
        tx.onabort = () => {
            clearTimeout(timer);
            reject(failure ?? tx.error ?? new Error('IndexedDB transaction aborted'));
        };
    });
    const guard = (body: () => void) => {
        try {
            body();
        } catch (error) {
            failure = error;
            try {
                tx.abort();
            } catch {
                // Already finished: its own handler reports it.
            }
        }
    };
    return { promise, guard };
}

export function getRecord(db: IDBDatabase, slot: KeySlot): Promise<unknown> {
    const tx = transaction(db, [KEYS], 'readonly');
    const request = tx.objectStore(KEYS).get(slot);
    return committed(tx, () => request.result).promise;
}

/**
 * Writes `record` in its slot when `when(current)` holds for what the slot
 * holds then, in the same transaction. Resolves with whether it wrote, once
 * that is committed.
 */
export function putRecord(
    db: IDBDatabase,
    record: KeyRecord,
    when: (current: unknown) => boolean = () => true,
): Promise<boolean> {
    const tx = transaction(db, [KEYS], 'readwrite');
    const store = tx.objectStore(KEYS);
    let wrote = false;
    const { promise, guard } = committed(tx, () => wrote);
    const current = store.get(record.slot);
    current.onsuccess = () =>
        guard(() => {
            if (!when(current.result)) return;
            store.put(record);
            wrote = true;
        });
    return promise;
}

/** Deletes the slot's record when `when(current)` holds. Resolves with whether it deleted, once committed. */
export function deleteRecord(db: IDBDatabase, slot: KeySlot, when: (current: unknown) => boolean): Promise<boolean> {
    const tx = transaction(db, [KEYS], 'readwrite');
    const store = tx.objectStore(KEYS);
    let deleted = false;
    const { promise, guard } = committed(tx, () => deleted);
    const current = store.get(slot);
    current.onsuccess = () =>
        guard(() => {
            if (current.result === undefined || !when(current.result)) return;
            store.delete(slot);
            deleted = true;
        });
    return promise;
}

/** The AES-GCM key seeds are sealed under, if one was made. */
export function getWrapKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
    const tx = transaction(db, [META], 'readonly');
    const request = tx.objectStore(META).get(WRAP_KEY);
    return committed(tx, () => (isCryptoKey(request.result) ? request.result : undefined)).promise;
}

/**
 * The AES-GCM key seeds are sealed under, made and stored on first use. Two
 * tabs making one at once keep the first stored. Throws without WebCrypto.
 */
export async function wrapKeyFor(db: IDBDatabase): Promise<CryptoKey> {
    const existing = await getWrapKey(db);
    if (existing) return existing;
    const candidate = await generateWrapKey();
    if (!candidate) throw new Error('WebCrypto is not available: a key cannot be stored without it');
    const tx = transaction(db, [META], 'readwrite');
    const store = tx.objectStore(META);
    let key = candidate;
    const { promise, guard } = committed(tx, () => key);
    const current = store.get(WRAP_KEY);
    current.onsuccess = () =>
        guard(() => {
            if (isCryptoKey(current.result)) key = current.result;
            else store.put(candidate, WRAP_KEY);
        });
    return promise;
}

export function isCryptoKey(value: unknown): value is CryptoKey {
    if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return true;
    const key = value as CryptoKey | null;
    return !!key && typeof key === 'object' && typeof key.type === 'string' && typeof key.algorithm === 'object';
}
