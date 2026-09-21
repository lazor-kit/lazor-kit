import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  // WebAuthn is refused when an ancestor frame is not HTTPS, and the portal
  // runs the passkey prompt inside an iframe — so the dev server needs TLS too.
  plugins: [react(), mkcert({ hosts: ['localhost'] })],
  define: { global: 'globalThis' },
  // Force the npm package rather than vite's node-builtin shim, which in dev
  // leaves Buffer undefined and takes @solana/web3.js down with it.
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { include: ['buffer'] },
  server: { port: 3001, host: true },
});
