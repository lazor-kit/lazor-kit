// WebAuthn Debug Utilities
// Helps diagnose credential manager and biometric authentication issues

declare global {
  interface Window {
    PublicKeyCredential?: any;
  }
}

type AttestationConveyancePreference = "none" | "indirect" | "direct" | "enterprise";

export interface WebAuthnDiagnostics {
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable: boolean | null;
  conditionalMediationSupported: boolean | null;
  userVerificationSupported: boolean | null;
  biometricSupported: boolean | null;
  environment: string;
  userAgent: string;
  isSecureContext: boolean;
  hasUserActivation: boolean;
  permissions: any;
  errors: string[];
  recommendations: string[];
}

/**
 * Run comprehensive WebAuthn diagnostics
 */
export const runWebAuthnDiagnostics = async (): Promise<WebAuthnDiagnostics> => {
  const diagnostics: WebAuthnDiagnostics = {
    webAuthnSupported: false,
    platformAuthenticatorAvailable: null,
    conditionalMediationSupported: null,
    userVerificationSupported: null,
    biometricSupported: null,
    environment: 'unknown',
    userAgent: navigator.userAgent,
    isSecureContext: window.isSecureContext,
    hasUserActivation: (navigator as any).userActivation?.isActive || false,
    permissions: null,
    errors: [],
    recommendations: []
  };

  // 1. Basic WebAuthn support
  if (window.PublicKeyCredential) {
    diagnostics.webAuthnSupported = true;
  } else {
    diagnostics.errors.push('WebAuthn not supported');
    diagnostics.recommendations.push('Use Chrome, Safari, or Firefox');
  }

  // 2. Environment detection
  if (navigator.userAgent.includes('wv') && navigator.userAgent.includes('Chrome')) {
    diagnostics.environment = 'custom-tabs';
    diagnostics.errors.push('Chrome Custom Tabs detected');
    diagnostics.recommendations.push('Open in Chrome browser instead');
  } else if ((window as any).ReactNativeWebView) {
    diagnostics.environment = 'react-native-webview';
  } else if (navigator.userAgent.includes('Expo')) {
    diagnostics.environment = 'expo';
  } else {
    diagnostics.environment = 'browser';
  }

  // 3. Secure context check
  if (!diagnostics.isSecureContext) {
    diagnostics.errors.push('Not a secure context (HTTPS required)');
    diagnostics.recommendations.push('Use HTTPS');
  }

  // 4. Platform authenticator availability
  try {
    if (window.PublicKeyCredential) {
      diagnostics.platformAuthenticatorAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      
      if (!diagnostics.platformAuthenticatorAvailable) {
        diagnostics.errors.push('Platform authenticator not available');
        diagnostics.recommendations.push('Enable biometric authentication in device settings');
      }
    }
  } catch (error) {
    diagnostics.errors.push(`Platform authenticator check failed: ${error}`);
  }

  // 5. Conditional mediation support (for autofill)
  try {
    if (window.PublicKeyCredential && (window.PublicKeyCredential as any).isConditionalMediationAvailable) {
      diagnostics.conditionalMediationSupported = await (window.PublicKeyCredential as any).isConditionalMediationAvailable();
    }
  } catch (error) {
    // Not critical for basic functionality
  }

  // 6. Test user verification
  try {
    if (window.PublicKeyCredential) {
      // Try a simple get() call to test user verification
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      
      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [],
          userVerification: 'required',
          timeout: 1000 // Short timeout for test
        }
      });
    }
  } catch (error: any) {
    if (error.name === 'NotReadableError') {
      diagnostics.errors.push('NotReadableError: Credential manager communication failed');
      diagnostics.recommendations.push('Check biometric authentication settings');
      diagnostics.recommendations.push('Restart browser or device');
      diagnostics.recommendations.push('Try a different browser');
    } else if (error.name === 'InvalidStateError' || error.name === 'NotAllowedError') {
      // These are expected for the test
      diagnostics.userVerificationSupported = true;
    }
  }

  // 7. Check permissions
  try {
    if ('permissions' in navigator) {
      const permission = await navigator.permissions.query({ name: 'publickey-credentials-get' as any });
      diagnostics.permissions = permission.state;
      
      if (permission.state === 'denied') {
        diagnostics.errors.push('WebAuthn permission denied');
        diagnostics.recommendations.push('Reset site permissions and try again');
      }
    }
  } catch (error) {
    // Permission API might not be supported
  }

  // 8. Generate final recommendations
  if (diagnostics.errors.length === 0) {
    diagnostics.recommendations.push('WebAuthn should work on this device');
  } else if (diagnostics.environment === 'custom-tabs') {
    diagnostics.recommendations.unshift('Use regular Chrome browser instead of Custom Tabs');
  }

  return diagnostics;
};

/**
 * Test basic passkey creation to diagnose issues
 */
