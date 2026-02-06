'use client';

import React from 'react';
import { LazorkitProvider as LKProvider } from '@lazorkit/wallet';

export function LazorkitProvider({ children }: { children: React.ReactNode }) {
  return (
    <LKProvider
      rpcUrl={process.env.NEXT_PUBLIC_LAZORKIT_RPC_URL || 'https://api.devnet.solana.com'}
      portalUrl={process.env.NEXT_PUBLIC_LAZORKIT_PORTAL_URL || 'https://portal.lazorkit.com'}
      paymasterConfig={{
        paymasterUrl: process.env.NEXT_PUBLIC_LAZORKIT_PAYMASTER_URL || 'https://paymaster.lazorkit.com',
      }}
    >
      {children}
    </LKProvider>
  );
}
