---
"@lazorkit/wallet": patch
---

A session or authority send still running when the wallet is disconnected neither signs nor sends after the disconnect, whichever way it came, and `LazorkitWalletAdapter.disconnect()` disconnects the store too.

In 3.3.1, `adapter.disconnect()` and the Wallet Standard `standard:disconnect` deleted the session key the SDK keeps, but left the store's wallet connected, and the kept key re-checks only the store's wallet when it signs. So a `signAndSendWithSession` or `signAndSendWithAuthority` that had already loaded its key went on to sign and send when the adapter disconnected during it (while its blockhash was fetched, say). And after the adapter's disconnect, `useWallet()` still showed the wallet, and the authority key (and a session key kept with `keepSessionKeys`) went on signing for it with no reconnect. The store's own `disconnect()` already stopped a send at signing. Now:

- `adapter.disconnect()` and `standard:disconnect` disconnect the store as its own `disconnect()` does: its wallet goes (also from what the store persists, so not back after a reload), a `connect` it is running is abandoned (it rejects with `PortalCancelledError`), `error` is cleared, and `isSigning` is left to the action running. A kept key signs only once its wallet is connected again. `keepSessionKeys` still only decides whether the session key is deleted.
- A send that loaded its kept key before any disconnect (the store's, the adapter's, the Wallet Standard's) is refused right before the key signs, and again right before each attempt to hand what it signed to the paymaster, retries included. It rejects with `KeyWalletMismatchError`: `reason: 'no-wallet'`, or the new `reason: 'disconnected'` when the same wallet is connected again by then (send again). A refusal after the key signed ends "The transaction it had signed was not sent." If an earlier attempt got no answer from the paymaster, that attempt may still land: the send rejects with `TransactionOutcomeUnknownError` and is not sent again.
- `KeyWalletMismatchReason` gains `'disconnected'`. `Paymaster.signAndSend` and `signAndSendVersionedTransaction` take an optional fourth argument, `{ beforeAttempt }`: it runs right before each attempt, and what it throws stops the send.

`@lazorkit/wallet-mobile-adapter` is unchanged: it has no wallet-adapter or Wallet Standard disconnect, and keeps no session key (the app holds it).
