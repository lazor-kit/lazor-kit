// The public types, through the built declarations (`pnpm build` first):
// `addAuthorityEd25519` without a `role` does not compile, on the hook or on
// the store, and does with one. test/types/add-authority.ts marks each call
// that must fail with @ts-expect-error; this compiles it as it is (no errors:
// each marked call fails, the rest compile), then with the marks removed, and
// checks that each marked call fails for its role. Run with `pnpm test`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const FIXTURE = path.join(__dirname, 'types', 'add-authority.ts');
const OPTIONS = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
  types: [],
  esModuleInterop: true,
  jsx: ts.JsxEmit.React,
};

/** The diagnostics of `FIXTURE`, compiled with `source` as its content. */
function compile(source) {
  const host = ts.createCompilerHost(OPTIONS);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === FIXTURE
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile.call(host, fileName, languageVersion, ...rest);
  const program = ts.createProgram([FIXTURE], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ({
    line: d.file ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
    code: d.code,
    text: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
}

test('addAuthorityEd25519 without a role does not compile, on the hook or the store; with one it does', () => {
  const source = readFileSync(FIXTURE, 'utf8');
  assert.deepEqual(compile(source), [], 'every marked call fails to compile, and nothing else does');

  const lines = source.split('\n');
  const isMark = (line) => line.trimStart().startsWith('// @ts-expect-error');
  const marked = lines.flatMap((line, i) => (isMark(line) ? [i + 2] : []));
  assert.equal(marked.length, 2);
  const errors = compile(lines.map((line) => (isMark(line) ? '' : line)).join('\n'));
  assert.deepEqual([...new Set(errors.map((e) => e.line))].sort((a, b) => a - b), marked, JSON.stringify(errors, null, 1));
  for (const line of marked) {
    assert.match(errors.find((e) => e.line === line).text, /Property 'role' is missing/, lines[line - 1]);
  }
});
