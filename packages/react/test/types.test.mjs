// The public types, through the built declarations (`pnpm build` first):
// `addAuthority` without a `role` does not compile, on the hook or on the
// store, and does with one. test/types/add-authority.ts marks each call that
// must fail with @ts-expect-error; this compiles it as it is (no errors: each
// marked call fails, the rest compile), then with the marks removed, and
// checks that each marked call fails for its role. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FIXTURE = fileURLToPath(new URL('./types/add-authority.ts', import.meta.url));
const PROVIDER_FIXTURE = fileURLToPath(new URL('./types/provider-mode.ts', import.meta.url));
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
};

/** The diagnostics of `fixture` (default `FIXTURE`), compiled with `source` as its content. */
function compile(source, fixture = FIXTURE) {
    const host = ts.createCompilerHost(OPTIONS);
    const getSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
        fileName === fixture ? ts.createSourceFile(fileName, source, languageVersion, true) : getSourceFile.call(host, fileName, languageVersion, ...rest);
    const program = ts.createProgram([fixture], OPTIONS, host);
    return ts.getPreEmitDiagnostics(program).map((d) => ({
        line: d.file ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
        code: d.code,
        text: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }));
}

test('addAuthority without a role does not compile, on the hook or the store; with one it does', () => {
    const source = readFileSync(FIXTURE, 'utf8');
    assert.deepEqual(compile(source), [], 'every marked call fails to compile, and nothing else does');

    // The marks removed: the lines after them are the calls that must fail.
    const lines = source.split('\n');
    const isMark = (line) => line.trimStart().startsWith('// @ts-expect-error');
    const marked = lines.flatMap((line, i) => (isMark(line) ? [i + 2] : []));
    assert.equal(marked.length, 4);
    const errors = compile(lines.map((line) => (isMark(line) ? '' : line)).join('\n'));
    assert.deepEqual([...new Set(errors.map((e) => e.line))].sort((a, b) => a - b), marked, JSON.stringify(errors, null, 1));
    for (const line of marked) {
        const call = lines[line - 1];
        const error = errors.find((e) => e.line === line);
        if (call.includes('addAuthority()')) {
            assert.equal(error.code, 2554, call); // Expected 1 arguments, but got 0.
        } else {
            assert.match(error.text, /Property 'role' is missing/, call);
        }
    }
});

test('the provider needs a mode; Embedded needs rpId and appName; portal takes neither, nor confirm', () => {
    const source = readFileSync(PROVIDER_FIXTURE, 'utf8');
    assert.deepEqual(compile(source, PROVIDER_FIXTURE), [], 'every marked line fails to compile, and nothing else does');
    const lines = source.split('\n');
    const isMark = (line) => line.trimStart().startsWith('// @ts-expect-error');
    const marked = lines.flatMap((line, i) => (isMark(line) ? [i + 2] : []));
    assert.equal(marked.length, 5);
    const errors = compile(lines.map((line) => (isMark(line) ? '' : line)).join('\n'), PROVIDER_FIXTURE);
    assert.deepEqual([...new Set(errors.map((e) => e.line))].sort((a, b) => a - b), marked, JSON.stringify(errors, null, 1));
});
