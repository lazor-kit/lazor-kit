declare global {
  interface Window {
    Buffer: typeof Buffer;
    process: typeof process;
  }
}

export {}; 