// Expo WebBrowser Authentication Utility
// This file handles integration with Expo's WebBrowser.openAuthSessionAsync()

export interface ExpoAuthConfig {
  baseUrl: string;
  redirectUrl: string;
  expo?: string;
  action?: 'connect' | 'sign';
  message?: string;
}

export interface ExpoAuthResult {
  type: 'success' | 'cancel' | 'dismiss' | 'locked';
  url?: string;
  data?: ExpoWalletData;
}

export interface ExpoWalletData {
  credentialId?: string | null;
  publicKey?: string | null;
  signature?: string | null;  // ECDSA signature (normalized)
  msg?: string | null;        // Message digest that was signed
  expo?: string | null;
  timestamp?: string | null;
  environment?: string | null;
  platform?: string | null;
}

// Mock WebBrowser for development/testing when not in Expo environment
const mockWebBrowser = {
  openAuthSessionAsync: async (url: string, redirectUrl: string) => {
    console.log('Mock WebBrowser.openAuthSessionAsync called with:', { url, redirectUrl });
    // In a real Expo environment, this would be replaced by the actual WebBrowser
    return {
      type: 'success' as const,
      url: `${redirectUrl}?success=true&mock=true`
    };
  }
};

// Get WebBrowser from Expo or use mock
const getWebBrowser = () => {
  try {
    // Try to import Expo WebBrowser
    if (typeof window !== 'undefined' && (window as any).ExpoWebBrowser) {
      return (window as any).ExpoWebBrowser;
    }
    
    // Fallback to mock for development
    return mockWebBrowser;
  } catch (error) {
    console.warn('Expo WebBrowser not available, using mock:', error);
    return mockWebBrowser;
  }
};

/**
 * Opens an authentication session using Expo WebBrowser
 * @param config Configuration for the auth session
 * @returns Promise with authentication result
 */
export const openExpoAuthSession = async (config: ExpoAuthConfig): Promise<ExpoAuthResult> => {
  const { baseUrl, redirectUrl, expo, action = 'connect', message } = config;
  
  // Build the authentication URL
  const params = new URLSearchParams();
  params.append('action', action);
  
  if (expo) {
    params.append('expo', expo);
  }
  
  if (message) {
    params.append('message', message);
  }
  
  const authUrl = `${baseUrl}?${params.toString()}`;
  
  try {
    const WebBrowser = getWebBrowser();
    
    console.log('Opening auth session:', { authUrl, redirectUrl });
    
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    
    if (result.type === 'success' && result.url) {
      // Parse the result URL to extract data
      const resultUrl = new URL(result.url);
      const urlParams = new URLSearchParams(resultUrl.search);
      
      // Extract wallet data from URL parameters
      const walletData: ExpoWalletData = {
        credentialId: urlParams.get('credentialId'),
        publicKey: urlParams.get('publicKey'),
        signature: urlParams.get('signature'),
        msg: urlParams.get('msg'),
        expo: urlParams.get('expo'),
        timestamp: urlParams.get('timestamp'),
        environment: urlParams.get('environment'),
        platform: urlParams.get('platform')
      };
      
      return {
        type: 'success',
        url: result.url,
        data: walletData
      };
    }
    
    return {
      type: result.type as 'cancel' | 'dismiss' | 'locked',
      url: result.url
    };
    
  } catch (error) {
    console.error('Error opening auth session:', error);
    throw new Error(`Authentication session failed: ${error}`);
  }
};

/**
 * Connect wallet using Expo WebBrowser authentication
 * @param baseUrl Base URL of the wallet application
 * @param redirectUrl Redirect URL for the app
 * @param expo Optional expo parameter
 * @returns Promise with connection result
 */
export const connectWalletWithExpo = async (
  baseUrl: string, 
  redirectUrl: string, 
  expo?: string
): Promise<ExpoAuthResult> => {
  return openExpoAuthSession({
    baseUrl,
    redirectUrl,
    expo,
    action: 'connect'
  });
};

/**
 * Sign message using Expo WebBrowser authentication
 * @param baseUrl Base URL of the wallet application
 * @param redirectUrl Redirect URL for the app
 * @param message Message to sign
 * @param expo Optional expo parameter
 * @returns Promise with signing result
 */
export const signMessageWithExpo = async (
  baseUrl: string,
  redirectUrl: string, 
  message: string,
  expo?: string
): Promise<ExpoAuthResult> => {
  return openExpoAuthSession({
    baseUrl,
    redirectUrl,
    expo,
    action: 'sign',
    message
  });
};

// Type declarations for Expo WebBrowser
declare global {
  interface Window {
    ExpoWebBrowser?: {
      openAuthSessionAsync: (url: string, redirectUrl: string) => Promise<{
        type: 'success' | 'cancel' | 'dismiss' | 'locked';
        url?: string;
      }>;
    };
  }
} 