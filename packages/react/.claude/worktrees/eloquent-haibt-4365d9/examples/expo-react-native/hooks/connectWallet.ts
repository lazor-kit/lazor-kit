// File: sdk/useLazorWallet.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

interface WalletInfo {
  credentialId: string;
  publicKey: string;
  platform: string;
  expo: string;
}

interface SignResult {
  signature: string;
  publicKeyHash: string;
}

interface useLazorWalletOptions {
  onConnectSuccess?: (wallet: WalletInfo) => void;
  onConnectError?: (error: Error) => void;
  onSignSuccess?: (result: SignResult) => void;
  onSignError?: (error: Error) => void;
}

const STORAGE_KEY = 'lazor_wallet_info';

export function useLazorWallet(options?: useLazorWalletOptions) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);

  useEffect(() => {
    const loadStoredWallet = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setWallet(parsed);
        }
      } catch {}
    };
    loadStoredWallet();
  }, []);

  const saveWallet = async (data: WalletInfo) => {
    try {
      setWallet(data);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  };

  const clearWallet = async () => {
    try {
      setWallet(null);
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const getRedirectUri = () => Linking.createURL('/auth');

  const handleRedirect = (url: string): WalletInfo | null => {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.get('success') !== 'true') return null;

      return {
        credentialId: parsed.searchParams.get('credentialId') || '',
        publicKey: parsed.searchParams.get('publicKey') || '',
        expo: parsed.searchParams.get('expo') || '',
        platform: parsed.searchParams.get('platform') || '',
      };
    } catch {
      return null;
    }
  };

  const connect = useCallback(async () => {
    const redirectUrl = getRedirectUri();
    const connectUrl = `https://portal.lazor.sh?action=connect&expo=my-web-app&redirect_url=${encodeURIComponent(redirectUrl)}`;

    try {
      if (Platform.OS === 'ios') {
        const result = await WebBrowser.openAuthSessionAsync(connectUrl, redirectUrl);
        if (result.type === 'success' && result.url) {
          const walletInfo = handleRedirect(result.url);
          if (walletInfo) {
            await saveWallet(walletInfo);
            options?.onConnectSuccess?.(walletInfo);
          } else {
            throw new Error('Invalid wallet info');
          }
        }
      } else {
        const sub = Linking.addEventListener('url', async ({ url }) => {
          WebBrowser.dismissBrowser();
          const walletInfo = handleRedirect(url);
          if (walletInfo) {
            await saveWallet(walletInfo);
            options?.onConnectSuccess?.(walletInfo);
          } else {
            options?.onConnectError?.(new Error('Connection failed'));
          }
          sub.remove();
        });
        await WebBrowser.openBrowserAsync(connectUrl);
      }
    } catch (err) {
      options?.onConnectError?.(err instanceof Error ? err : new Error('Unknown error'));
    }
  }, []);

  const disconnect = useCallback(() => {
    clearWallet();
  }, []);

  const signMessage = useCallback(async (message: string): Promise<SignResult | null> => {
    if (!wallet) return null;
    const redirectUrl = getRedirectUri();
    const signUrl = `https://portal.lazor.sh?action=sign&message=${encodeURIComponent(message)}&expo=my-web-app&redirect_url=${encodeURIComponent(redirectUrl)}`;

    return new Promise(async (resolve) => {
      const handleSignRedirect = (url: string) => {
        try {
          const parsed = new URL(url);
          if (parsed.searchParams.get('success') !== 'true') throw new Error('Sign failed');

          const result: SignResult = {
            signature: parsed.searchParams.get('signature') || '',
            publicKeyHash: parsed.searchParams.get('publicKeyHash') || '',
          };

          options?.onSignSuccess?.(result);
          resolve(result);
        } catch (err) {
          options?.onSignError?.(err instanceof Error ? err : new Error('Unknown error'));
          resolve(null);
        }
      };

      if (Platform.OS === 'ios') {
        const result = await WebBrowser.openAuthSessionAsync(signUrl, redirectUrl);
        if (result.type === 'success' && result.url) {
          handleSignRedirect(result.url);
        } else {
          options?.onSignError?.(new Error('User cancelled sign'));
          resolve(null);
        }
      } else {
        const sub = Linking.addEventListener('url', ({ url }) => {
          WebBrowser.dismissBrowser();
          handleSignRedirect(url);
          sub.remove();
        });
        await WebBrowser.openBrowserAsync(signUrl);
      }
    });
  }, [wallet]);

  return {
    wallet,
    isConnected: !!wallet,
    connect,
    disconnect,
    signMessage,
  };
}
