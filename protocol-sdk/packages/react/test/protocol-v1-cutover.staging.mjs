/**
 * Exercises both built wallet packages on one disposable validator.
 * The passkey portal and paymaster are local test doubles; SPL transfers,
 * authorization, signatures, network fees and program upgrade run on chain.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const nativeFetch = globalThis.fetch;
const { loadWallet, portal, web3, assertion, RPC_URL, PAYMASTER_URL } = await import('./support/wallet.mjs');
const { RP_ID, PORTAL_URL } = await import('./support/corpus.mjs');
const { setHandlers } = await import('./support/env.mjs');
const webFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const { M, setPortalHandler, REDIRECT } = require('../../react-native/test/support/txv1-cluster.cjs');
globalThis.fetch = webFetch;

const { p256 } = require('@noble/curves/p256');
const { PROGRAM_ID_MAINNET, LazorKitClient } = require('@lazorkit/sdk-legacy');
assert.equal(require('@lazorkit/sdk-legacy/package.json').version, '0.4.0-rc.3');
const W = await loadWallet(resolve('packages/react/dist/index.mjs'));
const { Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = web3;
const repo = resolve(process.argv[2] ?? '../../lazorkit-v1-pr');
const requireFixtures = createRequire(join(repo, 'tests-sdk/package.json'));
const { LazorKitClient: PublishedLegacyClient } = requireFixtures('lazorkit-sdk-v1');
const spl = requireFixtures('@solana/spl-token');
const v3 = requireFixtures('web3js-v3');
const { handleRpc } = await import('../../../../../portal-v2/api/rpc.ts');

const rpcUrl = 'http://127.0.0.1:23701';
const ledger = mkdtempSync(join(tmpdir(), 'lazorkit-sdk-cutover-'));
const payer = Keypair.generate();
const upgradeAuthority = Keypair.generate();
const marketMaker = Keypair.generate();
const keyfile = join(ledger, 'upgrade-authority.json');
writeFileSync(keyfile, JSON.stringify(Array.from(upgradeAuthority.secretKey)), { mode: 0o600 });
const program = PROGRAM_ID_MAINNET.toBase58();
const snapshot = process.env.LAZORKIT_MAINNET_FIXTURE
  ? JSON.parse(readFileSync(process.env.LAZORKIT_MAINNET_FIXTURE, 'utf8'))
  : undefined;
const cloneArgs = snapshot?.accounts.flatMap(({ pubkey, account }, index) => {
  assert.equal(account.owner, program);
  assert.equal(account.executable, false);
  const filename = join(ledger, 'mainnet-account-' + index + '.json');
  writeFileSync(filename, JSON.stringify({ pubkey, account: { ...account, rentEpoch: JSON.rawJSON(String(account.rentEpoch)) } }));
  return ['--account', pubkey, filename];
}) ?? [];
const validator = spawn('solana-test-validator', [
  '--ledger', join(ledger, 'validator'), '--bind-address', '127.0.0.1', '--rpc-port', '23701',
  '--faucet-port', '23703', '--gossip-port', '23704', '--dynamic-port-range', '23705-23746',
  '--mint', upgradeAuthority.publicKey.toBase58(),
  '--deactivate-feature', 'B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g',
  '--upgradeable-program', program, join(repo, 'target/audit-baseline/v1-mainnet-live.so'), keyfile,
  ...cloneArgs, '--quiet',
], { stdio: ['ignore', 'ignore', 'inherit'] });
const stopped = new Promise(done => validator.once('close', done));
const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: nativeFetch });
const txRecords = [];
async function checkPreview(preview) {
  assert.equal(v3.VersionedTransaction.deserialize(Buffer.from(preview, 'base64')).version, 1);
  const origin = 'http://localhost:5310';
  const response = await handleRpc(new Request(origin + '/api/rpc?cluster=mainnet', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
      params: [preview, { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: true }],
    }),
  }), { env: { RPC_MAINNET_URL: rpcUrl }, fetch: nativeFetch, log() {}, now: Date.now });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.result?.value?.err, null, JSON.stringify(body));
}

const rpc = async body => ({
  json: await (await nativeFetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json(),
});

async function run() {
  for (let attempt = 0; ; attempt++) {
    if (attempt === 80 || validator.exitCode !== null) throw new Error('Local validator failed to start');
    const health = await nativeFetch(rpcUrl + '/health', { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (health?.ok && await health.text() === 'ok') break;
    await delay(250);
  }

  while (await connection.getSlot() < 3) await delay(250);
  async function assertMainnetClone() {
    if (!snapshot) return;
    const copies = await connection.getMultipleAccountsInfo(
      snapshot.accounts.map(({ pubkey }) => new web3.PublicKey(pubkey)),
    );
    snapshot.accounts.forEach(({ account }, i) => {
      const copy = copies[i];
      assert.equal(copy?.owner.toBase58(), account.owner);
      assert.equal(copy?.lamports, account.lamports);
      assert.deepEqual(copy?.data, Buffer.from(account.data[0], 'base64'));
    });
  }
  await assertMainnetClone();
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({
    fromPubkey: upgradeAuthority.publicKey, toPubkey: payer.publicKey, lamports: 1_000_000_000,
  })), [upgradeAuthority]);
  const client = new PublishedLegacyClient(connection, PROGRAM_ID_MAINNET);
  const passkey = { priv: p256.utils.randomPrivateKey(), credentialId: randomBytes(32).toString('base64') };
  const credentialIdHash = createHash('sha256').update(Buffer.from(passkey.credentialId, 'base64')).digest();
  const publicKey = p256.getPublicKey(passkey.priv, true);
  portal.passkey = passkey;
  setPortalHandler(async (url, redirectUrl) => {
    const params = new URL(url).searchParams;
    const challenge = params.get('message');
    if (params.get('transaction')) await checkPreview(params.get('transaction'));
    const result = assertion(passkey, Buffer.from(challenge, 'base64url'));
    const clientDataHash = createHash('sha256').update(Buffer.from(result.clientDataJSONReturn, 'base64')).digest();
    const msg = Buffer.concat([Buffer.from(result.authenticatorDataReturn, 'base64'), clientDataHash]);
    const redirect = new URL(redirectUrl);
    redirect.search = new URLSearchParams({
      success: 'true', message: challenge, msg: msg.toString('base64'), credentialId: passkey.credentialId,
      signature: result.normalized, clientDataJSONReturn: result.clientDataJSONReturn,
      authenticatorDataReturn: result.authenticatorDataReturn,
    }).toString();
    return { type: 'success', url: redirect.toString() };
  });
  setHandlers({
    rpc,
    async paymaster(body) {
      const { id, method, params } = JSON.parse(body);
      const reply = result => ({ json: { jsonrpc: '2.0', id, result } });
      if (method === 'getPayerSigner') return reply({ signer_address: payer.publicKey.toBase58() });
      assert.equal(method, 'signAndSendTransaction');
      assert.equal(params.signer_key, payer.publicKey.toBase58());
      assert.equal(params.fee_token, undefined, 'reimbursement is covered by the passkey payload');
      const bytes = Buffer.from(params.transaction, 'base64');
      const transaction = v3.VersionedTransaction.deserialize(bytes);
      assert.ok(bytes.length <= 4096);
      assert.ok(transaction.signatures[0].every(byte => byte === 0));
      const marketSigns = transaction.message.staticAccountKeys
        .slice(0, transaction.message.header.numRequiredSignatures)
        .some(key => key.toBase58() === marketMaker.publicKey.toBase58());
      const requiredSigners = marketSigns ? [payer, marketMaker] : [payer];
      const signers = await Promise.all(requiredSigners.map(key => v3.Keypair.fromSecretKey(key.secretKey)));
      await transaction.sign(signers);
      const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
      txRecords.push({ signature, bytes: bytes.length, version: transaction.version });
      return reply({ signature });
    },
  });

  const { instructions, walletPda, authorityPda, vaultPda } = await client.createWallet({
    payer: payer.publicKey,
    userSeed: randomBytes(32),
    owner: { type: 'secp256r1', credentialIdHash, compressedPubkey: publicKey, rpId: RP_ID },
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);
  const wallet = {
    credentialId: passkey.credentialId, passkeyPubkey: Array.from(publicKey),
    smartWallet: walletPda.toBase58(), walletPda: walletPda.toBase58(),
    vaultPda: vaultPda.toBase58(), walletDevice: authorityPda.toBase58(),
  };

  const usdc = await spl.createMint(connection, payer, payer.publicKey, null, 6);
  const outputMint = await spl.createMint(connection, payer, payer.publicKey, null, 6);
  const ata = (mint, owner) => spl.getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, true);
  const [vaultIn, vaultOut, marketIn, marketOut, sponsorAta] = await Promise.all([
    ata(usdc, vaultPda), ata(outputMint, vaultPda), ata(usdc, marketMaker.publicKey),
    ata(outputMint, marketMaker.publicKey), ata(usdc, payer.publicKey),
  ]);
  await spl.mintTo(connection, payer, usdc, vaultIn.address, payer, 100_000_000n);
  await spl.mintTo(connection, payer, outputMint, marketOut.address, payer, 100_000_000n);
  // An atomic two-leg fixed-price swap plus reimbursement, with extra metas
  // to exercise an account-heavy route that cannot fit as a v0 packet.
  const transfer = (source, mint, dest, owner, amount) =>
    spl.createTransferCheckedInstruction(source.address, mint, dest.address, owner, amount, 6);
  const swap = [
    transfer(vaultIn, usdc, marketIn, vaultPda, 1_000_000n),
    transfer(marketOut, outputMint, vaultOut, marketMaker.publicKey, 2_000_000n),
    transfer(vaultIn, usdc, sponsorAta, vaultPda, 250_000n),
  ];
  swap[0].keys.push(...Array.from({ length: 24 }, () => ({
    pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false,
  })));

  const paymaster = { paymasterUrl: PAYMASTER_URL, acceptsTxV1: true };
  for (const deployment of ['baseline', 'hardened']) {
    if (deployment === 'hardened') {
      const before = await connection.getAccountInfo(walletPda);
      execFileSync('solana', [
        'program', 'deploy', '--url', rpcUrl, '--keypair', keyfile, '--fee-payer', keyfile,
        '--upgrade-authority', keyfile, '--program-id', program, join(repo, 'target/deploy/lazorkit_program.so'),
      ], { timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
      const upgradeSlot = await connection.getSlot();
      while (await connection.getSlot() <= upgradeSlot + 1) await delay(250);
      assert.deepEqual(await connection.getAccountInfo(walletPda), before);
      await assertMainnetClone();
      if (snapshot) console.log(JSON.stringify({ mainnetSnapshotSlot: snapshot.slot, accountsPreserved: snapshot.accounts.length }));
    }
    const protocolClient = new LazorKitClient(connection, PROGRAM_ID_MAINNET, { hardened: deployment === 'hardened' });
    const walletCandidates = await protocolClient.findPasskeyWalletCandidates({ credentialIdHash, rpId: RP_ID });
    assert.equal(walletCandidates.length, 1);
    const [candidate] = await protocolClient.describeWalletCandidates(walletCandidates);
    assert.equal(candidate.version, 1);
    assert.equal(candidate.walletPda.toBase58(), walletPda.toBase58());
    assert.equal(candidate.authorityPda.toBase58(), authorityPda.toBase58());
    assert.equal(candidate.signatureCount, deployment === 'baseline' ? 0 : 2);
    for (const [label, store] of [['react', W.useWalletStore], ['react-native', M.useWalletStore]]) {
      const config = { rpcUrl: RPC_URL, cluster: 'mainnet', protocolV1Deployment: deployment, portalUrl: PORTAL_URL };
      store.getState().setConfig(label === 'react'
        ? { ...config, paymasterConfig: paymaster, keyStorage: 'memory' }
        : { ...config, configPaymaster: paymaster, rpId: RP_ID });
      if (deployment === 'baseline') {
        store.setState({ wallet: label === 'react-native' ? { ...wallet, smartWallet: wallet.vaultPda } : wallet });
      }
      assert.equal(store.getState().wallet.walletDevice, authorityPda.toBase58());
      assert.equal(store.getState().wallet.credentialId, passkey.credentialId);
      const payload = { instructions: swap, transactionOptions: { txVersion: 'v1' } };
      const signature = label === 'react'
        ? await store.getState().signAndSendTransaction(payload)
        : await store.getState().signAndExecuteTransaction(payload, { redirectUrl: REDIRECT });
      if (label === 'react') {
        const preview = portal.opens.at(-1).params.transaction;
        await checkPreview(preview);
      }
      const { bytes } = txRecords.at(-1);
      assert.ok(bytes > 1232);
      assert.equal(txRecords.at(-1).signature, signature);
      const landed = (await rpc(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTransaction',
        params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }],
      }))).json.result;
      assert.equal(landed.version, 1);
      assert.equal(landed.meta.err, null);
      const top = landed.transaction.message.instructions;
      assert.deepEqual(top.map(ix => ix.programId), ['Secp256r1SigVerify1111111111111111111111111', program]);
      assert.equal(await connection.getBalance(vaultPda), 0);
      assert.equal(landed.transaction.message.accountKeys[0].pubkey, payer.publicKey.toBase58());
      assert.equal(landed.meta.preBalances[0] - landed.meta.postBalances[0], landed.meta.fee);
      const count = BigInt(txRecords.length);
      assert.equal((await spl.getAccount(connection, vaultIn.address)).amount, 100_000_000n - 1_250_000n * count);
      assert.equal((await spl.getAccount(connection, vaultOut.address)).amount, 2_000_000n * count);
      assert.equal((await spl.getAccount(connection, sponsorAta.address)).amount, 250_000n * count);
      assert.equal((await spl.getAccount(connection, marketIn.address)).amount, 1_000_000n * count);
      assert.equal((await spl.getAccount(connection, marketOut.address)).amount, 100_000_000n - 2_000_000n * count);
      console.log(JSON.stringify({ deployment, adapter: label, bytes, signature, networkFee: landed.meta.fee }));
    }
  }

  const web = W.useWalletStore.getState();
  await web.createSession({
    expiresInSlots: 900n,
    spendingLimits: { tokens: [{ mint: usdc.toBase58(), perTxMax: 5_000n }] },
  });
  const mobile = M.useWalletStore.getState();
  const mobileSession = Keypair.generate();
  const { sessionPda } = await mobile.createSession({
    sessionKey: mobileSession.publicKey,
    expiresAtSlot: BigInt(await connection.getSlot()) + 900n,
    actions: [M.Actions.tokenMaxPerTx({ mint: usdc, max: 5_000n })],
  }, { redirectUrl: REDIRECT });
  const sessionPayload = {
    instructions: [transfer(vaultIn, usdc, sponsorAta, vaultPda, 1_000n)],
    transactionOptions: { txVersion: 'v1' },
  };
  await web.signAndSendWithSession(sessionPayload);
  assert.equal(txRecords.at(-1).version, 1);
  await mobile.signAndSendWithSession({ ...sessionPayload, sessionPda, sessionKeypair: mobileSession });
  assert.equal(txRecords.at(-1).version, 1);
  assert.equal((await spl.getAccount(connection, sponsorAta.address)).amount, 1_002_000n);
  const capturePath = process.env.LAZORKIT_CAPTURE_PROTOCOL_TX;
  if (capturePath) {
    const { signature } = txRecords.at(-1);
    const read = maxSupportedTransactionVersion => rpc(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [signature, { commitment: 'confirmed', encoding: 'base64', maxSupportedTransactionVersion }],
    }));
    const [v1, v0] = await Promise.all([read(1), read(0)]);
    assert.equal(v1.json.result?.version, 1);
    assert.equal(v0.json.error?.code, -32015);
    writeFileSync(capturePath, JSON.stringify({
      about: 'Protocol session Execute on the local cutover validator, captured with LAZORKIT_CAPTURE_PROTOCOL_TX.',
      signature,
      maxSupportedTransactionVersion1: v1.json.result,
      maxSupportedTransactionVersion0: { error: v0.json.error },
    }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ protocolV1SessionSends: 2, network: 'localnet' }));
}

try {
  await run();
} finally {
  validator.kill('SIGINT');
  await stopped;
  unlinkSync(keyfile);
}
