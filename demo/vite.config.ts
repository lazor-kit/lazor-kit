import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import Mkcert from 'vite-plugin-mkcert'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  resolve: {
    // 🔥 ĐÃ XÓA preserveSymlinks: true để Vite có thể đọc hiểu pnpm workspace
    conditions: ['module', 'browser', 'development', 'import', 'default'],
    dedupe: [
      'react',
      'react-dom',
      'buffer',
      'bn.js',
      '@noble/hashes',
      '@noble/curves',
    ],
  },

  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    Mkcert({ hosts: ['localhost'] }),
    nodePolyfills({
      // Đảm bảo polyfill bao phủ tất cả
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],

  optimizeDeps: {
    include: [
      'buffer',
      'bn.js',
      'base-x',
      'bs58',
      '@solana/web3.js',
      // 🔥 RẤT QUAN TRỌNG: Ép Vite phải pre-bundle thư viện này
      // dù nó nằm sâu trong workspace đang bị exclude
      'js-sha256'
    ],
    exclude: [
      '@lazorkit/wallet', // Cho phép HMR khi code thay đổi
    ],
  },

  build: {
    target: 'esnext',
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },

  server: {
    fs: {
      allow: ['..'], // Cho phép đọc file từ workspace
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})