import { useState, useEffect } from "react";
import { 
  detectPlatform, 
  applyPlatformOptimizations 
} from "../utils/platform-detector";
import { quickPlatformTest } from "../utils/platform-tester";
import { PlatformState } from "../types/wallet";

export function usePlatform() {
  const [state, setState] = useState<PlatformState>({
    environment: "unknown",
    platformInfo: null
  });

  useEffect(() => {
    const initializePlatform = async () => {
      try {
        console.log('🔄 Initializing platform detection...');
        
        const platform = detectPlatform();
        applyPlatformOptimizations(platform);
        
        setState({
          environment: detectEnvironment(),
          platformInfo: platform
        });
        
        console.log(`✅ Platform initialized: ${platform.type} (${platform.browser})`);
        console.log('🎯 Applied optimizations:', platform.optimizations);
        
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev')) {
          quickPlatformTest().catch(console.error);
        }
      } catch (error) {
        console.error('❌ Platform initialization failed:', error);
      }
    };
    
    initializePlatform();
  }, []);

  const detectEnvironment = (): "browser" | "expo" | "unknown" => {
    if (typeof window !== "undefined") {
      if (window.navigator.userAgent.includes("Expo") ||
          window.ReactNativeWebView ||
          window.expo || 
          window.__expo ||
          window.location.protocol === "file:" || 
          window.navigator.userAgent.includes("expo") ||
          window.navigator.userAgent.includes("ExponentJS")) {
        return "expo";
      }
      return "browser";
    }
    return "unknown";
  };

  const isCustomTabs = () => {
    return window.navigator.userAgent.includes('wv') && 
           window.navigator.userAgent.includes('Chrome') &&
           !window.chrome?.runtime;
  };

  const checkWebAuthnSupport = () => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      return { supported: false, reason: "WebAuthn not supported in this browser" };
    }
    
    if (!state.platformInfo) {
      return { supported: true, reason: "Platform detection pending" };
    }
    
    return { supported: true, reason: "" };
  };

  return {
    ...state,
    isCustomTabs,
    checkWebAuthnSupport
  };
}
