---
"@lazorkit/wallet": patch
---

`LazorkitWalletAdapter.disconnect()` and the Wallet Standard `standard:disconnect` delete the session key the SDK keeps, as the store's `disconnect()` does.

In 3.3.0 only `useWallet().disconnect()` (and the store's) deleted it. A dApp that signs the user out through wallet-adapter (`useWallet().disconnect()` from `@solana/wallet-adapter-react`, a wallet-adapter UI's Disconnect) or through the Wallet Standard cleared the stored wallet but left the session key a `createSession` on the same page had kept, which then signed again once its wallet was connected. Now:

- `adapter.disconnect()` deletes the session key from IndexedDB, this page's memory and any plaintext an earlier release left, whichever wallet it is for and whatever `keyStorage` the provider uses, before the adapter emits `'disconnect'`. A key IndexedDB fails to delete is logged, and the disconnect still succeeds.
- `adapter.disconnect({ keepSessionKeys: true })` keeps it, as `DisconnectOptions.keepSessionKeys` does for the store. New type `LazorkitAdapterDisconnectOptions`.
- `standard:disconnect` takes no options, so it always deletes it.
- The authority key is kept on both paths, as by the store's `disconnect()`; `forgetStoredKeys()` deletes it.
