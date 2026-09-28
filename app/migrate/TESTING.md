# Testing the migration with a real passkey

The only thing that cannot be set up for you is the passkey: it lives on your
device and only you can unlock it. The operator does the rest (below).

Devnet test programs: v1 at the rehearsal slot
`3AN3WnaAN6SteghykdM96qHSGUJiVAUHWFjiyz31myAA`, v2 at
`57bTNWqtYTJbWuLWASKo6GqUTAK6oFDUR5c6hEc6V8nv` (inferred from the RPC).

## Before you start (operator)

The rehearsal slot has to run the **full v1** binary while the test wallet is
created, and the **sunset** binary when it is migrated. On 2026-09-28 it was
already on the sunset build, so set it up first, with the devnet keys:

```bash
# 1. put the full v1 binary back at the slot (the live mainnet dump)
solana program deploy v1_live_mainnet.so --program-id 3AN3WnaAN6SteghykdM96qHSGUJiVAUHWFjiyz31myAA \
  --upgrade-authority <devnet-init-authority.json> --url devnet
# 2. after the tester has created and you have funded the wallet (step 4 below):
( cd lazorkit-protocol/program && cargo build-sbf --features rehearsal-v1 --sbf-out-dir /tmp/sunset )
solana program deploy /tmp/sunset/lazorkit_program.so --program-id 3AN3WnaAN6SteghykdM96qHSGUJiVAUHWFjiyz31myAA \
  --upgrade-authority <devnet-init-authority.json> --url devnet
```

Funding is manual too: send the vault some SOL and a token or two (two or more
token accounts exercise the per-account binding the passkey signs). Nothing
here happens in the background.

## What you do

1. Open the page (an operator starts it, or run the command below).
2. **Check my wallet** → complete the passkey prompt in the portal. It will say
   there is nothing to move, which is right: the wallet does not exist yet.
3. **Create a test wallet** → this makes an old-style wallet owned by the
   passkey you just used. No prompt: creating one needs no signature from you.
4. Tell the operator the vault address; they fund it and retire the slot to
   the sunset build (above) — the step that opens migration on mainnet.
5. **Check my wallet** again → it should now list what is in the old vault.
   Before the operator's second deploy it says moving is not open yet; that is
   the check working.
6. **Move everything** → one passkey prompt, and the funds land in the new
   wallet.

What to watch for: exactly one prompt for connecting and one for step 6. Setup
is paid by the paymaster, not by you. Afterwards the old vault is empty and the
old accounts are closed; both transactions are linked on the page.

If anything fails, nothing has moved — the migration is a single signature that
either lands or does not, and it is only sent once the page has verified your
passkey signed it. The error text on the page names the step.

## Running it yourself

```bash
git checkout feat/migrate-app && pnpm install
VITE_DEV_SETUP=1 \
VITE_DEV_PAYER="$(cat ../lazorkit-protocol/keys/devnet-init-authority.json)" \
VITE_V1_PROGRAM_ID=3AN3WnaAN6SteghykdM96qHSGUJiVAUHWFjiyz31myAA \
VITE_RPC_URL=https://api.devnet.solana.com \
pnpm --filter @lazorkit/migrate dev
```

`VITE_DEV_PAYER` is the committed devnet throwaway key, and both dev flags are
read only in the browser during development. Neither has any meaning in a
production build: the seeding module is imported lazily and gated on both.

## The dev server has to be HTTPS

WebAuthn is refused when any frame in the chain was served without a valid
certificate, and the passkey prompt runs inside the portal's iframe. On plain
`http://localhost` the browser reports *"WebAuthn is not supported on sites
with TLS certificate errors"* and nothing happens.

`vite-plugin-mkcert` handles it, but its one-time CA install needs your
password:

```bash
~/.vite-plugin-mkcert/mkcert -install
```

Then `pnpm --filter @lazorkit/migrate dev` serves https://localhost:3001 with a
certificate the browser trusts.

## Known rough edges

- The wallet scan needs an RPC that allows `getProgramAccounts` with memcmp
  filters. Public devnet allows it but rate-limits; if the lookup stalls, point
  `VITE_RPC_URL` somewhere better.
- The portal opens as a modal iframe. A browser blocking third-party frames
  stops step 2.
- Step 4 is a real program upgrade, so it takes a couple of minutes.
