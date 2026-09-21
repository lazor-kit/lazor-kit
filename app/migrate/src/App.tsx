import { useCallback, useState } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { LazorKitClient, Paymaster } from '@lazorkit/wallet';
import { readV1WalletState, enumerateV1VaultTokens, type V1VaultToken } from '@lazorkit/sdk-legacy';

import { config, explorerTx } from './lib/config';
import { connectPasskey, portalRpId, signChallenge, type Passkey } from './lib/portal';
import { formatSol, formatTokenAmount, short } from './lib/format';

type Phase =
  | { name: 'idle' }
  | { name: 'connecting' }
  | { name: 'looking' }
  | { name: 'nothing' }
  | { name: 'found'; wallet: PublicKey; lamports: number; tokens: V1VaultToken[] }
  | { name: 'migrating'; step: string }
  | { name: 'done'; destination: PublicKey; signatures: string[]; seed?: Uint8Array }
  | { name: 'error'; message: string };

const connection = new Connection(config.rpcUrl, 'confirmed');
const client = new LazorKitClient(connection, config.programId);
const paymaster = new Paymaster({
  paymasterUrl: config.paymasterUrl,
  apiKey: config.paymasterApiKey,
});

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [passkey, setPasskey] = useState<Passkey | null>(null);

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
      const owned = (await client.findV1WalletsByOwner(identity.credentialIdHash, 'secp256r1'))
        .filter((w) => w.role === 0);

      for (const candidate of owned) {
        const state = await readV1WalletState(connection, candidate);
        if (!state) continue;
        const tokens = await enumerateV1VaultTokens(connection, candidate.vault);
        if (state.vaultLamports === 0 && tokens.length === 0) continue;
        setPhase({
          name: 'found',
          wallet: candidate.wallet,
          lamports: state.vaultLamports,
          tokens,
        });
        return;
      }
      setPhase({ name: 'nothing' });
    } catch (e) {
      fail(e);
    }
  }, []);

  /** Step 2: one signature, everything moves. */
  const migrate = useCallback(async () => {
    if (phase.name !== 'found' || !passkey) return;
    const v1Wallet = phase.wallet;
    try {
      setPhase({ name: 'migrating', step: 'Preparing' });
      const payer = await paymaster.getPayer();
      const plan = await client.migrateV1Wallet({
        payer,
        owner: {
          type: 'secp256r1',
          credentialIdHash: passkey.credentialIdHash,
          compressedPubkey: passkey.compressedPubkey,
          rpId: portalRpId(),
        },
        v1Wallet,
      });

      const signatures: string[] = [];
      const send = async (instructions: TransactionInstruction[]) => {
        const { blockhash } = await connection.getLatestBlockhash();
        const message = new TransactionMessage({
          payerKey: payer,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message();
        const signature = await paymaster.signAndSendVersionedTransaction(
          new VersionedTransaction(message),
        );
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
  }, [phase, passkey]);

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
            {phase.tokens.map((t) => (
              <div key={t.ata.toBase58()} className="row">
                <dt title={t.mint.toBase58()}>{short(t.mint.toBase58())}</dt>
                <dd>{formatTokenAmount(t.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            From {short(phase.wallet.toBase58())}. Every token account moves in the same
            transaction, and the old accounts are closed so their rent comes back to you.
          </p>
          <button onClick={migrate}>Move everything</button>
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
