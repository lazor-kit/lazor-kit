---
"@lazorkit/wallet": patch
---

pr: 72
commit: ca7ad8b2d5f733c7c209a0ca0ebd94a48e3810a8

Ship the SDK changes from the monorepo restructure, which were not in 2.1.0. Some of them break existing integrations, so read this before upgrading from 2.1.0.

- **The program id changed** from `4h3XoNReAgEcHVxcZ8sw2aufi9MTr7BbvYYjzjWDyDxS` to `LazorjRFNavitUaBu5m3WaNPjU1maipvSW2rZfAFAKi` (`PROGRAM_ID` / `PROGRAM_ADDRESS`). Wallet and authority PDAs derive from the program id, so this version does not find wallets created with 2.1.0. The defaults still point at devnet (`https://api.devnet.solana.com` and `https://kora.devnet.lazorkit.com`), but as of 2026-09-28 the new program is deployed on mainnet-beta and not on devnet, so the default configuration cannot transact. `LazorkitProvider`, `useWallet` and the wallet-standard adapter always use the built-in id; only `new LazorKitClient(connection, programId)` accepts a different one.
- **A custom `Secp256r1Signer` must return `clientDataJson`.** The on-chain reconstruction path (Mode 0) was removed, so `sign()` has to return the raw clientDataJSON bytes from the authenticator. This affects code that passes its own signer to `LazorKitClient`. The hooks and the portal already return it.
- **The rpId follows `portalUrl`.** The wallet-standard adapter now uses the portal hostname (`portal.lazor.sh`) instead of `https://portal.lazor.sh`, and the hooks derive the rpId from `portalUrl` instead of a hard-coded `portal.lazor.sh`. Nothing changes for the default portal.
- **New exports, none removed:** `PROGRAM_ID`, `PROGRAM_ADDRESS`, the `find*Pda` helpers, `Actions`, `serializeActions`, `SessionActionType`, `SessionAccount`, `AuthorityAccount`, `ERROR_NAMES`, `errorFromCode`, `extractErrorCode`, `serializeDeferredPayload`, `deserializeDeferredPayload`, `readAuthorityCounter`, `readAuthorityPubkey`, `getCredentialHash`, and the `ROLE_*` and `AUTH_TYPE_*` constants. `createSession` accepts an optional `sessionKey` and `revokeSession` an optional `sessionPda`.
