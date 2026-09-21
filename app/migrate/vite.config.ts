import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  // Force the npm package rather than vite's node-builtin shim, which in dev
  // leaves Buffer undefined and takes @solana/web3.js down with it.
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { include: ['buffer'] },
  server: { port: 3001, host: true },
});
