// Three entries in one build: `index` (the root, React), `core`
// (`@lazorkit/wallet/core`, no React) and `hooks` (`@lazorkit/wallet/hooks`).
// Modules they share go into chunks, so the store, the passkey lanes and the
// other page-wide state exist once per page whichever entries an app imports.
// `core` and the chunks it loads never import React.
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';
import { createRequire } from 'module';
import { relative, sep } from 'path';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const input = { index: 'index.ts', core: 'core-entry.ts', hooks: 'hooks-entry.ts' };

// Dependencies and peers, and any subpath of one (`zustand/vanilla`,
// `@noble/curves/nist.js`, `react/jsx-runtime`): `external` matches whole
// import ids, so a package's name alone would bundle its subpaths.
const externalNames = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    'crypto',
];
const external = (id) => externalNames.some((name) => id === name || id.startsWith(`${name}/`));

// React's entries are client modules for frameworks with server components
// (Next.js App Router). Terser keeps the directive (`directives: false`).
const CLIENT_ENTRIES = new Set(['index', 'hooks']);
const banner = (chunk) => (chunk.isEntry && CLIENT_ENTRIES.has(chunk.name) ? "'use client';" : '');

// Two shared chunks, named for what they hold: `shared` (no React; all that
// `core` loads) and `react`. Every entry is a facade over them. The React
// entries themselves stay out of the `react` chunk: an entry put in a chunk
// becomes that chunk, and would then export the chunk's internal (minified)
// bindings to the other entry. (`core-entry` only re-exports, and the root
// re-exports it, so it is part of `shared`.)
const manualChunks = (id) => {
    if (id.includes('node_modules') || id.startsWith('\0')) return undefined;
    const file = relative(process.cwd(), id);
    if (file === 'index.ts' || file === 'hooks-entry.ts') return undefined;
    if (file.startsWith(`react${sep}`)) return 'react';
    return 'shared';
};

export default [
    {
        input,
        output: [
            {
                dir: 'dist',
                format: 'cjs',
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                manualChunks,
                banner,
                sourcemap: true,
            },
            {
                dir: 'dist',
                format: 'esm',
                entryFileNames: '[name].mjs',
                chunkFileNames: 'chunks/[name]-[hash].mjs',
                manualChunks,
                banner,
                sourcemap: true,
            },
        ],
        plugins: [
            resolve({ preferBuiltins: true }),
            commonjs(),
            json(),
            typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
            terser({ compress: { directives: false } }),
        ],
        external,
    },
    {
        input,
        output: {
            dir: 'dist',
            format: 'es',
            entryFileNames: '[name].d.ts',
            chunkFileNames: 'chunks/[name]-[hash].d.ts',
            manualChunks,
        },
        plugins: [dts()],
        external,
    },
];
