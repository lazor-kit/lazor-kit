// Platform Detection and Optimization Utilities
// Supports Desktop, iOS, and Chrome/Android platforms

export interface PlatformInfo {
  type: 'desktop' | 'ios' | 'android' | 'unknown';
  browser: 'chrome' | 'safari' | 'firefox' | 'edge' | 'custom-tabs' | 'webview' | 'unknown';
  supportsPasskeys: boolean;
  requiresOptimization: boolean;
  optimizations: string[];
  webauthnOptions: WebAuthnPlatformOptions;
}

export interface WebAuthnPlatformOptions {
  authenticatorAttachment?: "platform" | "cross-platform" | undefined;
  userVerification: "required" | "preferred" | "discouraged";
  residentKey: "required" | "preferred" | "discouraged";
  timeout: number;
  attestation: "none" | "indirect" | "direct" | "enterprise";
}

/**
 * Comprehensive platform detection
 */
export const detectPlatform = (): PlatformInfo => {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  
  // iOS Detection
  if (/iPad|iPhone|iPod/.test(userAgent) || 
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isWebView = /(WebView|wkwebview)/i.test(userAgent);
    
    return {
      type: 'ios',
      browser: isWebView ? 'webview' : (isSafari ? 'safari' : 'unknown'),
      supportsPasskeys: checkiOSPasskeySupport(),
      requiresOptimization: isWebView || !isSafari,
      optimizations: getIOSOptimizations(isWebView, isSafari),
      webauthnOptions: getIOSWebAuthnOptions(isWebView)
    };
  }
  
  // Android Detection
  if (/Android/.test(userAgent)) {
    const isCustomTabs = userAgent.includes('wv') && 
                        userAgent.includes('Chrome') &&
                        !(window as any).chrome?.runtime;
    
    const isWebView = /wv/.test(userAgent) || !!(window as any).ReactNativeWebView;
    const isChrome = /Chrome/.test(userAgent);
    
    return {
      type: 'android',
      browser: isCustomTabs ? 'custom-tabs' : (isWebView ? 'webview' : (isChrome ? 'chrome' : 'unknown')),
      supportsPasskeys: checkAndroidPasskeySupport(isCustomTabs, isWebView),
      requiresOptimization: isCustomTabs || isWebView,
      optimizations: getAndroidOptimizations(isCustomTabs, isWebView, isChrome),
      webauthnOptions: getAndroidWebAuthnOptions(isCustomTabs, isWebView)
    };
  }
  
  // Desktop Detection
  const isDesktop = /Windows|Mac|Linux/.test(platform) || 
                   (!(/Mobile|Tablet/.test(userAgent)));
  
  if (isDesktop) {
    const isChrome = /Chrome/.test(userAgent) && !/Edg/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    const isEdge = /Edg/.test(userAgent);
    
    let browser: PlatformInfo['browser'] = 'unknown';
    if (isChrome) browser = 'chrome';
    else if (isSafari) browser = 'safari';
    else if (isFirefox) browser = 'firefox';
    else if (isEdge) browser = 'edge';
    
    return {
      type: 'desktop',
      browser,
      supportsPasskeys: checkDesktopPasskeySupport(browser),
      requiresOptimization: browser === 'firefox' || browser === 'edge',
      optimizations: getDesktopOptimizations(browser),
      webauthnOptions: getDesktopWebAuthnOptions(browser)
    };
  }
  
  // Unknown platform
  return {
    type: 'unknown',
    browser: 'unknown',
    supportsPasskeys: false,
    requiresOptimization: true,
    optimizations: ['Use Chrome, Safari, or Firefox for best support'],
    webauthnOptions: getDefaultWebAuthnOptions()
  };
};

/**
 * iOS Passkey Support Check
 */
function checkiOSPasskeySupport(): boolean {
  // iOS 16+ with Safari supports passkeys
  const iOSVersion = getIOSVersion();
  return iOSVersion >= 16 && window.PublicKeyCredential !== undefined;
}

/**
 * Android Passkey Support Check
 */
function checkAndroidPasskeySupport(isCustomTabs: boolean, isWebView: boolean): boolean {
  if (!window.PublicKeyCredential) return false;
  
  // Custom Tabs has limited support
  if (isCustomTabs) return true; // Can work with relaxed settings
  
  // Regular Chrome/WebView should work
  return !isWebView || (window as any).ReactNativeWebView; // Expo WebView OK
}

/**
 * Desktop Passkey Support Check
 */
function checkDesktopPasskeySupport(browser: string): boolean {
  if (!window.PublicKeyCredential) return false;
  
  switch (browser) {
    case 'chrome':
    case 'edge':
      return true; // Chrome 67+, Edge 79+
    case 'safari':
      return true; // Safari 16+
    case 'firefox':
      return true; // Firefox 119+
    default:
      return false;
  }
}

/**
 * Get iOS Version
 */
