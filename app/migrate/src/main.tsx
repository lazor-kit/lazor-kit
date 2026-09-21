import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

// @solana/web3.js and the SDK expect a Buffer global in the browser.
globalThis.Buffer = globalThis.Buffer ?? Buffer;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
