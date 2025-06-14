/// <reference types="vite/client" />
declare global {
    interface Window {
      Buffer: typeof import('buffer').Buffer;
    }
  }