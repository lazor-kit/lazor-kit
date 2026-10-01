/**
 * The flag-off check (U4 of the txv1 design): with `txVersion` omitted or
 * 'v0', every send flow must make exactly the requests the published 2.2.1
 * made, in the same order, and end the same way.
 *
 * `runCase` runs one case of the corpus matrix in a fresh process
 * (./case.cjs); `compact` reduces its record to what is compared:
 *
 *   steps      each call: name, ok, value, and the error's fields except
 *              `constructor` (a minifier renames classes; `name` is the API)
 *   paymaster  each request: method, headers, and the body's SHA-256 and length
 *   rpc        each JSON-RPC request in order: method, and its params' SHA-256
 *   portal     each portal page opened: action, and its parameters' SHA-256
 *
 * The golden (test/fixtures/flagoff.mobile.json) was recorded from 2.2.1's own
 * dist/index.js by ./capture.mjs, with this workspace's dependencies, so a
 * difference is the adapter's own.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** JSON with object keys sorted, so key order never counts as a difference. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const digest = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}:${Buffer.byteLength(text)}`;

function stripConstructor(e) {
  if (!e || typeof e !== 'object') return e;
  const { constructor: _c, cause, ...rest } = e;
  return cause ? { ...rest, cause: stripConstructor(cause) } : rest;
}

/** What a case's record is compared on. */
export function compact(record) {
  return {
    steps: record.steps.map((s) => ({ call: s.call, ok: s.ok, value: s.value ?? null, error: s.ok ? null : stripConstructor(s.error) })),
    paymaster: record.paymaster.map((p) => ({ method: p.method, headers: p.headers, body: digest(p.body) })),
    rpc: record.rpc.map((r) => ({ method: r.method, params: digest(canonical(r.params)) })),
    portal: record.portal.map((p) => ({ action: p.action, params: digest(canonical(p.params)) })),
  };
}

/** One case through the adapter at `dist`, in its own process. Resolves with the full record. */
export function runCase(dist, kase, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'case.cjs'), dist, JSON.stringify(kase)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(`exit ${code}`);
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`${kase.id}: the case runner failed (${error.message})\n${stderr.slice(-4000)}`));
      }
    });
  });
}

/** Run `items` through `fn`, `jobs` at a time, in order of the results. */
export async function pool(items, jobs, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