function getIOSVersion(): number {
  const match = navigator.userAgent.match(/OS (\d+)_/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * iOS Optimizations
 */
function getIOSOptimizations(isWebView: boolean, isSafari: boolean): string[] {
  const optimizations = [];
  
  if (isWebView) {
    optimizations.push('WebView environment detected - use WKWebView for best support');
    optimizations.push('Enable "Face ID & Passcode" in device settings');
    optimizations.push('Consider opening in Safari for full passkey support');
  }
  
  if (!isSafari && !isWebView) {
    optimizations.push('For best passkey experience, use Safari browser');
  }
  
  optimizations.push('Ensure iOS 16+ for full passkey support');
  optimizations.push('Enable biometric authentication in Settings');
  
  return optimizations;
}

/**
 * Android Optimizations
 */
function getAndroidOptimizations(isCustomTabs: boolean, isWebView: boolean, isChrome: boolean): string[] {
  const optimizations = [];
  
  if (isCustomTabs) {
    optimizations.push('Custom Tabs detected - using relaxed WebAuthn settings');
    optimizations.push('For full passkey support, open in Chrome browser');
    optimizations.push('Enable screen lock and fingerprint/face unlock');
  }
  
  if (isWebView && !(window as any).ReactNativeWebView) {
    optimizations.push('WebView environment - consider using Chrome Custom Tabs');
    optimizations.push('Enable WebView updates in Play Store');
  }
  
  if (!isChrome && !isCustomTabs) {
    optimizations.push('For best passkey experience, use Chrome browser');
  }
  
  optimizations.push('Enable "Screen lock" in Security settings');
  optimizations.push('Set up fingerprint or face unlock');
  optimizations.push('Update Chrome to latest version');
  
  return optimizations;
}

/**
 * Desktop Optimizations
 */
function getDesktopOptimizations(browser: string): string[] {
  const optimizations = [];
  
  switch (browser) {
    case 'chrome':
    case 'edge':
      optimizations.push('Enable "Make payments faster" in browser settings');
      optimizations.push('Set up Windows Hello or Touch ID');
      break;
    case 'safari':
      optimizations.push('Enable Touch ID for Safari in System Preferences');
      optimizations.push('Update to macOS Monterey or later');
      break;
    case 'firefox':
      optimizations.push('Enable "dom.webauthn.webauthn_enable_softtoken" in about:config');
      optimizations.push('Update to Firefox 119+ for best support');
      break;
    default:
      optimizations.push('Use Chrome, Safari, or Firefox for passkey support');
  }
  
  optimizations.push('Enable system-level biometric authentication');
  optimizations.push('Ensure secure boot and TPM 2.0 (Windows)');
  
  return optimizations;
}

/**
 * iOS WebAuthn Options
 */
function getIOSWebAuthnOptions(isWebView: boolean): WebAuthnPlatformOptions {
  if (isWebView) {
    return {
      authenticatorAttachment: "platform",
      userVerification: "preferred", // Relaxed for WebView
      residentKey: "preferred",
      timeout: 45000,
      attestation: "none"
    };
  }
  
  return {
    authenticatorAttachment: "platform",
    userVerification: "required",
    residentKey: "required",
    timeout: 30000,
    attestation: "none"
  };
}

/**
 * Android WebAuthn Options
 */
function getAndroidWebAuthnOptions(isCustomTabs: boolean, isWebView: boolean): WebAuthnPlatformOptions {
  if (isCustomTabs) {
    return {
      authenticatorAttachment: undefined, // Allow both
      userVerification: "preferred",
      residentKey: "preferred",
      timeout: 60000, // Longer for Custom Tabs
      attestation: "none"
    };
  }
  
  if (isWebView) {
    return {
      authenticatorAttachment: "platform",
      userVerification: "preferred",
      residentKey: "preferred",
      timeout: 45000,
      attestation: "none"
    };
  }
  
  return {
    authenticatorAttachment: "platform",
    userVerification: "required",
    residentKey: "required",
    timeout: 30000,
    attestation: "none"
  };
}

/**
 * Desktop WebAuthn Options
 */
function getDesktopWebAuthnOptions(browser: string): WebAuthnPlatformOptions {
  if (browser === 'firefox') {
    return {
      authenticatorAttachment: "platform",
      userVerification: "preferred", // Firefox can be finicky
      residentKey: "preferred",
      timeout: 45000,
      attestation: "none"
    };
  }
  
  return {
    authenticatorAttachment: "platform",
    userVerification: "required",
    residentKey: "required",
    timeout: 30000,
    attestation: "none"
  };
}

/**
 * Default WebAuthn Options
 */
function getDefaultWebAuthnOptions(): WebAuthnPlatformOptions {
  return {
    authenticatorAttachment: "platform",
    userVerification: "preferred",
    residentKey: "preferred",
    timeout: 45000,
    attestation: "none"
  };
}

/**
 * Apply platform-specific optimizations
 */
export const applyPlatformOptimizations = (platformInfo: PlatformInfo) => {
  // Set global WebAuthn options based on platform
  (window as any).__webauthn_options = platformInfo.webauthnOptions;
  
  console.log(`🔧 Applied ${platformInfo.type} optimizations:`, {
    browser: platformInfo.browser,
    options: platformInfo.webauthnOptions,
    optimizations: platformInfo.optimizations
  });
  
  return platformInfo;
}; 