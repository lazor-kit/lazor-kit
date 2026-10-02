// The package's three entries, through the built dist (`pnpm build` first):
// `@lazorkit/wallet`, `/core` and `/hooks` resolve in ESM and CJS (by the
// package's own name, through its `exports`), and their types through
// `exports` and, for node10 resolution, `typesVersions`; `/core` and every
// chunk it loads import no React; the React entries are client modules; and
// the entries share one store, one client and one set of classes per page.
// Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('ESM and CJS resolve the root, /core and /hooks by the package name', async () => {
    const root = await import('@lazorkit/wallet');
    const core = await import('@lazorkit/wallet/core');
    const hooks = await import('@lazorkit/wallet/hooks');
    assert.equal(typeof root.LazorkitProvider, 'function');
    assert.equal(typeof root.ConnectButton, 'function');
    assert.equal(typeof core.createLazorkitClient, 'function');
    assert.equal(core.LazorkitProvider, undefined, 'no React in /core');
    assert.equal(typeof hooks.useWalletStatus, 'function');
    const cjsRoot = require('@lazorkit/wallet');
    const cjsCore = require('@lazorkit/wallet/core');
    const cjsHooks = require('@lazorkit/wallet/hooks');
    assert.equal(typeof cjsRoot.useWallet, 'function');
    assert.equal(typeof cjsCore.verifyWalletMessage, 'function');
    assert.equal(typeof cjsHooks.useLazorkitClient, 'function');
});

test('one store, client and set of classes per page, whichever entries are imported', async () => {
    const root = await import('@lazorkit/wallet');
    const core = await import('@lazorkit/wallet/core');
    const hooks = await import('@lazorkit/wallet/hooks');
    assert.equal(hooks.useWalletStore, root.useWalletStore);
    assert.equal(hooks.useWallet, root.useWallet);
    assert.equal(core.getLazorkitClient(), root.getLazorkitClient());
    assert.equal(core.UserRejectedError, root.UserRejectedError);
    assert.equal(core.PortalCancelledError, root.PortalCancelledError);
    // A change through the root's store is the core client's state.
    root.useWalletStore.setState({ error: new Error('shared') });
    assert.equal(core.getLazorkitClient().getState().error.message, 'shared');
    root.useWalletStore.setState({ error: null });
    // Every 3.x export is still on the root.
    for (const name of ['DialogManager', 'StorageManager', 'Paymaster', 'verifyWalletMessage', 'createOwnershipChallenge', 'registerLazorkitWallet', 'LazorkitWalletAdapter', 'findWalletPda', 'SignatureReusedError', 'forgetStoredKeys']) {
        assert.ok(name in root, name);
        assert.ok(name in core, `${name} in /core`);
    }
});

/** The files a dist entry loads, itself included (relative imports, transitively). */
function graph(entry) {
    const seen = new Set();
    const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const code = readFileSync(file, 'utf8');
        for (const match of code.matchAll(/(?:from|import)\s*"(\.[^"]+)"|require\("(\.[^"]+)"\)/g)) {
            visit(join(dirname(file), match[1] ?? match[2]));
        }
    };
    visit(join(DIST, entry));
    return [...seen];
}

test('/core and every chunk it loads import no React (ESM and CJS)', () => {
    for (const entry of ['core.mjs', 'core.js']) {
        const files = graph(entry);
        assert.ok(files.length >= 2, 'core loads its shared chunk');
        for (const file of files) {
            const code = readFileSync(file, 'utf8');
            assert.doesNotMatch(code, /from\s*"react|require\("react|import\s*"react/, `${file} imports React`);
        }
    }
});

test("the React entries are client modules ('use client'); /core is not", () => {
    for (const entry of ['index.mjs', 'index.js', 'hooks.mjs', 'hooks.js']) {
        assert.match(readFileSync(join(DIST, entry), 'utf8'), /^["']use client["'];/, entry);
    }
    for (const entry of ['core.mjs', 'core.js']) {
        assert.doesNotMatch(readFileSync(join(DIST, entry), 'utf8').slice(0, 40), /use client/, entry);
    }
});

test('the types resolve for /core and /hooks: through exports (bundler, node16) and typesVersions (node10)', () => {
    const dir = join(ROOT, 'test/.pages/types');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'node_modules/@lazorkit'), { recursive: true });
    symlinkSync(ROOT, join(dir, 'node_modules/@lazorkit/wallet'), 'dir');
    const file = join(dir, 'app.ts');
    writeFileSync(
        file,
        [
            "import { createLazorkitClient, errorKind, type LazorkitClient } from '@lazorkit/wallet/core';",
            "import { useWalletStatus, useLazorkitClient } from '@lazorkit/wallet/hooks';",
            "import { LazorkitProvider, ConnectButton, useWallet } from '@lazorkit/wallet';",
            "const client: LazorkitClient = createLazorkitClient({ mode: 'embedded', rpId: 'app.example.com', appName: 'App', cluster: 'devnet' });",
            'void [client, errorKind, useWalletStatus, useLazorkitClient, LazorkitProvider, ConnectButton, useWallet];',
        ].join('\n'),
    );
    try {
        for (const [moduleResolution, module] of [
            [ts.ModuleResolutionKind.Node10, ts.ModuleKind.ESNext],
            [ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext],
            [ts.ModuleResolutionKind.Node16, ts.ModuleKind.Node16],
        ]) {
            const program = ts.createProgram([file], {
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                target: ts.ScriptTarget.ES2020,
                module,
                moduleResolution,
                lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
                types: [],
                esModuleInterop: true,
                jsx: ts.JsxEmit.ReactJSX,
                preserveSymlinks: true,
            });
            const errors = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
            assert.deepEqual(errors, [], `moduleResolution ${ts.ModuleResolutionKind[moduleResolution]}`);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
