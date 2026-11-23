// Loads the wallets' v1 writer (TypeScript) into Node. TypeScript's
// transpileModule strips the types (`pnpm --filter @lazorkit/wallet typecheck`
// checks them); the result is written under this package's node_modules, so
// its import resolves to this package's @solana/web3.js.
// Both copies are byte-identical (scripts/check-txv1-identical.mjs), so the
// oracle runs the web one.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..', '..');
export const WRITER_PATH = join(ROOT, 'packages', 'react', 'core', 'wallet', 'txv1.ts');
export const VECTORS_PATH = join(ROOT, 'test-vectors', 'txv1.json');

export async function loadWriter(path = WRITER_PATH) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
  }).outputText;
  const dir = join(here, '..', 'node_modules', '.cache', 'txv1-oracle');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash('sha256').update(code).digest('hex').slice(0, 16)}.mjs`);
  if (!existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, code);
    renameSync(tmp, file);
  }
  return import(pathToFileURL(file).href);
}
