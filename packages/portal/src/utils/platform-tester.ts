// Comprehensive Platform Testing Utilities
// Tests WebAuthn compatibility across Desktop, iOS, and Android

import { detectPlatform, PlatformInfo, applyPlatformOptimizations } from './platform-detector';

export interface PlatformTestResult {
  platform: PlatformInfo;
  webauthnSupported: boolean;
  passkeyCreationTest: TestResult;
  passkeyAuthenticationTest: TestResult;
  platformAuthenticatorTest: TestResult;
  biometricTest: TestResult;
  overallScore: number; // 0-100
  recommendations: string[];
  debugInfo: any;
}

export interface TestResult {
  success: boolean;
  error?: string;
  details?: any;
  score: number; // 0-100
}

/**
 * Run comprehensive platform tests
 */
export const runPlatformTests = async (): Promise<PlatformTestResult> => {
  console.log('🧪 Starting comprehensive platform tests...');
  
  const platform = detectPlatform();
  console.log(`📱 Detected platform: ${platform.type} (${platform.browser})`);
  
  // Apply platform optimizations
  applyPlatformOptimizations(platform);
  
  const result: PlatformTestResult = {
    platform,
    webauthnSupported: !!window.PublicKeyCredential,
    passkeyCreationTest: { success: false, score: 0 },
    passkeyAuthenticationTest: { success: false, score: 0 },
    platformAuthenticatorTest: { success: false, score: 0 },
    biometricTest: { success: false, score: 0 },
    overallScore: 0,
    recommendations: [],
    debugInfo: {}
  };
  
  // Test WebAuthn support
  if (!result.webauthnSupported) {
    result.recommendations.push('WebAuthn not supported - please update browser');
    return result;
  }
  
  // Test platform authenticator availability
  result.platformAuthenticatorTest = await testPlatformAuthenticator();
  
  // Test biometric capabilities
  result.biometricTest = await testBiometricCapabilities(platform);
  
  // Test passkey creation
  result.passkeyCreationTest = await testPasskeyCreation(platform);
  
  // Test passkey authentication (if creation succeeded)
  if (result.passkeyCreationTest.success) {
    result.passkeyAuthenticationTest = await testPasskeyAuthentication(platform);
  }
  
  // Calculate overall score
  result.overallScore = calculateOverallScore(result);
  
  // Generate recommendations
  result.recommendations = generateRecommendations(result);
  
  // Collect debug info
  result.debugInfo = collectDebugInfo(platform);
  
  console.log(`✅ Platform tests completed. Score: ${result.overallScore}/100`);
  
  return result;
};

/**
 * Test platform authenticator availability
 */
async function testPlatformAuthenticator(): Promise<TestResult> {
  try {
    if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      return {
        success: false,
        error: 'Platform authenticator API not available',
        score: 0
      };
    }
    
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    
    return {
      success: available,
      details: { available },
      score: available ? 100 : 20
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      score: 0
    };
  }
}

/**
 * Test biometric capabilities
 */