export const testPasskeyCreation = async (): Promise<{ success: boolean; error?: any; details?: any }> => {
  try {
    // Run diagnostics first
    const diagnostics = await runWebAuthnDiagnostics();
    
    if (!diagnostics.webAuthnSupported) {
      return {
        success: false,
        error: 'WebAuthn not supported',
        details: diagnostics
      };
    }

    if (!diagnostics.platformAuthenticatorAvailable) {
      return {
        success: false,
        error: 'Platform authenticator not available',
        details: diagnostics
      };
    }

    // Test actual creation
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const options: CredentialCreationOptions = {
      publicKey: {
        rp: { 
          name: "WebAuthn Test",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: "test@example.com",
          displayName: "Test User"
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },  // ES256
          { alg: -257, type: "public-key" } // RS256
        ],
        challenge,
        timeout: 30000,
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "required"
        },
        attestation: "none" as AttestationConveyancePreference
      }
    };

    const credential = await navigator.credentials.create(options);
    
    return {
      success: true,
      details: {
        credentialId: (credential as any).id,
        diagnostics
      }
    };

  } catch (error) {
    return {
      success: false,
      error,
      details: await runWebAuthnDiagnostics()
    };
  }
};

/**
 * Get user-friendly error explanation for NotReadableError
 */
export const explainNotReadableError = (): string => {
  return `
NotReadableError: Cannot communicate with credential manager

This error typically occurs when:

🔧 Hardware Issues:
• Biometric sensors are disabled or malfunctioning
• Hardware security module (TPM/Secure Enclave) issues
• Device doesn't support platform authenticators

🔧 Software Issues:
• Biometric authentication is disabled in system settings
• Browser security policies blocking access
• Chrome Custom Tabs restrictions

🔧 Environment Issues:
• Running in restricted context (Custom Tabs, some WebViews)
• Security software interference
• Outdated browser or OS

Solutions to try:

1️⃣ Check Device Settings:
   • Enable biometric authentication (Face ID, Touch ID, Fingerprint)
   • Enable "Screen lock" security
   • Check "Apps & notifications" → "Special app access" → "Device admin apps"

2️⃣ Browser Solutions:
   • Open in Chrome browser (not Custom Tabs)
   • Clear browser data and try again
   • Try incognito/private mode
   • Update browser to latest version

3️⃣ Device Solutions:
   • Restart your device
   • Check for OS updates
   • Try a different device if available
   • Disable security software temporarily

4️⃣ Alternative Approaches:
   • Use password-based authentication
   • Try on desktop browser
   • Contact support for assistance
  `;
};

/**
 * Console debugging helper
 */
export const debugWebAuthn = async () => {
  console.log('🔍 WebAuthn Diagnostics Starting...');
  
  const diagnostics = await runWebAuthnDiagnostics();
  
  console.log('📱 Environment:', diagnostics.environment);
  console.log('🔐 WebAuthn supported:', diagnostics.webAuthnSupported);
  console.log('🔓 Platform authenticator:', diagnostics.platformAuthenticatorAvailable);
  console.log('🔒 Secure context:', diagnostics.isSecureContext);
  console.log('👆 User activation:', diagnostics.hasUserActivation);
  console.log('⚠️ Errors:', diagnostics.errors);
  console.log('💡 Recommendations:', diagnostics.recommendations);
  
  if (diagnostics.errors.includes('NotReadableError: Credential manager communication failed')) {
    console.log('❌ NotReadableError detected!');
    console.log(explainNotReadableError());
  }
  
  console.log('🧪 Testing passkey creation...');
  const testResult = await testPasskeyCreation();
  
  if (testResult.success) {
    console.log('✅ Passkey creation test passed!');
  } else {
    console.log('❌ Passkey creation test failed:', testResult.error);
    
    if (testResult.error?.name === 'NotReadableError') {
      console.log('🚨 NotReadableError confirmed - see explanation above');
    }
  }
  
  return {
    diagnostics,
    testResult
  };
};

/**
 * Custom Tabs specific debugging
 */
