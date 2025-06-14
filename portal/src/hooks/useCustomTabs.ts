type StatusCallback = (message: string, type: string) => void;

export function useCustomTabs() {
  const createPasskeyForCustomTabs = async (statusCallback: StatusCallback) => {
    statusCallback("Configuring for Custom Tabs environment...", "loading");
    
    try {
      const { createPasskey: originalCreatePasskey } = await import('../utils/webauthn');
      
      // Override WebAuthn options for Custom Tabs compatibility
      const customTabsOptions = {
        authenticatorAttachment: undefined, // Allow both platform and cross-platform
        userVerification: "preferred" as const,
        residentKey: "preferred" as const,
        timeout: 60000,
        attestation: "none" as const
      };
      
      // Patch global options temporarily
      const originalOptions = (window as any).__webauthn_options;
      (window as any).__webauthn_options = customTabsOptions;
      
      try {
        return await originalCreatePasskey(statusCallback);
      } finally {
        // Restore original options
        (window as any).__webauthn_options = originalOptions;
      }
      
    } catch (error) {
      statusCallback("Custom Tabs passkey creation failed", "error");
      throw error;
    }
  };

  const createFallbackAuth = async (statusCallback: StatusCallback) => {
    statusCallback("Setting up fallback authentication...", "loading");
    
    const fallbackCredentialId = 'fallback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const fallbackPublicKey = 'fallback_key_' + btoa(fallbackCredentialId);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    statusCallback("Fallback authentication created", "success");
    
    return {
      credentialId: fallbackCredentialId,
      publickey: fallbackPublicKey,
      authType: 'fallback'
    };
  };

  const handleCustomTabsError = (error: Error): string => {
    const errorName = error.name;
    
    if (errorName === 'NotReadableError' || errorName === 'NotAllowedError') {
      return `
        Authentication failed in Custom Tabs environment.
        
        Options:
        1. Try Google's Passkeys Demo: https://passkeys-demo.appspot.com/home
        2. Open this wallet in Chrome browser instead
        3. Use alternative authentication method
        4. Contact support for assistance
      `;
    }
    
    if (errorName === 'NotSupportedError') {
      return "Passkeys not supported in Custom Tabs. Please open in Chrome browser.";
    }
    
    return `
      Passkey creation failed: ${error.message}
      
      Error type: ${errorName}
      Note: Running in Custom Tabs environment with limited capabilities
      
      Please try:
      1. Refreshing the page
      2. Opening in Chrome browser
      3. Enabling biometric authentication
      4. Contacting support if the issue persists
    `;
  };

  return {
    createPasskeyForCustomTabs,
    createFallbackAuth,
    handleCustomTabsError
  };
}
