/**
 * A mock cluster for the wallet's send flows: a small stateful ledger
 * answering the wallet's JSON-RPC, and a mock paymaster that signs with the
 * corpus fee payer and "lands" what it is sent. Everything is recorded in
 * call order:
 *
 *   rpc        every JSON-RPC request the wallet's Connection made: method + params
 *   paymaster  every paymaster request: method, the exact body string, headers
 *   sends      each transaction the paymaster received, decoded
 *
 * The ledger models only what the wallet reads: account data (with
 * getProgramAccounts filters), one slot that advances on each landing, a fixed
 * blockhash and block height, and signature statuses. A landing applies the
 * LazorKit effects the next reads depend on: a passkey instruction bumps its
 * authority's counter, Authorize creates its DeferredExec account (expires_at
 * = landing slot + the instruction's offset), ExecuteDeferred closes it,
 * RegisterPayer creates the payer's FeeRecord.
 *
 * Legacy and v0 transactions are handled exactly as the flag-off goldens were
 * captured (test/fixtures/flagoff.web.json): nothing below that serves them
 * may change. SIMD-0385 v1 transactions (first byte 0x81) are decoded with
 * web3.js 1.99 and signed for the fee payer at the byte level, as the v1
 * relayer does; `options.txV1` scripts the v1-only behaviour (the paymaster's
 * -32051 refusal, the limit simulation, raw getTransaction logs).
 *
 * Nothing here is random and nothing waits on a clock unless a test scripts a
 * delay, so a case's recording depends only on the wallet code under test.
 */
import { createHash } from 'node:crypto';
import { BLOCK_HEIGHT0, SLOT0, SLOTS_PER_LANDING } from './corpus.mjs';

const SECP256R1_PROGRAM = 'Secp256r1SigVerify1111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const TX_V1_PREFIX = 0x81;

/**
 * @param fault  an entry of corpus FAULTS, or undefined for a clean run
 * @param p256   @noble/curves p256, to check the Secp256r1 precompile's signatures
 * @param slot0  the ledger's first slot (default SLOT0, as the goldens were captured)
 * @param txV1   v1-only scripting (all optional):
 *   refuse        the paymaster answers every v1 request with -32051, before signing
 *   simulate(req) the `simulateTransaction` value for a v1 transaction, or
 *                 { error } / { http } / { delayMs, value }; default: 13,011 CU, 161,320 B loaded
 *   transaction(sig, config)  the raw `getTransaction` result for a v1 signature
 */
