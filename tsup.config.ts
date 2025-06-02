import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['@solana/web3.js'],
  noExternal: ['eventemitter3'],
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";'
    };
  }
});