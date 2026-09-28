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
import { LazorKitClient, Paymaster } from '@lazorkit/wallet';
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
import { isMigrationOpen } from './lib/sunset';

type Phase =
  | { name: 'idle' }
  | { name: 'connecting' }
  | { name: 'looking' }
  | { name: 'nothing' }
  | {
      name: 'found';
      wallet: PublicKey;
      ownerPubkey: Uint8Array;
      lamports: number;
      /** Token accounts that can move. The user may leave some behind. */
      tokens: V1VaultToken[];
      /** Token accounts that cannot move, and why. */
      stuck: { token: V1VaultToken; reason: UnmovableReason }[];
      /** False until the v1 program runs the sunset binary. */
      open: boolean;
    }
  | { name: 'migrating'; step: string }
  | { name: 'done'; destination: PublicKey; signatures: string[]; seed?: Uint8Array }
  | { name: 'error'; message: string };

/**
 * The owner's compressed key, as the v1 authority account stores it: 48-byte
 * header, then the credential-id hash, then 33 bytes of key.
 */
async function readV1OwnerPubkey(rpc: Connection, authority: PublicKey): Promise<Uint8Array> {
  const info = await rpc.getAccountInfo(authority);
  if (!info || info.data.length < 113) throw new Error('authority account is not a passkey owner');
  return new Uint8Array(info.data.subarray(80, 113));
}

const connection = new Connection(config.rpcUrl, 'confirmed');
// The v2 client: the new wallet lives here. The v1 wallet, and the migration
// itself, live at the v1 id paired with it.
const client = new LazorKitClient(connection, config.programId);
const v1ProgramId = config.v1ProgramId ?? legacyProgramIdFor(client.programId);

