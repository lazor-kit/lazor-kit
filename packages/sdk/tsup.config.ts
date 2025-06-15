import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: [
    '@solana/web3.js',
    'react',
    'react/jsx-runtime',
    'bs58',
    'js-sha256'
  ],
  noExternal: ['eventemitter3'],
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";'
    };
  }
});