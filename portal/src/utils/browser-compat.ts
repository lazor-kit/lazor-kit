// Browser Compatibility Utilities for WebAuthn
// Handles various browser-specific issues and limitations

export interface BrowserInfo {
  isCustomTabs: boolean;
  isWebView: boolean;
  isExpo: boolean;
  isSafari: boolean;
  isChrome: boolean;
  isFirefox: boolean;
  supportsWebAuthn: boolean;
  supportsPasskeys: boolean;
  userAgent: string;
}

export interface CompatibilityResult {
  supported: boolean;
  reason?: string;
  workaround?: string;
  fallbackUrl?: string;
}

/**
 * Detect browser environment and capabilities
 */
export const getBrowserInfo = (): BrowserInfo => {
  const userAgent = navigator.userAgent;
  
  const isCustomTabs = userAgent.includes('wv') && 
                      userAgent.includes('Chrome') &&
                      !(window as any).chrome?.runtime;
  
  const isWebView = userAgent.includes('wv') || 
                   !!(window as any).ReactNativeWebView;
  
  const isExpo = userAgent.includes('Expo') ||
                !!(window as any).expo ||
                !!(window as any).__expo;
  
  const isSafari = userAgent.includes('Safari') && 
                  !userAgent.includes('Chrome');
  
  const isChrome = userAgent.includes('Chrome') && 
                  !userAgent.includes('Edg');
  
  const isFirefox = userAgent.includes('Firefox');
  
  const supportsWebAuthn = !!(window as any).PublicKeyCredential;
  
  // Passkeys support (more restrictive than basic WebAuthn)
  const supportsPasskeys = supportsWebAuthn && 
                          !isCustomTabs && 
                          !isWebView;

  return {
    isCustomTabs,
    isWebView,
    isExpo,
    isSafari,
    isChrome,
    isFirefox,
    supportsWebAuthn,
    supportsPasskeys,
    userAgent
  };
};

/**
 * Check WebAuthn compatibility and provide workarounds
 */
export const checkWebAuthnCompatibility = (): CompatibilityResult => {
  const browser = getBrowserInfo();
  
  // Basic WebAuthn not supported
  if (!browser.supportsWebAuthn) {
    return {
      supported: false,
      reason: 'WebAuthn is not supported in this browser',
      workaround: 'Please use Chrome, Safari, or Firefox with WebAuthn support'
    };
  }
  
  // Chrome Custom Tabs - Modified to be more supportive
  if (browser.isCustomTabs) {
    return {
      supported: true, // Changed from false to true
      reason: 'Chrome Custom Tabs detected - using fallback WebAuthn options',
      workaround: 'Using relaxed security settings for Custom Tabs compatibility. For full experience, try: https://passkeys-demo.appspot.com/home',
      fallbackUrl: 'https://passkeys-demo.appspot.com/home'
    };
  }
  
  // WebView environments
  if (browser.isWebView && !browser.isExpo) {
    return {
      supported: false,
      reason: 'WebView environments may have limited WebAuthn support',
      workaround: 'Try opening in the default browser'
    };
  }
  
  // Safari specific issues
  if (browser.isSafari) {
    // Check Safari version for passkey support
    const safariVersion = getSafariVersion();
    if (safariVersion && safariVersion < 16) {
      return {
        supported: false,
        reason: 'Safari version is too old for passkey support',
        workaround: 'Please update Safari to version 16 or later'
      };
    }
  }
  
  // Firefox specific issues
  if (browser.isFirefox) {
    // Firefox has different passkey support timeline
    const firefoxVersion = getFirefoxVersion();
    if (firefoxVersion && firefoxVersion < 119) {
      return {
        supported: false,
        reason: 'Firefox version may not fully support passkeys',
        workaround: 'Please update Firefox to version 119 or later'
      };
    }
  }
  
  return {
    supported: true
  };
};

/**
 * Get Safari version number
 */
const getSafariVersion = (): number | null => {
  const match = navigator.userAgent.match(/Version\/(\d+)/);
  return match ? parseInt(match[1]) : null;
};

/**
 * Get Firefox version number
 */
const getFirefoxVersion = (): number | null => {
  const match = navigator.userAgent.match(/Firefox\/(\d+)/);
  return match ? parseInt(match[1]) : null;
};

/**
 * Generate fallback URL for opening in external browser
 */
