import { useCallback, useState } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2';
import { LazorKitClient, Paymaster, verifyOwnershipProof } from '@lazorkit/wallet';
import {
  classifyV1VaultTokens,
  enumerateV1VaultTokens,
  legacyProgramIdFor,
  readV1WalletState,
  type UnmovableReason,
  type V1VaultToken,
} from '@lazorkit/sdk-legacy';

import { config, explorerTx } from './lib/config';
import { connectPasskey, portalRpId, signChallenge, type Passkey } from './lib/portal';
import { devSeedEnabled, devPayer, seedV1Wallet } from './lib/devSeed';
import { formatSol, formatTokenAmount, short } from './lib/format';
import { migrationState, type MigrationState } from './lib/sunset';

type Stuck = { token: V1VaultToken; reason: UnmovableReason };
/** An old wallet listing this passkey, with the key its authority stores. */
type Candidate = { wallet: PublicKey; authority: PublicKey; pubkey: Uint8Array };
type Moved = { destination: PublicKey; signatures: string[]; leftBehind: Stuck[] };

type Phase =
  | { name: 'idle' }
  | { name: 'connecting' }
  | { name: 'looking' }
  | { name: 'nothing' }
  | {
      name: 'found';
      wallet: PublicKey;
      authority: PublicKey;
      ownerPubkey: Uint8Array;
      lamports: number;
      /** Token accounts that can move. The user may leave some behind. */
      tokens: V1VaultToken[];
      /** Token accounts that cannot move, and why. */
      stuck: Stuck[];
      migration: MigrationState;
      /** Every old wallet listing this passkey, to verify all at once when it signs. */
      candidates: Candidate[];
    }
  | { name: 'migrating'; step: string }
  | { name: 'done'; moved: Moved[] }
  | { name: 'error'; message: string };

/** Largest transaction the network accepts. */
const MAX_TX_BYTES = 1232;

/**
 * The clientDataJSON the portal's passkey prompt produces: a cross-origin
 * iframe, so browsers add crossOrigin and topOrigin. Some Chrome builds also
 * pad it at random; that case is caught after signing, by measuring the real
 * transaction.
 */
const expectedClientDataJson = () =>
  new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: 'x'.repeat(43),
      origin: new URL(config.portalUrl).origin,
      crossOrigin: true,
      topOrigin: window.location.origin,
    }),
  );

/** Old wallets shown not to be this passkey's, remembered for the browser session. */
const notYoursKey = (credentialIdHash: Uint8Array) =>
  `lazorkit-migrate:not-yours:${Buffer.from(credentialIdHash).toString('hex')}`;
function loadNotYours(credentialIdHash: Uint8Array): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(notYoursKey(credentialIdHash)) ?? '[]'));
  } catch {
    return new Set();
  }
}
function saveNotYours(credentialIdHash: Uint8Array, set: Set<string>) {
  try {
    sessionStorage.setItem(notYoursKey(credentialIdHash), JSON.stringify([...set]));
  } catch {
    // storage unavailable: the check simply runs again next time
  }
}

const connection = new Connection(config.rpcUrl, 'confirmed');
// The v2 client: the new wallet lives here. The v1 wallet, and the migration
// itself, live at the v1 id paired with it.
const client = new LazorKitClient(connection, config.programId);
const v1ProgramId = config.v1ProgramId ?? legacyProgramIdFor(client.programId);
const paymaster = new Paymaster({
  paymasterUrl: config.paymasterUrl,
  apiKey: config.paymasterApiKey,
});

