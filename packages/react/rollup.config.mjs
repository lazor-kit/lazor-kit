import { createRollupConfig } from '../../rollup.config.base.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

export default createRollupConfig({
    input: 'index.ts',
    external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@solana/web3.js',
        // A dependency's subpath is not matched by its name above: without
        // this, the v1 writer's signer would be bundled in, beside the copy
        // @solana/web3.js already brings.
        '@noble/curves/ed25519',
        'buffer',
        'crypto'
    ]
});
