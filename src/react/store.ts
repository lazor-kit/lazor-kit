import { create } from 'zustand';
import { WalletAccount } from '../types';
import { Lazorkit } from '../core/Lazorkit';

interface LazorkitState {
  sdk: Lazorkit | null;
  account: WalletAccount | null;
  isConnecting: boolean;
  isSigning: boolean;
  error: Error | null;
  setSdk: (sdk: Lazorkit) => void;
  setAccount: (account: WalletAccount | null) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setIsSigning: (isSigning: boolean) => void;
  setError: (error: Error | null) => void;
}

export const useLazorkitStore = create<LazorkitState>((set) => ({
  sdk: null,
  account: null,
  isConnecting: false,
  isSigning: false,
  error: null,
  setSdk: (sdk) => set({ sdk }),
  setAccount: (account) => set({ account }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsSigning: (isSigning) => set({ isSigning }),
  setError: (error) => set({ error })
}));