export function makeMockCluster({ web3, sdk, bs58, ed25519, p256, corpus, accounts, fault, txV1 = {}, slot0 = SLOT0 }) {
  const { VersionedTransaction, PublicKey } = web3;
  const programId = corpus.programId.toBase58();
  const D = sdk.ACCOUNT_DISCRIMINATOR;

  const ledger = {
    slot: slot0,
    accounts, // Map<base58, {owner, data: Buffer, lamports, label}>
    statuses: new Map(), // signature -> { slot, err }
    sendAttempts: 0,
  };
  const rec = { rpc: [], paymaster: [], sends: [] };

  // ── JSON-RPC helpers ───────────────────────────────────────────────
  const ctx = () => ({ apiVersion: '2.3.0', slot: ledger.slot });
  const accountJson = (a) =>
    a
      ? {
          data: [a.data.toString('base64'), 'base64'],
          executable: false,
          lamports: a.lamports,
          owner: a.owner,
          rentEpoch: 18446744073709551615,
          space: a.data.length,
        }
      : null;
  const notReached = (config) =>
    config && typeof config.minContextSlot === 'number' && config.minContextSlot > ledger.slot
      ? { code: -32016, message: 'Minimum context slot has not been reached', data: { contextSlot: ledger.slot } }
      : null;
  const decodeBytes = (s, encoding) => (encoding === 'base64' ? Buffer.from(s, 'base64') : Buffer.from(bs58.decode(s)));
  const matches = (data, filters = []) =>
    filters.every((f) => {
      if (f.dataSize !== undefined) return data.length === f.dataSize;
      if (f.memcmp) {
        const want = decodeBytes(f.memcmp.bytes, f.memcmp.encoding);
        const off = f.memcmp.offset;
        return data.length >= off + want.length && data.subarray(off, off + want.length).equals(want);
      }
      return false;
    });

  async function rpcResult(method, params = []) {
    switch (method) {
      case 'getAccountInfo': {
        const err = notReached(params[1]);
        if (err) return { error: err };
        return { result: { context: ctx(), value: accountJson(ledger.accounts.get(params[0])) } };
      }
      case 'getMultipleAccounts': {
        const err = notReached(params[1]);
        if (err) return { error: err };
        return { result: { context: ctx(), value: params[0].map((k) => accountJson(ledger.accounts.get(k))) } };
      }
      case 'getProgramAccounts': {
        const config = params[1] ?? {};
        const err = notReached(config);
        if (err) return { error: err };
        const value = [...ledger.accounts.entries()]
          .filter(([, a]) => a.owner === params[0] && matches(a.data, config.filters))
          .map(([pubkey, a]) => ({ pubkey, account: accountJson(a) }));
        return { result: config.withContext ? { context: ctx(), value } : value };
      }
      case 'getBalance': {
        const err = notReached(params[1]);
        if (err) return { error: err };
        return { result: { context: ctx(), value: ledger.accounts.get(params[0])?.lamports ?? 0 } };
      }
      case 'getSlot': {
        const err = notReached(params[0]);
        if (err) return { error: err };
        return { result: ledger.slot };
      }
      case 'getBlockHeight':
        return { result: BLOCK_HEIGHT0 };
      case 'getLatestBlockhash': {
        const err = notReached(params[0]);
        if (err) return { error: err };
        return { result: { context: ctx(), value: { blockhash: corpus.blockhash, lastValidBlockHeight: BLOCK_HEIGHT0 + 150 } } };
      }
      case 'getEpochInfo':
        return {
          result: {
            absoluteSlot: ledger.slot,
            blockHeight: BLOCK_HEIGHT0,
            epoch: Math.floor(ledger.slot / 432_000),
            slotIndex: ledger.slot % 432_000,
            slotsInEpoch: 432_000,
            transactionCount: null,
          },
        };
      case 'getSignatureStatuses': {
        const value = params[0].map((sig) => {
          const st = ledger.statuses.get(sig);
          if (!st) return null;
          return { slot: st.slot, confirmations: 0, err: st.err ?? null, status: st.err ? { Err: st.err } : { Ok: null }, confirmationStatus: 'confirmed' };
        });
        return { result: { context: ctx(), value } };
      }
      case 'simulateTransaction': {
        if (isV1(Buffer.from(params[0], 'base64'))) return simulateV1(params);
        return {
          result: {
            context: ctx(),
            value: fault?.simulateLogs
              ? { err: { InstructionError: [1, { Custom: 3006 }] }, logs: fault.simulateLogs(programId), accounts: null, unitsConsumed: 9_000, returnData: null }
              : { err: null, logs: [], accounts: null, unitsConsumed: 13_011, returnData: null },
          },
        };
      }
      case 'getTransaction': {
        const signature = params[0];
        if (v1Signatures.has(signature)) {
          if ((params[1]?.maxSupportedTransactionVersion ?? -1) < 1) {
            return {
              error: {
                code: -32015,
                message:
                  'Transaction version (1) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": 1',
              },
            };
          }
          return { result: txV1.transaction ? txV1.transaction(signature, params[1]) : null };
        }
        return { result: null };
      }
      case 'getMinimumBalanceForRentExemption':
        return { result: (128 + (params[0] ?? 0)) * 6960 };
      case 'getGenesisHash':
        return { result: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
      default:
        return { error: { code: -32601, message: `Method not found (mock cluster): ${method}` } };
    }
  }

  /** A v1 `simulateTransaction`: what `txV1.simulate` scripts, else a clean LazorKit Execute. */
  async function simulateV1(params) {
    const scripted = txV1.simulate
      ? await txV1.simulate({ params, slot: ledger.slot })
      : { value: { err: null, logs: [], accounts: null, unitsConsumed: 13_011, loadedAccountsDataSize: 161_320, returnData: null } };
    if (scripted?.delayMs) await new Promise((resolve) => setTimeout(resolve, scripted.delayMs));
    if (scripted?.http) return { http: scripted.http, text: scripted.text ?? '' };
    if (scripted?.error) return { error: scripted.error };
    const err = notReached(params[1]);
    if (err) return { error: err };
    return { result: { context: ctx(), value: scripted.value } };
  }

  async function rpc(body) {
    const parsed = JSON.parse(body);
    const one = async (req) => {
      rec.rpc.push({ method: req.method, params: req.params ?? [] });
      const out = await rpcResult(req.method, req.params ?? []);
      if (out.http) return out;
      return { jsonrpc: '2.0', id: req.id, ...out };
    };
    if (Array.isArray(parsed)) return { json: await Promise.all(parsed.map(one)) };
    const out = await one(parsed);
    if (out.http) return { status: out.http, json: out.text };
    return { json: out };
  }

  // ── decoding ───────────────────────────────────────────────────────
  const isV1 = (bytes) => bytes.length > 0 && bytes[0] === TX_V1_PREFIX;
  /** Signatures of v1 transactions the paymaster has seen (their logs need maxSupportedTransactionVersion 1). */
  const v1Signatures = new Set();

  function keysOf(tx) {
    const msg = tx.message;
    const luts = (msg.addressTableLookups ?? []).map((l) => corpus.lookupTables[l.accountKey.toBase58()]);
    if (luts.some((t) => !t)) throw new Error('mock cluster: transaction uses a lookup table the corpus does not know');
    return msg.getAccountKeys({ addressLookupTableAccounts: luts });
  }

  function decode(bytes) {
    if (isV1(bytes)) return decodeV1(bytes);
    const tx = VersionedTransaction.deserialize(bytes);
    const msg = tx.message;
    const keys = keysOf(tx);
    const header = msg.header;
    const required = header.numRequiredSignatures;
    const staticKeys = msg.staticAccountKeys;
    const messageBytes = msg.serialize();
    const signatures = tx.signatures.map((sig, i) => {
      const zero = sig.every((b) => b === 0);
      return {
        signer: staticKeys[i].toBase58(),
        present: !zero,
        valid: zero ? null : ed25519.verify(sig, messageBytes, staticKeys[i].toBytes()),
      };
    });
    const instructions = msg.compiledInstructions.map((ix) => {
      const program = keys.get(ix.programIdIndex).toBase58();
      return {
        program,
        accounts: ix.accountKeyIndexes.map((i) => keys.get(i).toBase58()),
        dataLength: ix.data.length,
        discriminator: program === programId || program === COMPUTE_BUDGET_PROGRAM ? ix.data[0] : undefined,
        ...(program === SECP256R1_PROGRAM ? { precompileSignaturesValid: precompileValid(ix.data) } : {}),
        data: ix.data,
      };
    });
    return {
      tx,
      summary: {
        version: tx.version,
        bytes: bytes.length,
        messageBytes: messageBytes.length,
        numRequiredSignatures: required,
        staticAccountKeys: staticKeys.length,
        lookups: (msg.addressTableLookups ?? []).map((l) => ({ table: l.accountKey.toBase58(), writable: l.writableIndexes.length, readonly: l.readonlyIndexes.length })),
        totalAccountKeys: keys.length,
        recentBlockhash: msg.recentBlockhash,
        signatures,
        instructions: instructions.map(({ data, ...rest }) => rest),
      },
      instructions,
    };
  }

  /** A v1 transaction: web3.js 1.99 reads it; the signatures are the last 64 × n bytes, over everything before them. */
  function decodeV1(bytes) {
    const tx = VersionedTransaction.deserialize(bytes);
    const msg = tx.message;
    const required = bytes[1];
    const messageLength = bytes.length - 64 * required;
    const messageBytes = bytes.subarray(0, messageLength);
    const keys = msg.staticAccountKeys;
    const signatures = Array.from({ length: required }, (_, i) => {
      const sig = bytes.subarray(messageLength + 64 * i, messageLength + 64 * (i + 1));
      const zero = sig.every((b) => b === 0);
      return {
        signer: keys[i].toBase58(),
        present: !zero,
        valid: zero ? null : ed25519.verify(sig, messageBytes, keys[i].toBytes()),
      };
    });
    const instructions = msg.compiledInstructions.map((ix) => {
      const program = keys[ix.programIdIndex].toBase58();
      return {
        program,
        accounts: ix.accountKeyIndexes.map((i) => keys[i].toBase58()),
        dataLength: ix.data.length,
        discriminator: program === programId || program === COMPUTE_BUDGET_PROGRAM ? ix.data[0] : undefined,
        ...(program === SECP256R1_PROGRAM ? { precompileSignaturesValid: precompileValid(ix.data) } : {}),
        data: ix.data,
      };
    });
    return {
      tx,
      v1: { messageLength, required },
      summary: {
        version: tx.version,
        bytes: bytes.length,
        messageBytes: messageLength,
        numRequiredSignatures: required,
        staticAccountKeys: keys.length,
        totalAccountKeys: keys.length,
        recentBlockhash: msg.recentBlockhash,
        transactionConfig: msg.transactionConfig,
        signatures,
        instructions: instructions.map(({ data, ...rest }) => rest),
      },
      instructions,
    };
  }

  /** Secp256r1SigVerify data: count, pad, then 7 u16 offsets per signature; all inline (index 0xffff). */
  function precompileValid(data) {
    const d = Buffer.from(data);
    const n = d[0];
    for (let k = 0; k < n; k++) {
      const o = (i) => d.readUInt16LE(2 + k * 14 + i * 2);
      const sig = d.subarray(o(0), o(0) + 64);
      const pub = d.subarray(o(2), o(2) + 33);
      const message = d.subarray(o(4), o(4) + o(5));
      const digest = createHash('sha256').update(message).digest();
      if (!p256.verify(sig, digest, pub, { lowS: false })) return false;
    }
    return n > 0;
  }

  /** The landing: the slot moves on, the signature gets a status, LazorKit's effects apply (none when it failed). */
  function land(decoded, signature, err) {
    ledger.slot += SLOTS_PER_LANDING;
    const slot = ledger.slot;
    ledger.statuses.set(signature, { slot, err: err ?? null });
    const effects = [];
    if (err) return { slot, effects: [`failed: ${JSON.stringify(err)}`] };
    const passkeySigned = decoded.instructions.some((ix) => ix.program === SECP256R1_PROGRAM);
    for (const ix of decoded.instructions) {
      if (ix.program !== programId) continue;
      const disc = ix.data[0];
      if (passkeySigned && (disc === sdk.DISC_EXECUTE || disc === sdk.DISC_AUTHORIZE)) {
        const authority = ledger.accounts.get(ix.accounts[2]);
        if (authority) {
          const counter = authority.data.readUInt32LE(8) + 1;
          authority.data.writeUInt32LE(counter, 8);
          effects.push(`counter ${ix.accounts[2]} -> ${counter}`);
        }
      }
      if (disc === sdk.DISC_AUTHORIZE) {
        const expiryOffset = Buffer.from(ix.data).readUInt16LE(65);
        const expiresAt = BigInt(slot + expiryOffset);
        const data = Buffer.alloc(176);
        data[0] = D.DEFERRED_EXEC;
        data[1] = 1;
        Buffer.from(ix.data.subarray(1, 33)).copy(data, 8);
        Buffer.from(ix.data.subarray(33, 65)).copy(data, 40);
        new PublicKey(ix.accounts[1]).toBuffer().copy(data, 72);
        new PublicKey(ix.accounts[2]).toBuffer().copy(data, 104);
        new PublicKey(ix.accounts[0]).toBuffer().copy(data, 136);
        data.writeBigUInt64LE(expiresAt, 168);
        ledger.accounts.set(ix.accounts[3], { owner: programId, data, lamports: (128 + 176) * 6960, label: 'DeferredExec' });
        effects.push(`DeferredExec ${ix.accounts[3]} created, expires_at ${expiresAt}`);
      }
      if (disc === sdk.DISC_EXECUTE_DEFERRED) {
        ledger.accounts.delete(ix.accounts[3]);
        effects.push(`DeferredExec ${ix.accounts[3]} closed`);
      }
      if (disc === sdk.DISC_REGISTER_PAYER) {
        const data = Buffer.alloc(32);
        data[0] = D.FEE_RECORD;
        data[2] = 1;
        data.writeBigUInt64LE(BigInt(slot), 24);
        ledger.accounts.set(ix.accounts[1], { owner: programId, data, lamports: (128 + 32) * 6960, label: 'FeeRecord (fee payer)' });
        effects.push(`FeeRecord ${ix.accounts[1]} created`);
      }
    }
    return { slot, effects };
  }

  // ── paymaster ──────────────────────────────────────────────────────
  const payer = corpus.feePayer;
  function signForPayer(params) {
    if (!params || typeof params.transaction !== 'string') throw { code: -32602, message: 'mock paymaster: no transaction' };
    if (params.signer_key !== undefined && params.signer_key !== payer.publicKey.toBase58()) {
      throw { code: -32602, message: `mock paymaster: signer_key ${params.signer_key} is not this paymaster's` };
    }
    const bytes = Buffer.from(params.transaction, 'base64');
    if (isV1(bytes) && txV1.refuse) {
      // The v1 relayer with --tx-v1 off: refused at decode, before any signing.
      throw { code: -32051, message: 'transaction version 1 is not enabled on this paymaster' };
    }
    const decoded = decode(bytes);
    if (!decoded.tx.message.staticAccountKeys[0].equals(payer.publicKey)) {
      throw { code: -32602, message: 'mock paymaster: the fee payer is not account 0' };
    }
    const bad = decoded.summary.signatures.filter((s) => s.present && !s.valid);
    if (bad.length) throw { code: -32003, message: `mock paymaster: invalid signature(s) for ${bad.map((s) => s.signer).join(', ')}` };
    if (decoded.instructions.some((ix) => ix.precompileSignaturesValid === false)) {
      throw { code: -32002, message: 'mock paymaster: Transaction simulation failed: a Secp256r1 precompile signature does not verify' };
    }
    if (decoded.v1) {
      // Byte level, as the v1 relayer signs: the fee payer is address 0, so its slot is the first after the message.
      const signed = Buffer.from(bytes);
      const sig = ed25519.sign(signed.subarray(0, decoded.v1.messageLength), payer.secretKey.subarray(0, 32));
      Buffer.from(sig).copy(signed, decoded.v1.messageLength);
      const signature = bs58.encode(sig);
      v1Signatures.add(signature);
      return { decoded, signature, signed: signed.toString('base64') };
    }
    decoded.tx.sign([payer]);
    const signature = bs58.encode(decoded.tx.signatures[0]);
    return { decoded, signature, signed: Buffer.from(decoded.tx.serialize()).toString('base64') };
  }

  async function paymaster(body, headers) {
    const req = JSON.parse(body);
    rec.paymaster.push({
      method: req.method,
      body,
      headers: Object.fromEntries(Object.entries(headers).filter(([k]) => k === 'content-type' || k === 'x-api-key')),
    });
    const ok = (result) => ({ json: { jsonrpc: '2.0', id: req.id, result } });
    const fail = (error) => ({ json: { jsonrpc: '2.0', id: req.id, error } });
    try {
      switch (req.method) {
        case 'getPayerSigner':
          return ok({ signer_address: payer.publicKey.toBase58(), payment_address: payer.publicKey.toBase58() });
        case 'getBlockhash':
          return ok({ blockhash: corpus.blockhash });
        case 'signTransaction': {
          const { signature, signed, decoded } = signForPayer(req.params);
          rec.sends.push({ method: req.method, signature, ...decoded.summary });
          return ok({ signature, signed_transaction: signed, signer_pubkey: payer.publicKey.toBase58() });
        }
        case 'signAndSendTransaction': {
          const attempt = ledger.sendAttempts++;
          const plan = fault?.always ?? fault?.sends?.[attempt];
          if (plan?.http) {
            rec.sends.push({ method: req.method, attempt, fault: `HTTP ${plan.http}`, sent: false });
            return { status: plan.http, json: plan.text ?? '' };
          }
          const { signature, signed, decoded } = signForPayer(req.params);
          if (plan?.error && !plan.land) {
            rec.sends.push({ method: req.method, attempt, fault: plan.error, sent: false, signature, ...decoded.summary });
            return fail(plan.error);
          }
          const landed = land(decoded, signature, fault?.landedErr);
          rec.sends.push({ method: req.method, attempt, signature, sent: true, landedSlot: landed.slot, effects: landed.effects, ...decoded.summary });
          if (plan?.error) return fail({ ...plan.error, data: { ...(plan.error.data ?? {}), signature } });
          return ok({ signature, signed_transaction: signed, signer_pubkey: payer.publicKey.toBase58() });
        }
        default:
          return fail({ code: -32601, message: `Method not found (mock paymaster): ${req.method}` });
      }
    } catch (e) {
      if (e && typeof e.code === 'number') {
        if (req.method === 'signAndSendTransaction') rec.sends.push({ method: req.method, refused: e, sent: false });
        return fail(e);
      }
      return fail({ code: -32603, message: `mock paymaster: ${e?.message ?? e}` });
    }
  }

  return { ledger, rec, rpc, paymaster, decode };
}
