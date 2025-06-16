import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const { dependencies, peerDependencies } = pkg;

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: false,
  sourcemap: true,
  external: [
    ...Object.keys(dependencies || {}),
    ...Object.keys(peerDependencies || {})
  ],
};

import { build } from 'esbuild';

Promise.all([
  build({
    ...shared,
    format: 'esm',
    outfile: 'dist/index.esm.js',
  }),
  build({
    ...shared,
    format: 'cjs',
    outfile: 'dist/index.js',
  })
]).catch(() => process.exit(1));