async function testBiometricCapabilities(platform: PlatformInfo): Promise<TestResult> {
  const result: TestResult = { success: false, score: 0, details: {} };
  
  try {
    // Platform-specific biometric checks
    switch (platform.type) {
      case 'ios':
        result.details = await testIOSBiometrics();
        break;
      case 'android':
        result.details = await testAndroidBiometrics(platform);
        break;
      case 'desktop':
        result.details = await testDesktopBiometrics(platform);
        break;
    }
    
    result.success = result.details.biometricSupported || false;
    result.score = result.success ? 90 : 30;
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  
  return result;
}

/**
 * Test passkey creation
 */
async function testPasskeyCreation(platform: PlatformInfo): Promise<TestResult> {
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    
    const options: CredentialCreationOptions = {
      publicKey: {
        rp: { 
          name: "Platform Test",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: "test@platform.com",
          displayName: "Platform Test User"
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" }
        ],
        challenge,
        timeout: platform.webauthnOptions.timeout,
        authenticatorSelection: {
          authenticatorAttachment: platform.webauthnOptions.authenticatorAttachment,
          userVerification: platform.webauthnOptions.userVerification,
          residentKey: platform.webauthnOptions.residentKey
        },
        attestation: platform.webauthnOptions.attestation
      }
    };
    
    console.log('🔐 Testing passkey creation with platform-optimized options...');
    const credential = await navigator.credentials.create(options);
    
    if (credential) {
      const score = platform.type === 'android' && platform.browser === 'custom-tabs' ? 70 : 100;
      
      return {
        success: true,
        details: {
          credentialId: (credential as any).id,
          type: credential.type,
          platform: platform.type
        },
        score
      };
    } else {
      return {
        success: false,
        error: 'No credential returned',
        score: 0
      };
    }
    
  } catch (error: any) {
    let score = 0;
    
    // Some errors are expected/recoverable
    if (error.name === 'NotAllowedError' && platform.browser === 'custom-tabs') {
      score = 30; // Partial credit for Custom Tabs
    }
    
    return {
      success: false,
      error: `${error.name}: ${error.message}`,
      details: { errorName: error.name, platform: platform.type },
      score
    };
  }
}

/**
 * Test passkey authentication
 */
async function testPasskeyAuthentication(platform: PlatformInfo): Promise<TestResult> {
  try {
    // This is a theoretical test since we can't use the actual credential
    // created in the previous test due to browser security
    
    console.log('🔍 Testing passkey authentication capabilities...');
    
    // Check if get() API is available
    if (!navigator.credentials.get) {
      return {
        success: false,
        error: 'Credentials.get() API not available',
        score: 0
      };
    }
    
    // Platform-specific authentication capabilities
    let score = 80;
    
    if (platform.browser === 'custom-tabs') {
      score = 60; // Lower score for Custom Tabs
    } else if (platform.browser === 'webview') {
      score = 70; // Lower score for WebView
    }
    
    return {
      success: true,
      details: { 
        apiAvailable: true,
        platform: platform.type,
        browser: platform.browser
      },
      score
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      score: 0
    };
  }
}

/**
 * iOS Biometric Testing
 */
async function testIOSBiometrics(): Promise<any> {
  const details: any = {
    platform: 'ios',
    biometricSupported: false,
    features: []
  };
  
  // Check for Touch ID/Face ID indicators
  if ('TouchEvent' in window) {
    details.features.push('Touch events supported');
  }
  
  // Check iOS version
  const iOSVersion = navigator.userAgent.match(/OS (\d+)_/)?.[1];
  if (iOSVersion) {
    details.iOSVersion = parseInt(iOSVersion);
    details.biometricSupported = details.iOSVersion >= 16;
    details.features.push(`iOS ${details.iOSVersion} detected`);
  }
  
  // Check for Safari
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  details.features.push(isSafari ? 'Safari browser' : 'Non-Safari browser');
  
  return details;
}

/**
 * Android Biometric Testing
 */
async function testAndroidBiometrics(platform: PlatformInfo): Promise<any> {
  const details: any = {
    platform: 'android',
    biometricSupported: false,
    features: [],
    customTabs: platform.browser === 'custom-tabs'
  };
  
  // Check Android version
  const androidVersion = navigator.userAgent.match(/Android (\d+)/)?.[1];
  if (androidVersion) {
    details.androidVersion = parseInt(androidVersion);
    details.biometricSupported = details.androidVersion >= 9; // Android 9+ for better biometric support
    details.features.push(`Android ${details.androidVersion} detected`);
  }
  
  // Check Chrome version
  const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1];
  if (chromeVersion) {
    details.chromeVersion = parseInt(chromeVersion);
    details.features.push(`Chrome ${details.chromeVersion} detected`);
  }
  
  // Custom Tabs specific features
  if (details.customTabs) {
    details.features.push('Chrome Custom Tabs environment');
    details.biometricSupported = details.biometricSupported && details.chromeVersion >= 108; // Better Custom Tabs support
  }
  
  return details;
}

