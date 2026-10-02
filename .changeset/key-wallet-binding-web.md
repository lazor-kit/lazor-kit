---
'@lazorkit/wallet': minor
---

A kept session or authority key signs only for the wallet it was registered for, and an expired session's key is deleted

In 3.2.1, `signAndSendWithSession` and `signAndSendWithAuthority` signed with the stored key for the wallet it was registered for, whichever wallet was connected, or none. A key left behind by one user signed for them after they disconnected, and after someone else connected on the same browser.

- Every key the SDK keeps is stored with the wallet it was registered for (its wallet PDA), its session or authority PDA, and a session's expiry. `signAndSendWithSession`, `signAndSendWithAuthority` and `revokeSession()` (without `sessionPda`) use it only while that same wallet is connected. Otherwise they reject with the new `KeyWalletMismatchError` before anything is signed or sent, and call `onFail` once `isSigning` is `false`, as every action does. `reason` is `'no-wallet'` or `'other-wallet'`; `keyWallet` and `connectedWallet` are the wallet PDAs. The key checks again when it signs, so a wallet that disconnects or switches while a send is being built stops that send too.
- New exports: `KeyWalletMismatchError`, `isKeyWalletMismatchError(error)` (true for one from either copy of the package, and wrapped in `cause` or a wallet-adapter `WalletError`, like the other `is*Error` predicates), and the type `KeyWalletMismatchReason`.
- A key 3.2 left in localStorage named its wallet, unchecked. On its first use it is bound to that wallet if the program derives its session or authority PDA from that wallet and the key, or else to the wallet the PDA's account on chain names, if that account is LazorKit's and names the key. **An entry whose wallet cannot be confirmed either way is never used**: every send rejects with `KeyWalletMismatchError` and `reason: 'unbound'`. Call `forgetStoredKeys()` and create the session (add the authority) again.
- A stored session key whose session has expired is deleted when it is next read (a send, or `revokeSession()`), which rejects with "No session key found: the stored session … expired after slot …". It is deleted only once the chain, read at the connection's commitment, is past the session's `expiresAt`.

**Migration:** an app that sends with a kept key must have the key's wallet connected first. Where it sent before `connect` resolved (on page load, say), wait for the wallet. Handle `isKeyWalletMismatchError(error)` by creating a session (adding an authority) for the connected wallet, or by asking the user to connect the wallet the key belongs to.
