import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazorkitProvider } from '@lazorkit/wallet';
import App from './App';
import './index.css';

// Load configuration from environment variables
const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com',
  portalUrl: import.meta.env.VITE_PORTAL_URL || 'https://portal.lazorkit.com',
  paymasterConfig: {
    paymasterUrl: import.meta.env.VITE_PAYMASTER_URL || 'https://paymaster.lazorkit.com'
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LazorkitProvider {...config}>
      <App />
    </LazorkitProvider>
  </React.StrictMode>
);
