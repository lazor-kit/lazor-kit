/**
 * Runs the built mobile adapter with a real Kora process and disposable
 * validator. Only the passkey portal, mint and token price are fixtures.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const nativeFetch = globalThis.fetch;
const { web3, assertion, RPC_URL } = await import('../../react/test/support/wallet.mjs');
const { RP_ID, PORTAL_URL } = await import('../../react/test/support/corpus.mjs');
const { setHandlers } = await import('../../react/test/support/env.mjs');
const sdkFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const { M, setPortalHandler, REDIRECT } = require('./support/txv1-cluster.cjs');
const { p256 } = require('@noble/curves/p256');
const { PROGRAM_ID_DEVNET, PROGRAM_ID_MAINNET } = require('@lazorkit/sdk-legacy');
const { LazorKitClient } = require('lazorkit-sdk-v1');
const spl = require('@solana/spl-token');
const { Connection, Keypair, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } = web3;
const [koraBinary, baseline, hardened] = process.argv.slice(2).map((path) => resolve(path));
const rpcUrl = 'http://127.0.0.1:23711';
const koraUrl = 'http://127.0.0.1:23713/';
const koraApiKey = randomBytes(24).toString('hex');
const stage = mkdtempSync(join(tmpdir(), 'lk-kora-rn-'));
const upgradeAuthority = Keypair.generate();
const payer = Keypair.generate();
const recipient = Keypair.generate();
const upgradeKeyfile = join(stage, 'validator-upgrade.json');
const program = PROGRAM_ID_MAINNET.toBase58();
const approvalProgram = 'Secp256r1SigVerify1111111111111111111111111';
const profile = new URL('../../../staging/kora/kora.protocol-v1.toml', import.meta.url);
const signersProfile = new URL('../../../staging/kora/signers.protocol-v1.toml', import.meta.url);
const devnetUsdc = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const sponsorFee = 250_000n;
const transferAmount = 1_000_000n;
const openingBalance = 10_000_000n;
const httpCalls = [];
const children = [];
const { default: bs58 } = createRequire(new URL('../../react/package.json', import.meta.url))('bs58');
console.log(JSON.stringify({ stage, rpcUrl, koraUrl }));

function launch(name, bin, args, env) {
  const log = openSync(join(stage, name + '.log'), 'w', 0o600);
  const process = spawn(bin, args, { cwd: stage, env, stdio: ['ignore', log, log] });
  closeSync(log);
  const stopped = new Promise((resolve) => process.once('close', resolve));
  children.push({ process, stopped });
  return process;
}

async function waitReady(process, probe, label) {
  for (let attempt = 0; attempt < 200 && process.exitCode === null; attempt++) {
    const ready = await probe().catch(() => false);
    if (ready) return;
    await delay(100);
  }
  const log = readFileSync(join(stage, label + '.log'), 'utf8');
  throw new Error(label + ' did not become ready. ' + log.slice(-2400));
}

const rpc = async (body) => ({
  json: await (await nativeFetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json(),
});
async function rpcCall(method, params) {
  const { json } = await rpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  return json.result;
}

async function sendSetup(connection, signer, instructions) {
  const latest = await connection.getLatestBlockhash();
  const transaction = new Transaction({ ...latest, feePayer: signer.publicKey }).add(...instructions);
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  for (let attempt = 0; attempt < 100; attempt++) {
    const { value: [status] } = await connection.getSignatureStatuses([signature]);
    assert.equal(status?.err ?? null, null);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    await delay(100);
  }
  throw new Error('Timed out confirming a local setup transaction: ' + signature);
}

async function koraRpc(method, params = []) {
  const response = await nativeFetch(koraUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': koraApiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(1000),
  });
  const result = await response.json();
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.result;
}

globalThis.fetch = async (input, init) => {
  if (input !== koraUrl) return sdkFetch(input, init);
  const request = JSON.parse(init.body);
  const response = await nativeFetch(input, init);
  const { result, error } = await response.clone().json();
  httpCalls.push({ request, result, error });
  return response;
};
setHandlers({ rpc });

async function run() {
  writeFileSync(upgradeKeyfile, JSON.stringify(Array.from(upgradeAuthority.secretKey)), { mode: 0o600 });
  const validator = launch('validator', 'solana-test-validator', [
    '--ledger', join(stage, 'ledger'), '--bind-address', '127.0.0.1', '--rpc-port', '23711',
    '--faucet-port', '23714', '--gossip-port', '23715', '--dynamic-port-range', '23716-23760',
    '--mint', upgradeAuthority.publicKey.toBase58(),
    '--deactivate-feature', 'B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g',
    '--upgradeable-program', program, baseline, upgradeKeyfile, '--quiet',
  ]);
  await waitReady(validator, async () => (await nativeFetch(rpcUrl + '/health', { signal: AbortSignal.timeout(300) })).ok, 'validator');
  const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: nativeFetch });
  while (await connection.getSlot() < 3) await delay(200);

  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({
    fromPubkey: upgradeAuthority.publicKey, toPubkey: payer.publicKey, lamports: 1_000_000_000,
  })), [upgradeAuthority]);

  const passkey = { priv: p256.utils.randomPrivateKey(), credentialId: randomBytes(32).toString('base64') };
  const credentialIdHash = createHash('sha256').update(Buffer.from(passkey.credentialId, 'base64')).digest();
  const publicKey = p256.getPublicKey(passkey.priv, true);
  const legacy = new LazorKitClient(connection, PROGRAM_ID_MAINNET);
  const { instructions, walletPda, authorityPda, vaultPda } = await legacy.createWallet({
    payer: payer.publicKey, userSeed: randomBytes(32),
    owner: { type: 'secp256r1', credentialIdHash, compressedPubkey: publicKey, rpId: RP_ID },
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer]);
  const usdc = await spl.createMint(connection, payer, payer.publicKey, null, 6);
  const [vaultAta, recipientAta, sponsorAta] = await Promise.all(
    [vaultPda, recipient.publicKey, payer.publicKey].map((owner) =>
      spl.getOrCreateAssociatedTokenAccount(connection, payer, usdc, owner, true),
    ),
  );
  await spl.mintTo(connection, payer, usdc, vaultAta.address, payer, openingBalance);

  // Provision the fee record and ATAs outside Kora so it sponsors only the Execute.
  const admin = upgradeAuthority.publicKey;
  const creationFee = 5_000n;
  let executionFee = 2_000n;
  const { instructions: initializeProtocol } = legacy.initializeProtocol({
    payer: admin, admin, treasury: admin, creationFee, executionFee, numShards: 1,
  });
  const { instructions: initializeShard, treasuryShardPda } = legacy.initializeTreasuryShard({
    payer: admin, admin, shardId: 0,
  });
  await sendSetup(connection, upgradeAuthority, [...initializeProtocol, ...initializeShard]);
  await sendSetup(connection, payer, legacy.registerPayer({ payer: payer.publicKey }).instructions);

  const mint = usdc.toBase58();
  const configPath = join(stage, 'kora.toml');
  const signersPath = join(stage, 'signers.toml');
  // The disposable ledger loads the mainnet-identical program and mints its own USDC fixture.
  const localProfile = readFileSync(profile, 'utf8')
    .replaceAll(PROGRAM_ID_DEVNET.toBase58(), program)
    .replaceAll(devnetUsdc, mint);
  writeFileSync(configPath, localProfile, { mode: 0o600 });
  writeFileSync(signersPath, readFileSync(signersProfile), { mode: 0o600 });
  const kora = launch('kora', koraBinary, [
    '--rpc-url', rpcUrl, '--config', configPath,
    'rpc', 'start', '--port', '23713', '--signers-config', signersPath,
  ], {
    PATH: process.env.PATH,
    KORA_API_KEY: koraApiKey,
    LK_PROTOCOL_STAGING_KORA_SIGNER: bs58.encode(payer.secretKey),
    RUST_LOG: 'info',
  });
  await waitReady(kora, async () => !!(await koraRpc('getVersion')).version, 'kora');
  const [version, signer, deployedConfig] = await Promise.all([
    koraRpc('getVersion'), koraRpc('getPayerSigner'), koraRpc('getConfig'),
  ]);
  assert.equal(signer.signer_address, payer.publicKey.toBase58());
  assert.equal(signer.payment_address, payer.publicKey.toBase58());
  assert.equal(deployedConfig.validation_config.price.type, 'fixed');
  assert.equal(deployedConfig.validation_config.price.amount, Number(sponsorFee));
  assert.equal(deployedConfig.validation_config.price.strict, true);
  assert.deepEqual(deployedConfig.validation_config.allowed_transaction_versions, [1]);
  assert.deepEqual(deployedConfig.validation_config.require_one_of_programs, [program]);
  assert.deepEqual(deployedConfig.validation_config.allowed_spl_paid_tokens, [mint]);
  const systemPolicy = deployedConfig.validation_config.fee_payer_policy.system;
  assert.equal(systemPolicy.allow_transfer, false);
  assert.equal(systemPolicy.protocol_v1_execute_fee_program, program);
  console.log(JSON.stringify({ kora: version, mint, feeQuoteBaseUnits: Number(sponsorFee), feePayer: signer.signer_address }));

  setPortalHandler(async (url, redirectUrl) => {
    const params = new URL(url).searchParams;
    const challenge = params.get('message');
    const preview = VersionedTransaction.deserialize(Buffer.from(params.get('transaction'), 'base64'));
    assert.equal(preview.version, 1);
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

  const transfer = (destination, amount) => spl.createTransferCheckedInstruction(
    vaultAta.address, usdc, destination, vaultPda, amount, 6,
  );
  const recipientTransfer = transfer(recipientAta.address, transferAmount);
  recipientTransfer.keys.push(...Array.from({ length: 20 }, () => ({
    pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false,
  })));

  const paymaster = { paymasterUrl: koraUrl, apiKey: koraApiKey, acceptsTxV1: true };
  const wallet = {
    credentialId: passkey.credentialId, passkeyPubkey: Array.from(publicKey),
    smartWallet: vaultPda.toBase58(), walletPda: walletPda.toBase58(),
    vaultPda: vaultPda.toBase58(), walletDevice: authorityPda.toBase58(),
  };
  const send = (instructions) => M.useWalletStore.getState().signAndExecuteTransaction({
    instructions,
    transactionOptions: { txVersion: 'v1', allowV0Fallback: false },
  }, { redirectUrl: REDIRECT });

  let confirmed = 0n;
  for (const deployment of ['baseline', 'hardened']) {
    if (deployment === 'hardened') {
      const storedWallet = await connection.getAccountInfo(walletPda);
      execFileSync('solana', [
        'program', 'deploy', '--url', rpcUrl, '--keypair', upgradeKeyfile, '--fee-payer', upgradeKeyfile,
        '--upgrade-authority', upgradeKeyfile, '--program-id', program, hardened,
      ], { timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
      const slot = await connection.getSlot();
      while (await connection.getSlot() <= slot + 1) await delay(200);
      assert.deepEqual(await connection.getAccountInfo(walletPda), storedWallet);
      executionFee = 5_000n;
      const { instructions: updateProtocol } = legacy.updateProtocol({
        admin, creationFee, executionFee, enabled: true, newTreasury: admin,
      });
      await sendSetup(connection, upgradeAuthority, updateProtocol);
    }
    M.useWalletStore.getState().setConfig({
      rpcUrl: RPC_URL, cluster: 'mainnet', protocolV1Deployment: deployment, portalUrl: PORTAL_URL,
      configPaymaster: paymaster, rpId: RP_ID,
    });
    if (deployment === 'baseline') M.useWalletStore.setState({ wallet });
    assert.equal(await connection.getBalance(vaultPda), 0);

    const payerBeforeRefusal = await connection.getBalance(payer.publicKey);
    const treasuryBefore = await connection.getBalance(treasuryShardPda);
    await assert.rejects(send([recipientTransfer]), (error) => {
      const reply = httpCalls.at(-1);
      assert.equal(reply.request.method, 'signAndSendTransaction');
      assert.match(reply.error?.message ?? '', /insufficient.*payment|payment.*required|payment.*found|payment.*insufficient/i);
      assert.equal(reply.result, undefined);
      console.log(JSON.stringify({ deployment, missingPaymentRefusal: reply.error.message, code: error.code }));
      return true;
    });
    assert.equal(await connection.getBalance(payer.publicKey), payerBeforeRefusal);
    assert.equal(await connection.getBalance(treasuryShardPda), treasuryBefore);
    assert.equal((await spl.getAccount(connection, sponsorAta.address)).amount, sponsorFee * confirmed);
    assert.equal((await spl.getAccount(connection, recipientAta.address)).amount, transferAmount * confirmed);

    const signature = await send([recipientTransfer, transfer(sponsorAta.address, sponsorFee)]);
    const call = httpCalls.at(-1);
    assert.equal(call.request.method, 'signAndSendTransaction');
    assert.equal(call.request.params.fee_token, undefined);
    assert.equal(call.result?.signature, signature);
    assert.equal(call.result?.signer_pubkey, payer.publicKey.toBase58());
    const wire = Buffer.from(call.request.params.transaction, 'base64');
    const unsigned = VersionedTransaction.deserialize(wire);
    const signed = VersionedTransaction.deserialize(Buffer.from(call.result.signed_transaction, 'base64'));
    assert.ok(wire.length > 1232 && wire.length <= 4096);
    assert.equal(unsigned.version, 1);
    assert.equal(signed.version, 1);
    assert.ok(unsigned.signatures[0].every((byte) => byte === 0));
    assert.equal(bs58.encode(signed.signatures[0]), signature);

    const landed = await rpcCall('getTransaction', [
      signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 },
    ]);
    assert.equal(landed.version, 1);
    assert.equal(landed.meta.err, null);
    const message = landed.transaction.message;
    assert.deepEqual(message.instructions.map(({ programId }) => programId), [approvalProgram, program]);
    assert.equal(message.accountKeys[0].pubkey, payer.publicKey.toBase58());
    const paidByKora = landed.meta.fee + Number(executionFee);
    assert.equal(landed.meta.preBalances[0] - landed.meta.postBalances[0], paidByKora);
    assert.equal(payerBeforeRefusal - await connection.getBalance(payer.publicKey), paidByKora);
    assert.equal(await connection.getBalance(treasuryShardPda) - treasuryBefore, Number(executionFee));
    const inner = landed.meta.innerInstructions.find(({ index }) => index === 1)?.instructions ?? [];
    const [treasuryTransfer] = inner;
    assert.equal(treasuryTransfer?.programId, SystemProgram.programId.toBase58());
    assert.equal(treasuryTransfer?.parsed?.type, 'transfer');
    assert.equal(treasuryTransfer.parsed.info.source, payer.publicKey.toBase58());
    assert.equal(treasuryTransfer.parsed.info.destination, treasuryShardPda.toBase58());
    assert.equal(treasuryTransfer.parsed.info.lamports, Number(executionFee));
    const reimbursement = inner.find(({ parsed }) => parsed?.info?.destination === sponsorAta.address.toBase58());
    assert.equal(reimbursement?.parsed?.type, 'transferChecked');
    assert.equal(reimbursement.parsed.info.source, vaultAta.address.toBase58());
    assert.equal(reimbursement.parsed.info.authority, vaultPda.toBase58());
    assert.equal(reimbursement.parsed.info.mint, mint);
    assert.equal(reimbursement.parsed.info.tokenAmount.amount, sponsorFee.toString());
    confirmed++;
    assert.equal(await connection.getBalance(vaultPda), 0);
    assert.equal((await spl.getAccount(connection, sponsorAta.address)).amount, sponsorFee * confirmed);
    assert.equal((await spl.getAccount(connection, recipientAta.address)).amount, transferAmount * confirmed);
    assert.equal((await spl.getAccount(connection, vaultAta.address)).amount, openingBalance - (sponsorFee + transferAmount) * confirmed);
    console.log(JSON.stringify({
      deployment, signature, bytes: wire.length, version: landed.version, topLevel: message.instructions.length,
      executeCpiReimbursementBaseUnits: Number(sponsorFee), koraNetworkFeeLamports: landed.meta.fee,
      protocolFeeLamports: Number(executionFee), koraTotalLamports: paidByKora,
      vaultSolLamports: 0, sponsorCumulativeTokenBaseUnits: Number(sponsorFee * confirmed),
    }));
  }
  assert.equal(httpCalls.filter(({ request }) => request.method === 'signAndSendTransaction').length, 4);
  console.log(JSON.stringify({ confirmed: Number(confirmed), upstreamKora: true, network: 'localnet' }));
}
try {
  await run();
} finally {
  for (const { process } of children.toReversed()) process.kill('SIGINT');
  await Promise.race([Promise.all(children.map(({ stopped }) => stopped)), delay(4000)]);
  for (const { process } of children) if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM');
  try { unlinkSync(upgradeKeyfile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