const REASONS: Record<UnmovableReason, string> = {
  frozen: 'frozen by its issuer',
  'transfer-hook': 'its token program needs accounts a migration cannot pass',
  excluded: 'you chose to leave it',
};
const paymaster = new Paymaster({
  paymasterUrl: config.paymasterUrl,
  apiKey: config.paymasterApiKey,
});

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [passkey, setPasskey] = useState<Passkey | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [leaveBehind, setLeaveBehind] = useState<Set<string>>(new Set());

  const fail = (e: unknown) =>
    setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });

  /** Step 1: who are you, and do you still have something in the old wallet? */
  const find = useCallback(async () => {
    setPhase({ name: 'connecting' });
    try {
      const identity = await connectPasskey();
      setPasskey(identity);
      setPhase({ name: 'looking' });

      // No user seed anywhere in this flow: wallets made through the SDK used a
      // random seed kept in browser storage, which a returning user rarely has.
      // The chain knows the answer — the authority record names its wallet.
      const owned = (
        await client.findV1WalletsByOwner(identity.credentialIdHash, 'secp256r1', v1ProgramId)
      ).filter((w) => w.role === 0);

      for (const candidate of owned) {
        const state = await readV1WalletState(connection, candidate);
        if (!state) continue;
        const all = await enumerateV1VaultTokens(connection, candidate.vault);
        if (state.vaultLamports === 0 && all.length === 0) continue;
        const { movable, skipped } = await classifyV1VaultTokens(connection, all);
        // Until v1 is retired its program has no MigrateWallet: say so now,
        // rather than after the passkey has signed something it cannot use.
        const payer = devSeedEnabled() ? devPayer().publicKey : await paymaster.getPayer();
        const open = await isMigrationOpen(connection, v1ProgramId, payer).catch(() => false);
        setLeaveBehind(new Set());
        setPhase({
          name: 'found',
          wallet: candidate.wallet,
          // Read the owner's key off the chain, never from the WebAuthn
          // response: signing in with an existing passkey returns an
          // assertion, and an assertion carries no public key.
          ownerPubkey:
            (candidate as { ownerPubkey?: Uint8Array }).ownerPubkey ??
            (await readV1OwnerPubkey(connection, candidate.authority)),
          lamports: state.vaultLamports,
          tokens: movable,
          stuck: skipped,
          open,
        });
        return;
      }
      setPhase({ name: 'nothing' });
    } catch (e) {
      fail(e);
    }
  }, []);

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
      const { walletPda, vault } = await seedV1Wallet(passkey);
      setSeedResult(`Created ${walletPda.toBase58().slice(0, 8)}… — vault ${vault.toBase58().slice(0, 8)}…`);
    } catch (e) {
      setSeedResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }, [passkey]);

  /** Step 2: one signature, everything moves. */
  const migrate = useCallback(async () => {
    if (phase.name !== 'found' || !passkey) return;
    const v1Wallet = phase.wallet;
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
          compressedPubkey: phase.ownerPubkey,
          rpId: portalRpId(),
        },
        v1Wallet,
        v1ProgramId,
        excludeTokenAccounts: [...leaveBehind].map((a) => new PublicKey(a)),
      });

      const signatures: string[] = [];
      const send = async (instructions: TransactionInstruction[]) => {
        const { blockhash } = await connection.getLatestBlockhash();
        const message = new TransactionMessage({
          payerKey: payer,
          recentBlockhash: blockhash,
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
        await connection.confirmTransaction(signature, 'confirmed');
        signatures.push(signature);
        return { message, signature };
      };

      // The new wallet and a destination token account per token, paid for by
      // the app. Nothing of the user's moves yet.
      if (plan.setupInstructions.length) {
        setPhase({ name: 'migrating', step: 'Setting up the new wallet' });
        await send(plan.setupInstructions);
      }

      if (plan.migrate.type !== 'secp256r1') {
        throw new Error('this wallet is owned by a key, not a passkey — migrate it from your app');
      }

      // The passkey signs the move itself: destination, wallet, and every token
      // account are inside the challenge, so nothing can be redirected.
      setPhase({ name: 'migrating', step: 'Waiting for your passkey' });
      const { blockhash } = await connection.getLatestBlockhash();
      const preview = new VersionedTransaction(
        new TransactionMessage({
          payerKey: payer,
          recentBlockhash: blockhash,
          instructions: [],
        }).compileToV0Message(),
      );
      const response = await signChallenge(
        plan.migrate.challenge,
        passkey.credentialId,
        Buffer.from(preview.serialize()).toString('base64'),
      );

      setPhase({ name: 'migrating', step: 'Moving your funds' });
      await send(plan.migrate.finalize(response));

      setPhase({
        name: 'done',
        destination: plan.destinationWallet,
        signatures,
        seed: plan.destinationUserSeed,
      });
    } catch (e) {
      fail(e);
    }
  }, [phase, passkey, leaveBehind]);

  const toggle = (ata: string) =>
    setLeaveBehind((current) => {
      const next = new Set(current);
      if (next.has(ata)) next.delete(ata);
      else next.add(ata);
      return next;
    });

  return (
    <main>
      <h1>Move your wallet</h1>
      <p className="lead">
        LazorKit has a new version of its on-chain program. Your funds are safe where they are, and
        this page moves them across in one step, signed by you. Nobody else can move them.
      </p>

      {phase.name === 'idle' && (
        <button onClick={find}>Check my wallet</button>
      )}

      {(phase.name === 'connecting' || phase.name === 'looking') && (
        <p className="status">{phase.name === 'connecting' ? 'Waiting for your passkey…' : 'Looking up your wallet…'}</p>
      )}

      {devSeedEnabled() && passkey && phase.name !== 'done' && (
        <section className="card">
          <h2>Test setup</h2>
          <p className="muted">
            Devnet only. Creates an old-style wallet owned by the passkey you just used, so there
            is something to move. Funding and the program upgrade happen on their own; give it a
            minute, then press Check my wallet again.
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
        </section>
      )}

      {phase.name === 'found' && (
        <section className="card">
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
                      <input
                        type="checkbox"
                        checked={!leaveBehind.has(ata)}
                        onChange={() => toggle(ata)}
                      />{' '}
                      {short(t.mint.toBase58())}
                    </label>
                  </dt>
                  <dd>{formatTokenAmount(t.amount)}</dd>
                </div>
              );
            })}
          </dl>
          {phase.stuck.length > 0 && (
            <>
              <h3>Staying behind</h3>
              <p className="muted">
                These cannot move, and stay in the old wallet for good once it closes.
              </p>
              <ul>
                {phase.stuck.map(({ token, reason }) => (
                  <li key={token.ata.toBase58()} title={token.mint.toBase58()}>
                    {short(token.mint.toBase58())}: {formatTokenAmount(token.amount)} — {REASONS[reason]}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            From {short(phase.wallet.toBase58())}. Every ticked token account moves in the same
            transaction; untick one to leave it (spam you never asked for, say). The old accounts
            are closed so their rent comes back to you.
          </p>
          {phase.open ? (
            <button onClick={migrate}>Move everything</button>
          ) : (
            <p className="status">
              Moving opens once LazorKit retires its old program. Your wallet keeps working in your
              app until then; come back when your app says it is time.
            </p>
          )}
        </section>
      )}

      {phase.name === 'migrating' && <p className="status">{phase.step}…</p>}

      {phase.name === 'done' && (
        <section className="card">
          <h2>Done</h2>
          <p>
            Your funds are now in {short(phase.destination.toBase58())}. Open your app again and
            they will be there.
          </p>
          <ul>
            {phase.signatures.map((s) => (
              <li key={s}>
                <a href={explorerTx(s)} target="_blank" rel="noreferrer">
                  {short(s)}
                </a>
              </li>
            ))}
          </ul>
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
