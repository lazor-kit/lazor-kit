import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

export function createRollupConfig({
    input = 'index.ts',
    outputDir = 'dist',
    tsconfig = './tsconfig.json',
    external = [],
    noExternal = [],
    plugins = []
} = {}) {
    return [
        {
            input,
            output: [
                {
                    file: `${outputDir}/index.js`,
                    format: 'cjs',
                    sourcemap: true,
                },
                {
                    file: `${outputDir}/index.mjs`,
                    format: 'esm',
                    sourcemap: true,
                }
            ],
            plugins: [
                resolve({
                    preferBuiltins: true
                }),
                commonjs(),
                json(),
                typescript({ tsconfig }),
                terser(),
                ...plugins
            ],
            external
        },
        {
            input,
            output: [{ file: `${outputDir}/index.d.ts`, format: 'es' }],
            plugins: [dts()]
        }
    ];
}
