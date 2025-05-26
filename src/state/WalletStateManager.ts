import * as React from 'react';
const { useState, useCallback } = React;
import { WalletState } from '../models/WalletState';
import { StorageService } from '../services/storage';

/**
 * Hook for managing wallet state
 */
export const useWalletState = () => {
  const [state, setState] = useState<WalletState>({
    credentialId: StorageService.getCredentialId(),
    publicKey: StorageService.getPublicKey(),
    isConnected: StorageService.isWalletConnected(),
    smartWalletAuthorityPubkey: null,
    isLoading: false,
    error: null,
  });

  /**
   * Update state with partial state
   */
  const updateState = useCallback((partialState: Partial<WalletState>) => {
    setState((prevState: WalletState) => ({
      ...prevState,
      ...partialState,
    }));
  }, []);

  return {
    state,
    updateState,
  };
};
