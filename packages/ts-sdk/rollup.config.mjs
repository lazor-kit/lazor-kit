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
        '@solana/web3.js'
    ]
});
