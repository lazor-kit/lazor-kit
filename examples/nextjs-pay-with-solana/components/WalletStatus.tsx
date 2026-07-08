'use client';

import { useWallet } from '@lazorkit/wallet';
import { Wallet, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

export function WalletStatus() {
  const { connect, disconnect, isConnected, smartWalletPubkey } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      await connect();
    } catch (error) {
      console.error('Connection failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await disconnect();
    } catch (error) {
      console.error('Disconnect failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl">
        {isConnected ? (
          <>
            <CheckCircle className="w-6 h-6 text-green-400" />
            <div>
              <p className="text-white font-medium">Connected</p>
              <p className="text-white/60 text-sm">Your wallet is active</p>
            </div>
          </>
        ) : (
          <>
            <XCircle className="w-6 h-6 text-red-400" />
            <div>
              <p className="text-white font-medium">Not Connected</p>
              <p className="text-white/60 text-sm">Connect to start using</p>
            </div>
          </>
        )}
      </div>

      {/* Wallet Address */}
      {isConnected && smartWalletPubkey && (
        <div className="p-4 bg-white/5 rounded-xl">
          <p className="text-white/60 text-sm mb-2">Smart Wallet Address</p>
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-solana-purple" />
            <code className="text-white font-mono text-sm break-all">
              {smartWalletPubkey.toString()}
            </code>
          </div>
        </div>
      )}

      {/* Connect/Disconnect Button */}
      <button
        onClick={isConnected ? handleDisconnect : handleConnect}
        disabled={isLoading}
        className={`w-full py-3 px-6 rounded-xl font-semibold transition-all ${
          isConnected
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50'
            : 'bg-white text-solana-purple hover:bg-white/90'
        } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {isConnected ? 'Disconnecting...' : 'Connecting...'}
          </>
        ) : (
          <>{isConnected ? 'Disconnect Wallet' : 'Connect with Passkey'}</>
        )}
      </button>

      {/* Info Box */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
        <p className="text-blue-300 text-sm">
          <strong>💡 Tip:</strong> This demo uses Devnet. No real SOL is required.
          The wallet is secured by your device&apos;s biometrics (FaceID/TouchID/Windows Hello).
        </p>
      </div>
    </div>
  );
}