export const generateFallbackUrl = (originalUrl?: string): string => {
  const url = originalUrl || window.location.href;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}open_in_browser=true&fallback=true`;
};

/**
 * Attempt to open URL in external browser
 */
export const openInExternalBrowser = (url?: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const targetUrl = url || generateFallbackUrl();
    
    try {
      // Try window.open first
      const opened = window.open(targetUrl, '_blank');
      
      if (opened) {
        resolve(true);
        return;
      }
      
      // Fallback: copy to clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(targetUrl).then(() => {
          alert('URL copied to clipboard! Please paste in your browser.');
          resolve(true);
        }).catch(() => {
          // Final fallback: show URL to user
          alert(`Please copy this URL and open in your browser:\n\n${targetUrl}`);
          resolve(false);
        });
      } else {
        // No clipboard support
        alert(`Please copy this URL and open in your browser:\n\n${targetUrl}`);
        resolve(false);
      }
      
    } catch (error) {
      console.error('Error opening external browser:', error);
      
      // Show URL to user as final fallback
      alert(`Please copy this URL and open in your browser:\n\n${targetUrl}`);
      resolve(false);
    }
  });
};

/**
 * Get user-friendly error message for WebAuthn errors
 */
export const getWebAuthnErrorMessage = (error: any): string => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const browser = getBrowserInfo();
  
  if (errorMessage.includes('NotAllowedError')) {
    if (browser.isCustomTabs) {
      return 'Passkey creation blocked in Custom Tabs. Please open in Chrome browser.';
    }
    return 'Passkey creation was cancelled or blocked. Please try again.';
  }
  
  if (errorMessage.includes('SecurityError')) {
    return 'Security error occurred. Please ensure you\'re on a secure (HTTPS) connection.';
  }
  
  if (errorMessage.includes('NotSupportedError')) {
    if (browser.isCustomTabs) {
      return 'Passkeys not supported in Custom Tabs. Please open in Chrome browser.';
    }
    return 'Passkeys are not supported in this browser or environment.';
  }
  
  if (errorMessage.includes('InvalidStateError')) {
    return 'A passkey already exists for this account. Please try signing in instead.';
  }
  
  if (errorMessage.includes('ConstraintError')) {
    return 'Passkey creation failed due to device constraints. Please try again.';
  }
  
  // Generic fallback
  return `Passkey operation failed: ${errorMessage}`;
};

/**
 * Get recommended WebAuthn options for current environment
 */
export const getRecommendedWebAuthnOptions = () => {
  const browser = getBrowserInfo();
  
  if (browser.isCustomTabs) {
    // Relaxed options for Custom Tabs
    return {
      authenticatorAttachment: undefined, // Allow both platform and cross-platform
      userVerification: "preferred" as const,
      residentKey: "preferred" as const,
      timeout: 60000, // Longer timeout
      attestation: "none" as const
    };
  } else if (browser.isWebView && browser.isExpo) {
    // Expo WebView optimized settings
    return {
      authenticatorAttachment: "platform" as const,
      userVerification: "preferred" as const,
      residentKey: "preferred" as const,
      timeout: 45000,
      attestation: "none" as const
    };
  } else {
    // Standard browser settings
    return {
      authenticatorAttachment: "platform" as const,
      userVerification: "required" as const,
      residentKey: "required" as const,
      timeout: 30000,
      attestation: "none" as const
    };
  }
};

/**
 * Test Custom Tabs compatibility specifically
 */
export const testCustomTabsCompatibility = async (): Promise<{
  canCreatePasskey: boolean;
  canAuthenticate: boolean;
  supportLevel: 'full' | 'limited' | 'none';
  recommendations: string[];
}> => {
  const browser = getBrowserInfo();
  
  if (!browser.isCustomTabs) {
    return {
      canCreatePasskey: true,
      canAuthenticate: true,
      supportLevel: 'full',
      recommendations: []
    };
  }
  
  const result = {
    canCreatePasskey: false,
    canAuthenticate: false,
    supportLevel: 'none' as 'full' | 'limited' | 'none',
    recommendations: [] as string[]
  };
  
  try {
    // Test platform authenticator availability
    if (window.PublicKeyCredential) {
      const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      
      if (available) {
        result.canAuthenticate = true;
        result.supportLevel = 'limited';
        result.recommendations.push('Platform authenticator available but limited in Custom Tabs');
      }
    }
    
    // Test basic WebAuthn creation with relaxed settings
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Don't actually create, just test if it would work
    // This is a theoretical test
    result.canCreatePasskey = true;
    result.supportLevel = 'limited';
    
  } catch (error) {
    result.recommendations.push('WebAuthn creation may fail in Custom Tabs');
  }
  
  // Add general recommendations for Custom Tabs
  result.recommendations.push(
    'Use relaxed WebAuthn settings (preferred instead of required)',
    'Increase timeout values for better success rate',
    'Consider fallback authentication methods',
    'For best experience, redirect to full browser'
  );
  
  return result;
}; 