const REASONS: Record<UnmovableReason, string> = {
  frozen: 'frozen by its issuer',
  'transfer-hook': 'its token needs accounts a migration cannot pass',
  'non-transferable': 'its token cannot be transferred at all',
  paused: 'its token is paused by its issuer',
  'frozen-on-arrival': 'its token freezes every new account, so it could not arrive',
  'mint-missing': 'its token no longer exists',
  'destination-frozen': 'your new account for it is frozen by its issuer',
  'cpi-guard': 'it refuses transfers made through a program',
  excluded: 'you chose to leave it',
};

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [passkey, setPasskey] = useState<Passkey | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [leaveBehind, setLeaveBehind] = useState<Set<string>>(new Set());
  const [confirmedLoss, setConfirmedLoss] = useState(false);
  /** Migrations done this visit; a passkey can have more than one old wallet. */
  const [moved, setMoved] = useState<Moved[]>([]);

  const fail = (e: unknown) =>
    setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });

  const payerKey = async () => (devSeedEnabled() ? devPayer().publicKey : await paymaster.getPayer());

  /** Step 1: who are you, and do you still have something in the old wallet? */
  const find = useCallback(
    async (identity?: Passkey, done: Moved[] = moved) => {
      setPhase({ name: 'connecting' });
      try {
        const me = identity ?? (await connectPasskey());
        setPasskey(me);
        setPhase({ name: 'looking' });
        const notYours = loadNotYours(me.credentialIdHash);

        // No user seed anywhere in this flow: wallets made through the SDK used a
        // random seed kept in browser storage, which a returning user rarely has.
        // The chain knows the answer — the authority record names its wallet.
        // Anyone can create a v1 wallet listing this passkey's (public) id, so
        // these are only candidates: the passkey proves which one is its own
        // when it signs, before anything is sent.
        const rpIdHash = sha256(new TextEncoder().encode(portalRpId()));
        const owned = (await client.findV1WalletsByOwner(me.credentialIdHash, 'secp256r1', v1ProgramId)).filter(
          (w) => w.role === 0 && !notYours.has(w.wallet.toBase58()),
        );
        const authorities: (Buffer | undefined)[] = [];
        for (let i = 0; i < owned.length; i += 100) {
          const page = await connection.getMultipleAccountsInfo(owned.slice(i, i + 100).map((w) => w.authority));
          authorities.push(...page.map((a) => a?.data));
        }
        // Made for this portal's relying party (or the portal could never sign
        // for it), and — when the portal reported the passkey's key — holding it.
        const reported = me.compressedPubkey.length === 33 ? me.compressedPubkey : null;
        const candidates: Candidate[] = [];
        owned.forEach((w, i) => {
          const data = authorities[i];
          if (!data || data.length < 145 || !equal(new Uint8Array(data.subarray(113, 145)), rpIdHash)) return;
          const pubkey = new Uint8Array(data.subarray(80, 113));
          if (reported && !equal(pubkey, reported)) return;
          candidates.push({ wallet: w.wallet, authority: w.authority, pubkey });
        });

        for (const candidate of candidates) {
          const state = await readV1WalletState(connection, {
            wallet: candidate.wallet,
            vault: owned.find((w) => w.wallet.equals(candidate.wallet))!.vault,
            authority: candidate.authority,
          });
          if (!state) continue;
          const vault = owned.find((w) => w.wallet.equals(candidate.wallet))!.vault;
          const all = await enumerateV1VaultTokens(connection, vault);
          if (state.vaultLamports === 0 && all.length === 0) continue;
          const { movable, skipped } = await classifyV1VaultTokens(connection, all);
          setLeaveBehind(new Set());
          setConfirmedLoss(false);
          setPhase({
            name: 'found',
            wallet: candidate.wallet,
            authority: candidate.authority,
            // Read the owner's key off the chain, never from the WebAuthn
            // response: signing in with an existing passkey returns an
            // assertion, and an assertion carries no public key.
            ownerPubkey: candidate.pubkey,
            lamports: state.vaultLamports,
            tokens: movable,
            stuck: skipped,
            // Until v1 is retired its program has no MigrateWallet: say so now,
            // rather than after the passkey has signed something it cannot use.
            migration: await migrationState(connection, v1ProgramId, await payerKey()),
            candidates,
          });
          return;
        }
        setPhase(done.length ? { name: 'done', moved: done } : { name: 'nothing' });
      } catch (e) {
        fail(e);
      }
    },
    [moved],
  );

  const seed = useCallback(async () => {
    if (!passkey) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      if (passkey.compressedPubkey.length !== 33) {
        throw new Error(
          'Signing in with an existing passkey returns no public key, so a test wallet cannot ' +
            'be created for it. Reload, and in the portal use "Create new account" instead — ' +
            'registering is the only flow that hands back a key.',
        );
      }
      const { walletPda, vault } = await seedV1Wallet(passkey, v1ProgramId);
      setSeedResult(`Created wallet ${walletPda.toBase58()} — fund its vault ${vault.toBase58()}`);
    } catch (e) {
      setSeedResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }, [passkey]);

  /** Step 2: one signature, and everything that can move moves. */
  const migrate = useCallback(async () => {
    if (phase.name !== 'found' || !passkey) return;
    const found = phase;
    try {
      setPhase({ name: 'migrating', step: 'Preparing' });
      // In dev the local key pays: the shared paymaster only sponsors program
      // ids on its allow-list, and a throwaway test program is not one.
      const local: Keypair | null = devSeedEnabled() ? devPayer() : null;
      const payer = local ? local.publicKey : await paymaster.getPayer();
      const plan = await client.migrateV1Wallet({
        payer,
        owner: {
          type: 'secp256r1',
          credentialIdHash: passkey.credentialIdHash,
          compressedPubkey: found.ownerPubkey,
          rpId: portalRpId(),
        },
        v1Wallet: found.wallet,
        v1ProgramId,
        excludeTokenAccounts: [...leaveBehind].map((a) => new PublicKey(a)),
      });
      if (plan.migrate.type !== 'secp256r1') {
        throw new Error('this wallet is owned by a key, not a passkey — migrate it from your app');
      }

      // Something the user did not see may have become unmovable since they
      // looked (an issuer froze an account, a new token arrived). Show it first.
      const seen = new Set([...found.stuck.map((s) => s.token.ata.toBase58()), ...leaveBehind]);
      if (plan.skippedTokens.some((s) => !seen.has(s.token.ata.toBase58()))) {
        await find(passkey);
        return;
      }

      // The whole move is one transaction. Check it fits before asking for a
      // signature: past the size limit it can only fail, after the prompt.
      const { blockhash } = await connection.getLatestBlockhash();
      const txBytes = (instructions: TransactionInstruction[]) => {
        try {
          return new VersionedTransaction(
            new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(),
          ).serialize().length;
        } catch {
          return Infinity; // web3.js throws past the limit
        }
      };
      const bytes = txBytes(
        plan.migrate.finalize({
          signature: new Uint8Array(64),
          authenticatorData: new Uint8Array(37),
          clientDataJsonHash: new Uint8Array(32),
          clientDataJson: expectedClientDataJson(),
        }),
      );
      if (bytes > MAX_TX_BYTES) {
        throw new Error(
          `${plan.tokens.length} token accounts do not fit in one transaction. Untick the ones you ` +
            'can do without (anything unticked stays in the old wallet for good), then try again.',
        );
      }

      // The passkey signs the move itself: destination, wallet, and every token
      // account are inside the challenge, so nothing can be redirected.
      setPhase({ name: 'migrating', step: 'Waiting for your passkey' });
      const preview = new VersionedTransaction(
        new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [] }).compileToV0Message(),
      );
      const response = await signChallenge(
        plan.migrate.challenge,
        passkey.credentialId,
        Buffer.from(preview.serialize()).toString('base64'),
      );

      // Before anything is sent: is this old wallet really this passkey's?
      // Its key comes from the chain, and anyone can list the passkey's public
      // id on a wallet with a key of their own. The signature settles it — for
      // every candidate at once, since it checks the key, not the wallet.
      const proof = { challenge: plan.migrate.challenge, ...response };
      const verified = new Set(
        verifyOwnershipProof(
          found.candidates.map((c) => ({ wallet: c.wallet, publicKey: c.pubkey })),
          proof,
          portalRpId(),
        ).map((c) => c.wallet.toBase58()),
      );
      const notYours = loadNotYours(passkey.credentialIdHash);
      for (const c of found.candidates) if (!verified.has(c.wallet.toBase58())) notYours.add(c.wallet.toBase58());
      saveNotYours(passkey.credentialIdHash, notYours);
      if (!verified.has(found.wallet.toBase58())) {
        throw new Error(
          "That old wallet was not made by your passkey — someone created it using your passkey's " +
            'public id. Nothing was sent. Press "Check my wallet" again to find your own.',
        );
      }

      // A browser can pad its clientDataJSON; if the real transaction came out
      // too large, nothing has been sent — sign again.
      const migrateInstructions = plan.migrate.finalize(response);
      if (txBytes(migrateInstructions) > MAX_TX_BYTES) {
        throw new Error(
          'Your browser made that signature a little larger than usual, and the move no longer ' +
            'fits in one transaction. Nothing was sent — press Move again.',
        );
      }

      const signatures: string[] = [];
      const send = async (instructions: TransactionInstruction[]) => {
        const { blockhash: recent } = await connection.getLatestBlockhash();
        const message = new TransactionMessage({
          payerKey: payer,
          recentBlockhash: recent,
          instructions,
        }).compileToV0Message();
        const tx = new VersionedTransaction(message);
        let signature: string;
        if (local) {
          tx.sign([local]);
          signature = await connection.sendTransaction(tx);
        } else {
          signature = await paymaster.signAndSendVersionedTransaction(tx);
        }
        // A landed transaction can still have failed: confirmTransaction
        // reports that in value.err rather than throwing.
        const { value } = await connection.confirmTransaction(signature, 'confirmed');
        if (value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(value.err)}`);
        signatures.push(signature);
      };

      // The new wallet and a destination token account per token, paid for by
      // the app, go in the same transaction as the move when they fit, so the
      // two succeed or fail together. The signed move names the destination
      // vault, not who owns it: if someone else's wallet landed at that address
      // first, a setup sent on its own fails, and the move must then never be
      // sent — it would pay into their vault.
      const together = [...plan.setupInstructions, ...migrateInstructions];
      if (plan.setupInstructions.length && txBytes(together) <= MAX_TX_BYTES) {
        setPhase({ name: 'migrating', step: 'Moving your funds' });
        await send(together);
      } else {
        if (plan.setupInstructions.length) {
          setPhase({ name: 'migrating', step: 'Setting up the new wallet' });
          await send(plan.setupInstructions);
        }
        setPhase({ name: 'migrating', step: 'Moving your funds' });
        await send(migrateInstructions);
      }

      // A passkey can have more than one old wallet holding funds: look again,
      // and only say "done" when there is nothing left to move.
      const done = [...moved, { destination: plan.destinationWallet, signatures, leftBehind: plan.skippedTokens }];
      setMoved(done);
      await find(passkey, done);
    } catch (e) {
      fail(e);
    }
  }, [phase, passkey, leaveBehind, find, moved]);

  const toggle = (ata: string) => {
    setConfirmedLoss(false);
    setLeaveBehind((current) => {
      const next = new Set(current);
      if (next.has(ata)) next.delete(ata);
      else next.add(ata);
      return next;
    });
  };

  const stays: Stuck[] =
    phase.name === 'found'
      ? [
          ...phase.stuck,
          ...phase.tokens
            .filter((t) => leaveBehind.has(t.ata.toBase58()))
            .map((token) => ({ token, reason: 'excluded' as const })),
        ]
      : [];
  const losing = stays.some((s) => s.token.amount > 0n);

  return (
    <main>
      <h1>Move your wallet</h1>
      <p className="lead">
        LazorKit has a new version of its on-chain program. Your funds are safe where they are, and
        this page moves them across in one step, signed by you. Nobody else can move them.
      </p>

      {phase.name === 'idle' && <button onClick={() => find()}>Check my wallet</button>}

      {(phase.name === 'connecting' || phase.name === 'looking') && (
        <p className="status">{phase.name === 'connecting' ? 'Waiting for your passkey…' : 'Looking up your wallet…'}</p>
      )}

      {devSeedEnabled() && passkey && phase.name !== 'done' && (
        <section className="card">
          <h2>Test setup</h2>
          <p className="muted">
            Devnet only. Creates an old-style wallet owned by the passkey you just used, so there
            is something to move. The old program must be running its v1 build for this; see
            TESTING.md for the operator steps around it.
          </p>
          <button onClick={seed} disabled={seeding}>
            {seeding ? 'Creating…' : 'Create a test wallet'}
          </button>
          {seedResult && <p className="muted">{seedResult}</p>}
        </section>
      )}

      {phase.name === 'nothing' && (
        <section className="card">
          <h2>Nothing to move</h2>
          <p>
            This passkey has no old wallet holding anything. Either it was already moved, or it was
            created on the new version. You can close this page.
          </p>
          {passkey && <button onClick={() => find(passkey)}>Check again</button>}
        </section>
      )}

      {phase.name === 'found' && (
        <section className="card">
          {moved.length > 0 && (
            <p className="status">
              Moved {moved.length} old wallet{moved.length > 1 ? 's' : ''}. This passkey has another one
              that still holds funds:
            </p>
          )}
          <h2>What will move</h2>
          <dl>
            <dt>SOL</dt>
            <dd>{formatSol(phase.lamports)}</dd>
            {phase.tokens.map((t) => {
              const ata = t.ata.toBase58();
              return (
                <div key={ata} className="row">
                  <dt title={t.mint.toBase58()}>
                    <label>
                      <input type="checkbox" checked={!leaveBehind.has(ata)} onChange={() => toggle(ata)} />{' '}
                      {short(t.mint.toBase58())}
                    </label>
                  </dt>
                  <dd>{formatTokenAmount(t.amount)}</dd>
                </div>
              );
            })}
          </dl>
          {stays.length > 0 && (
            <>
              <h3>Staying behind — for good</h3>
              <p className="muted">
                Moving closes the old wallet, and after that nothing can ever reach these again.
              </p>
              <ul>
                {stays.map(({ token, reason }) => (
                  <li key={token.ata.toBase58()} title={token.mint.toBase58()}>
                    {short(token.mint.toBase58())}: {formatTokenAmount(token.amount)} — {REASONS[reason]}
                  </li>
                ))}
              </ul>
              {losing && (
                <label className="muted">
                  <input
                    type="checkbox"
                    checked={confirmedLoss}
                    onChange={(e) => setConfirmedLoss(e.target.checked)}
                  />{' '}
                  I understand these tokens will be lost.
                </label>
              )}
            </>
          )}
          <p className="muted">
            From {short(phase.wallet.toBase58())}. Every ticked token account moves in the same
            transaction; untick one to leave it behind (spam you never asked for, say). Closing the
            old accounts returns their rent to whoever pays for the move, which also pays to set up
            your new wallet.
          </p>
          {phase.migration.state === 'open' && (
            <button onClick={migrate} disabled={losing && !confirmedLoss}>
              {stays.length ? 'Move the ticked items' : 'Move everything'}
            </button>
          )}
          {phase.migration.state === 'closed' && (
            <>
              <p className="status">
                Moving opens once LazorKit retires its old program. Your wallet keeps working in your
                app until then; come back when your app says it is time.
              </p>
              <button onClick={() => find(passkey ?? undefined)}>Check again</button>
            </>
          )}
          {phase.migration.state === 'unknown' && (
            <>
              <p className="status">Could not check whether moving is open yet ({phase.migration.reason}).</p>
              <button onClick={() => find(passkey ?? undefined)}>Check again</button>
            </>
          )}
        </section>
      )}

      {phase.name === 'migrating' && <p className="status">{phase.step}…</p>}

      {phase.name === 'done' && (
        <section className="card">
          <h2>Done</h2>
          {phase.moved.map((m) => (
            <div key={m.destination.toBase58() + m.signatures.join()}>
              <p>
                Your funds are now in {short(m.destination.toBase58())}. Open your app again and they
                will be there.
              </p>
              {m.leftBehind.length > 0 && (
                <p className="muted">
                  Left in the old wallet:{' '}
                  {m.leftBehind
                    .map(({ token, reason }) => `${short(token.mint.toBase58())} (${REASONS[reason]})`)
                    .join(', ')}
                  .
                </p>
              )}
              <ul>
                {m.signatures.map((sig) => (
                  <li key={sig}>
                    <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
                      {short(sig)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {phase.name === 'error' && (
        <section className="card error">
          <h2>That did not work</h2>
          <p>{phase.message}</p>
          <button onClick={() => setPhase({ name: 'idle' })}>Try again</button>
          <p className="muted">
            Nothing was lost. Your funds stay in the old wallet until a signature of yours moves
            them.
          </p>
        </section>
      )}
    </main>
  );
}
