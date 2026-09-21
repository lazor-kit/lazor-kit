import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WebAuthn is refused when a frame in the chain was served without a valid
// certificate, and the passkey prompt runs inside the portal's iframe — so the
// dev server needs TLS. Issue a local certificate once:
//
//   mkcert -install                                   # one time, asks for your password
//   mkcert -key-file .certs/key.pem -cert-file .certs/cert.pem localhost 127.0.0.1
//
// Without those files the server falls back to http, which is fine for
// everything except the passkey.
const https =
  existsSync(`${__dirname}/.certs/key.pem`) && existsSync(`${__dirname}/.certs/cert.pem`)
    ? {
        key: readFileSync(`${__dirname}/.certs/key.pem`),
        cert: readFileSync(`${__dirname}/.certs/cert.pem`),
      }
    : undefined;

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  // Force the npm package rather than vite's node-builtin shim, which in dev
  // leaves Buffer undefined and takes @solana/web3.js down with it.
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { include: ['buffer'] },
  server: { port: 3001, host: true, https },
});