/**
 * Desktop Biometric Testing
 */
async function testDesktopBiometrics(platform: PlatformInfo): Promise<any> {
  const details: any = {
    platform: 'desktop',
    biometricSupported: false,
    features: [],
    browser: platform.browser
  };
  
  // Check OS platform
  const isWindows = /Windows/.test(navigator.userAgent);
  const isMac = /Mac/.test(navigator.userAgent);
  const isLinux = /Linux/.test(navigator.userAgent);
  
  if (isWindows) {
    details.features.push('Windows OS');
    details.biometricSupported = true; // Windows Hello
  } else if (isMac) {
    details.features.push('macOS');
    details.biometricSupported = true; // Touch ID
  } else if (isLinux) {
    details.features.push('Linux OS');
    details.biometricSupported = false; // Limited biometric support
  }
  
  // Browser-specific features
  switch (platform.browser) {
    case 'chrome':
    case 'edge':
      details.features.push('Chromium-based browser');
      break;
    case 'safari':
      details.features.push('Safari browser');
      break;
    case 'firefox':
      details.features.push('Firefox browser');
      break;
  }
  
  return details;
}

/**
 * Calculate overall compatibility score
 */
function calculateOverallScore(result: PlatformTestResult): number {
  const weights = {
    webauthn: 0.2,
    platformAuth: 0.25,
    biometric: 0.15,
    creation: 0.25,
    authentication: 0.15
  };
  
  let score = 0;
  
  score += result.webauthnSupported ? weights.webauthn * 100 : 0;
  score += result.platformAuthenticatorTest.score * weights.platformAuth;
  score += result.biometricTest.score * weights.biometric;
  score += result.passkeyCreationTest.score * weights.creation;
  score += result.passkeyAuthenticationTest.score * weights.authentication;
  
  return Math.round(score);
}

/**
 * Generate platform-specific recommendations
 */
function generateRecommendations(result: PlatformTestResult): string[] {
  const recommendations = [...result.platform.optimizations];
  
  if (result.overallScore < 50) {
    recommendations.unshift('⚠️ Low compatibility score - consider alternative authentication');
  } else if (result.overallScore < 80) {
    recommendations.unshift('🔧 Moderate compatibility - follow optimization recommendations');
  } else {
    recommendations.unshift('✅ Good compatibility - passkeys should work well');
  }
  
  // Platform-specific recommendations
  if (result.platform.type === 'android' && result.platform.browser === 'custom-tabs') {
    recommendations.push('🌐 For best experience, provide "Open in Browser" option');
  }
  
  if (result.platform.type === 'ios' && result.platform.browser === 'webview') {
    recommendations.push('📱 Consider using SFSafariViewController for better WebAuthn support');
  }
  
  return recommendations;
}

/**
 * Collect debug information
 */
function collectDebugInfo(platform: PlatformInfo): any {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency,
    maxTouchPoints: navigator.maxTouchPoints,
    webauthnAPI: {
      PublicKeyCredential: !!window.PublicKeyCredential,
      create: !!navigator.credentials?.create,
      get: !!navigator.credentials?.get
    },
    detectedPlatform: platform,
    timestamp: new Date().toISOString()
  };
}

/**
 * Quick platform test for console debugging
 */
export const quickPlatformTest = async () => {
  console.log('🚀 Quick Platform Test Starting...');
  
  const platform = detectPlatform();
  console.log('📱 Platform:', platform);
  
  if (platform.supportsPasskeys) {
    console.log('✅ Platform supports passkeys');
    
    try {
      const available = await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable();
      console.log('🔐 Platform authenticator available:', available);
    } catch (error) {
      console.log('❌ Error checking platform authenticator:', error);
    }
  } else {
    console.log('❌ Platform does not support passkeys');
  }
  
  console.log('💡 Optimizations:', platform.optimizations);
  console.log('⚙️ WebAuthn Options:', platform.webauthnOptions);
  
  return platform;
}; 