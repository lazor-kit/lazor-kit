import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import Mkcert  from 'vite-plugin-mkcert'
export default defineConfig({
  plugins: [react(), 
     Mkcert({
      hosts: ['localhost'],
    }),
  ],

  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer']
  },
  server: {
    port: 3000,
    host: true,
    headers: {
      // For development, use these less restrictive options
      'Cross-Origin-Opener-Policy': 'unsafe-none', // instead of 'same-origin'
      'Cross-Origin-Embedder-Policy': 'unsafe-none' // instead of 'require-corp'
    }
  }
});