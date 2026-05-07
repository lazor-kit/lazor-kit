'use client';

import { Wallet, LogOut, Loader2 } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';

/**
 * WalletConnect component handles passkey authentication
 * 
 * Features:
 * - Connect button with passkey support
 * - Display connected wallet address
 * - Disconnect functionality
 * - Loading states
 */
export function WalletConnect() {
  const { address, isLoading, error, connectWithPasskey, disconnect } = useWallet();

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm text-red-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (address) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Wallet className="w-5 h-5 text-green-400" />
            <span className="text-sm font-mono">
              {formatAddress(address)}
            </span>
          </div>
          <button
            onClick={disconnect}
            className="text-gray-400 hover:text-white transition-colors"
            title="Disconnect"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={connectWithPasskey}
      disabled={isLoading}
      className="w-full bg-primary hover:bg-primary/90 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Wallet className="w-5 h-5" />
      )}
      <span>{isLoading ? 'Connecting...' : 'Connect with Passkey'}</span>
    </button>
  );
}