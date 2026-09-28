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
2. Scan for v1 wallets this passkey owns, then read the vault's SOL and every
   token account it holds. Frozen accounts and Token-2022 mints with a transfer
   hook cannot move and are listed as staying behind; the user can untick any
   other token (spam, typically) to leave it too. Check that the v1 program
   runs the sunset binary; if not, stop here.
3. Create the v2 wallet and one destination token account per token, paid by
   the paymaster. Nothing of the user's moves yet. An existing v2 wallet is
   reused only if this passkey holds it alone — a wallet someone else can also
   spend from is never a destination (the SDK checks).
4. The passkey signs the migration. The destination, the wallet and every
   source token account are inside the signed challenge, so a relayer cannot
   redirect the funds, drop a token, or swap one for dust.
5. Send it. The v1 wallet and authority close, and their rent goes back to the
   user.

Step 3 and step 5 are separate transactions on purpose: a vault with many token
accounts will not fit in one.
