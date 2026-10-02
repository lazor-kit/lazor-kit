export {
    generateKey,
    saveKey,
    loadKey,
    forgetKey,
    migrateLegacyKeys,
    forgetStoredKeys,
} from './vault';
export type {
    KeyStorage,
    KeySlot,
    KeySigner,
    NewKey,
    StoredKey,
    SessionKeyInfo,
    AuthorityKeyInfo,
} from './vault';
