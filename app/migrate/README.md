# @lazorkit/migrate

The page a v1 user opens to move their wallet to protocol v2. One passkey
signature, everything moves, nobody else can do it for them.

## Why it exists

LazorKit v2 runs at its own program id. A v1 wallet stays at the v1 id, and
works as before until LazorKit retires v1 — upgrades that id to a sunset
binary that refuses everything but the ways out. From then on the wallet can do
one useful thing: move. `MigrateWallet` executes at the v1 id (the only program
that can sign for the old vault) and delivers into a v2 wallet at the v2 id,
authorized by the wallet's Owner, never by an operator.

Before the sunset, the v1 program has no `MigrateWallet`. The page checks
first — it simulates an instruction only the sunset binary refuses with 4018 —
and says "not yet" instead of asking for a signature it cannot use.

## The part that decides the design

Wallets created through `@lazorkit/wallet` used `userSeed: randomBytes(32)`,
kept in browser storage. A user who cleared it, or who is on another device,
cannot derive their own wallet. So this page never asks for a seed: it scans
for the authority record that carries the user's credential hash and reads the
wallet address out of it (`findV1WalletsByOwner`), then migrates by address.

That scan is `getProgramAccounts` with memcmp filters. **Point `VITE_RPC_URL`
at an endpoint that allows it** — most public ones do not.

The signature has to come from the portal. The authority stores the hash of the
relying-party id it was created under, and the program checks it on every
passkey signature, so an assertion made on this page's own origin would be
rejected. The page opens the portal for the signature, the same way the SDK
does.

## Running it

```bash
pnpm --filter @lazorkit/migrate dev
```

| env | default | notes |
|---|---|---|
| `VITE_RPC_URL` | devnet | must allow `getProgramAccounts` |
| `VITE_PORTAL_URL` | `https://portal.lazor.sh` | also supplies the rp id |
| `VITE_PAYMASTER_URL` | `https://kora.devnet.lazorkit.com` | sponsors both transactions: setup at the v2 id, the migration at the v1 id |
| `VITE_PAYMASTER_API_KEY` | empty | |
| `VITE_PROGRAM_ID` | inferred from the RPC url | the v2 program |
| `VITE_V1_PROGRAM_ID` | paired with the v2 id | the v1 program; set it only for a non-standard pairing |

## What a run does

1. Portal connect, to learn the passkey and its credential hash.
2. Scan for v1 wallets that list this passkey at Owner rank under the portal's
   relying party, then read the vault's SOL and every token account it holds.
   These are only *candidates*: the credential hash is public, and anyone can
   create a v1 wallet listing it next to a key of their own (step 4 settles it).
   Token accounts that can never move — frozen, transfer-hook, non-transferable
   or paused mints, default-frozen mints, withheld fees, CPI guard — are listed
   as staying behind; the user can untick any other token (spam, typically),
   and has to confirm before anything of value is left. Then check that the v1
   program runs the sunset binary: if it does not, stop here; if the check
   itself fails, say so and offer to retry.
3. Build the migration and check it fits in one transaction — on the passkey
   path about three token accounts in Chrome and four in Safari — before any
   prompt; if not, ask the user to untick some. The real transaction is measured
   again after signing, since browsers can pad the signed data. An existing v2 wallet is reused only if this passkey holds it
   alone, with its own key and relying party (the SDK checks).
4. The passkey signs the migration. The destination, the wallet and every
   source token account are inside the signed challenge, so a relayer cannot
   redirect the funds, drop a token, or swap one for dust. The page then
   verifies that signature against every candidate's stored key (the check is
   about the key, not the wallet): any that fail were planted, are remembered
   for the session, and are skipped; if the chosen one fails, nothing is sent.
5. Create the v2 wallet and one destination token account per token, paid by
   the paymaster. Nothing of the user's moves yet.
6. Send the migration. The v1 wallet and authority close; their rent, and each
   closed token account's, goes to the payer — the paymaster, which just paid
   for the new wallet (`refundDestination` in the SDK can send it elsewhere).
   Withheld Token-2022 transfer fees are harvested in the same transaction.
7. Look again: a passkey can own more than one old wallet with funds, and the
   page says "done" only when none is left.

Setup and migration are separate transactions on purpose: a vault with several
token accounts would not fit in one.
