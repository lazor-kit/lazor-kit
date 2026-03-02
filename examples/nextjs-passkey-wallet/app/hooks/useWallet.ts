'use client';

import { useState, useEffect } from 'react';
import { useLazorkit } from '../providers/LazorkitProvider';
import { getUSDCBalance } from '../lib/lazorkit';

interface WalletState {
  address: string | null;
  usdcBalance: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Custom hook for managing wallet state and operations
 * 
 * Features:
 * - Passkey authentication
 * - Wallet address management
 * - USDC balance tracking
 * - Session persistence
 */
export function useWallet() {
  const { lazorkit } = useLazorkit();
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    usdcBalance: 0,
    isLoading: false,
    error: null,
  });

  // Check for existing session on mount
  useEffect(() => {
    checkExistingSession();
  }, []);

  // Update balance when address changes
  useEffect(() => {
    if (wallet.address) {
      updateBalance();
    }
  }, [wallet.address]);

  const checkExistingSession = async () => {
    try {
      const session = await lazorkit.auth.getSession();
      if (session?.walletAddress) {
        setWallet(prev => ({
          ...prev,
          address: session.walletAddress,
          isLoading: false,
        }));
      }
    } catch (error) {
      console.error('Error checking session:', error);
    }
  };

  const connectWithPasskey = async () => {
    setWallet(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const result = await lazorkit.auth.connectWithPasskey({
        username: `user-${Date.now()}`, // In production, use actual username
      });
      
      setWallet(prev => ({
        ...prev,
        address: result.walletAddress,
        isLoading: false,
      }));
    } catch (error) {
      setWallet(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      }));
    }
  };

  const updateBalance = async () => {
    if (!wallet.address) return;
    
    const balance = await getUSDCBalance(wallet.address);
    setWallet(prev => ({ ...prev, usdcBalance: balance }));
  };

  const disconnect = async () => {
    await lazorkit.auth.disconnect();
    setWallet({
      address: null,
      usdcBalance: 0,
      isLoading: false,
      error: null,
    });
  };

  return {
    ...wallet,
    connectWithPasskey,
    disconnect,
    updateBalance,
  };
}