export const debugCustomTabs = async () => {
  console.log('🟡 Custom Tabs Debug Starting...');
  
  const isCustomTabsEnv = navigator.userAgent.includes('wv') && 
                          navigator.userAgent.includes('Chrome') &&
                          !(window as any).chrome?.runtime;
  
  console.log('📱 Environment Check:');
  console.log('  - Is Custom Tabs:', isCustomTabsEnv);
  console.log('  - User Agent:', navigator.userAgent);
  console.log('  - Chrome runtime:', !!(window as any).chrome?.runtime);
  console.log('  - WebView marker (wv):', navigator.userAgent.includes('wv'));
  
  if (!isCustomTabsEnv) {
    console.log('✅ Not in Custom Tabs - standard WebAuthn should work');
    return {
      isCustomTabs: false,
      recommendedAction: 'standard_webauthn'
    };
  }
  
  console.log('🔧 Custom Tabs Detected - Testing Capabilities...');
  
  // Test WebAuthn availability
  if (!window.PublicKeyCredential) {
    console.log('❌ WebAuthn not available');
    return {
      isCustomTabs: true,
      recommendedAction: 'redirect_to_browser'
    };
  }
  
  let platformAvailable = false;
  
  try {
    // Test platform authenticator
    platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    console.log('🔐 Platform authenticator available:', platformAvailable);
    
    if (platformAvailable) {
      console.log('✅ Platform authenticator detected - passkey creation might work with relaxed settings');
      
      // Suggest optimal settings for Custom Tabs
      console.log('💡 Recommended Custom Tabs settings:');
      console.log('  - authenticatorAttachment: undefined (allow any)');
      console.log('  - userVerification: "preferred"');
      console.log('  - residentKey: "preferred"');
      console.log('  - timeout: 60000ms');
      console.log('  - attestation: "none"');
      
    } else {
      console.log('⚠️ Platform authenticator not available - passkey creation likely to fail');
    }
    
    // Test conditional mediation
    if ((window.PublicKeyCredential as any).isConditionalMediationAvailable) {
      const conditionalAvailable = await (window.PublicKeyCredential as any).isConditionalMediationAvailable();
      console.log('🔄 Conditional mediation available:', conditionalAvailable);
    }
    
  } catch (error) {
    console.log('❌ Error testing Custom Tabs capabilities:', error);
  }
  
  console.log('🔗 Fallback options:');
  console.log('  1. Try Google Passkeys Demo: https://passkeys-demo.appspot.com/home');
  console.log('  2. Redirect to full Chrome browser');
  console.log('  3. Use alternative authentication');
  console.log('  4. Show user instructions for manual browser opening');
  
  return {
    isCustomTabs: isCustomTabsEnv,
    recommendedAction: platformAvailable ? 'try_with_relaxed_settings' : 'redirect_to_browser'
  };
};

/**
 * Setup Custom Tabs optimized WebAuthn
 */
export const setupCustomTabsWebAuthn = () => {
  const isCustomTabsEnv = navigator.userAgent.includes('wv') && 
                          navigator.userAgent.includes('Chrome') &&
                          !(window as any).chrome?.runtime;
  
  if (isCustomTabsEnv) {
    console.log('🔧 Setting up Custom Tabs optimized WebAuthn...');
    
    // Set global options for Custom Tabs
    (window as any).__webauthn_options = {
      authenticatorAttachment: undefined,
      userVerification: "preferred",
      residentKey: "preferred", 
      timeout: 60000,
      attestation: "none"
    };
    
    console.log('✅ Custom Tabs WebAuthn options applied');
    return true;
  }
  
  return false;
};

/**
 * Test passkey creation with Custom Tabs settings
 */
export const testCustomTabsPasskey = async (): Promise<{ success: boolean; error?: any; recommendation?: string }> => {
  const isCustomTabsEnv = navigator.userAgent.includes('wv') && 
                          navigator.userAgent.includes('Chrome') &&
                          !(window as any).chrome?.runtime;
  
  if (!isCustomTabsEnv) {
    return { success: false, error: 'Not in Custom Tabs environment' };
  }
  
  if (!window.PublicKeyCredential) {
    return { 
      success: false, 
      error: 'WebAuthn not supported',
      recommendation: 'Device does not support WebAuthn'
    };
  }
  
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    
    // Custom Tabs optimized options
    const options: CredentialCreationOptions = {
      publicKey: {
        rp: { 
          name: "Custom Tabs Test",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: "test@customtabs.com",
          displayName: "Custom Tabs Test"
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" }
        ],
        challenge,
        timeout: 60000,
        authenticatorSelection: {
          userVerification: "preferred",
          residentKey: "preferred"
        },
        attestation: "none"
      }
    };
    
    console.log('🧪 Testing Custom Tabs passkey creation...');
    const credential = await navigator.credentials.create(options);
    
    if (credential) {
      console.log('✅ Custom Tabs passkey creation successful!');
      return { 
        success: true,
        recommendation: 'Custom Tabs supports passkey creation with relaxed settings'
      };
    } else {
      return { 
        success: false, 
        error: 'No credential returned',
        recommendation: 'Try opening in full Chrome browser'
      };
    }
    
  } catch (error: any) {
    console.log('❌ Custom Tabs passkey test failed:', error.name, error.message);
    
    let recommendation = 'Try Google Passkeys Demo: https://passkeys-demo.appspot.com/home or open in full Chrome browser';
    
    if (error.name === 'NotReadableError') {
      recommendation = 'Device biometric authentication may be disabled or Custom Tabs has limited access. Try: https://passkeys-demo.appspot.com/home';
    } else if (error.name === 'NotAllowedError') {
      recommendation = 'User cancelled or Custom Tabs blocked the request. Try: https://passkeys-demo.appspot.com/home';
    } else if (error.name === 'NotSupportedError') {
      recommendation = 'Custom Tabs does not support this WebAuthn feature. Try: https://passkeys-demo.appspot.com/home';
    }
    
    return {
      success: false,
      error: error.message,
      recommendation
    };
  }
}; 