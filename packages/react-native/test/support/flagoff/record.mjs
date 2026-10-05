/** Recording helpers shared by the web and mobile case runners. */

const STEP_TIMEOUT_MS = 90_000;

/** What an error says, field by field (no stack: paths differ between machines). */
export function errorRecord(e, depth = 0) {
  if (e === null || e === undefined) return null;
  if (!(e instanceof Error) && typeof e !== 'object') return { thrown: String(e) };
  const out = {
    name: e.name ?? null,
    constructor: e.constructor?.name ?? null,
    message: typeof e.message === 'string' ? e.message : String(e),
  };
  for (const k of ['code', 'httpStatus', 'signature', 'maybeSent', 'stage', 'pendingSignature', 'authorizeSignature', 'slot']) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  if (e.data !== undefined) out.data = e.data;
  if (e.logs !== undefined) out.logs = e.logs;
  if (e.transactionError !== undefined) out.transactionError = e.transactionError;
  if (e.deferredExecPda !== undefined) out.deferredExecPda = e.deferredExecPda?.toBase58?.() ?? String(e.deferredExecPda);
  if (e.expiresAtSlot !== undefined) out.expiresAtSlot = String(e.expiresAtSlot);
  if (e instanceof RangeError) out.isRangeError = true;
  if (e.cause !== undefined && depth < 2) out.cause = errorRecord(e.cause, depth + 1);
  return out;
}

/** Collect the package's console output (first-line text only), and keep stdout quiet. */
export function recordConsole() {
  const lines = [];
  const show = (a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? `${v}n` : v))?.slice(0, 400) ?? String(a);
    } catch {
      return String(a);
    }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    console[level] = (...args) => lines.push(`${level}: ${args.map(show).join(' ')}`);
  }
  return lines;
}

/**
 * Run one wallet call and note which RPC requests, paymaster requests,
 * portal opens and sends belong to it (as index ranges into the case's logs).
 */
export async function runStep({ steps, call, fn, show, cluster, portal }) {
  const at = () => ({ rpc: cluster.rec.rpc.length, paymaster: cluster.rec.paymaster.length, portal: portal.opens.length, sends: cluster.rec.sends.length });
  const from = at();
  const record = { call };
  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`flagoff: ${call} did not settle within ${STEP_TIMEOUT_MS} ms`), { name: 'FlagoffStepTimeout' })), STEP_TIMEOUT_MS);
      }),
    ]);
    record.ok = true;
    record.raw = value;
    record.value = show(value);
  } catch (error) {
    record.ok = false;
    record.error = errorRecord(error);
  } finally {
    clearTimeout(timer);
  }
  const to = at();
  record.ranges = Object.fromEntries(Object.keys(from).map((k) => [k, [from[k], to[k]]]));
  steps.push(record);
  return record;
}
