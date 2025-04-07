import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

// Polyfills
const polyfills = {
  name: 'polyfills',
  resolveId(id) {
    if (id === 'buffer') return { id, external: true };
    if (id === 'process') return { id, external: true };
    return null;
  }
};

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      polyfills,
      resolve({
        browser: true,
        preferBuiltins: true,
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json']
      }),
      commonjs({
        include: /node_modules/,
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }),
      json(),
      typescript({
        exclude: ['**/*.test.ts', '**/*.test.tsx'],
        tsconfig: './tsconfig.json'
      }),
      postcss({
        modules: true,
        extract: true,
      }),
    ],
    external: ['react', 'react-dom', 'buffer', 'process'],
  },
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
  },
]; 