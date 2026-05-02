import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import Mkcert  from 'vite-plugin-mkcert'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), 
     Mkcert({
      hosts: ['localhost'],
    }),
    tailwindcss(),
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
  }
});