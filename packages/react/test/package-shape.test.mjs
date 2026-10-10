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

// The root's exports are 3.4.1's (test/fixtures/exports-3.4.1.json: the
// export names of dist/index.mjs in the published 3.4.1 tarball, shasum
// e4adf51d8ee53dd8a8833beed415e95348027d07), none removed, plus these. Nothing
// else: an internal binding a chunk shares with another entry never shows.
const V341 = JSON.parse(readFileSync(new URL('./fixtures/exports-3.4.1.json', import.meta.url), 'utf8'));
const NEW_IN_4 = [
    'CONNECT_BUTTON_TEXT', 'ConnectButton', 'KeyRecoveryError', 'LazorkitConfigError', 'NetworkError', 'PasskeyMismatchError',
    'PasskeyUnavailableError', 'UserRejectedError', 'WalletVerificationError', 'builtinEmbeddedUi', 'connectButtonLabel',
    'createLazorkitClient', 'derToLowS', 'deriveStatus', 'errorKind', 'forgetEmbeddedDevice', 'getLazorkitClient',
    'isUserRejection', 'passkeyCapabilities', 'publicKeyFromAttestation', 'resolveConfig', 'userMessage', 'validateRpId',
    // Typed approval requests and time-based session expiry (#130).
    'MAX_SESSION_SECONDS', 'PortalRefusedError', 'PortalReplyMismatchError', 'RequestOutOfDateError', 'TypedRequestTooLargeError',
];
const REACT_ONLY = ['CONNECT_BUTTON_TEXT', 'ConnectButton', 'LazorkitProvider', 'connectButtonLabel', 'useWallet', 'useWalletStore'];
const HOOKS = ['useLazorkitClient', 'useLazorkitState', 'useWallet', 'useWalletStatus', 'useWalletStore'];
const names = (module) => Object.keys(module).filter((k) => k !== '__esModule' && k !== 'default').sort();

test("each entry exports exactly its names: the root 3.4.1's plus 4.0's, /core the root's without React, /hooks its five (ESM, CJS, types)", async () => {
    const root = [...new Set([...V341, ...NEW_IN_4])].sort();
    const core = root.filter((n) => !REACT_ONLY.includes(n));
    for (const [entry, expected] of [
        ['index', root],
        ['core', core],
        ['hooks', HOOKS],
    ]) {
        assert.deepEqual(names(await import(join(DIST, `${entry}.mjs`))), expected, `${entry}.mjs`);
        assert.deepEqual(names(require(join(DIST, `${entry}.js`))), expected, `${entry}.js`);
        // The declarations: no minified alias among the names a type import sees.
        const program = ts.createProgram([join(DIST, `${entry}.d.ts`)], { noEmit: true, skipLibCheck: true, types: [] });
        const checker = program.getTypeChecker();
        const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(join(DIST, `${entry}.d.ts`)))).map((s) => s.name);
        assert.deepEqual(exported.filter((n) => n.length <= 2), [], `${entry}.d.ts`);
        for (const name of expected) assert.ok(exported.includes(name), `${name} in ${entry}.d.ts`);
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
