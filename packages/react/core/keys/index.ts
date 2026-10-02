export {
    generateKey,
    saveKey,
    loadKey,
    forgetKey,
    wipeKey,
    wipeMark,
    updateKeyInfo,
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
