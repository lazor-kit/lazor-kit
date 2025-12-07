// src/utils/platform.ts
export type Platform = 'web' | 'mobile' | 'desktop';

export function detectPlatform(): Platform {
  // Check if running in React Native
  // @ts-ignore
  if (typeof window !== 'undefined' && window.ReactNativeWebView) {
    return 'mobile';
  }

  // Check if running in mobile browser
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  
  if (isMobile) {
    return 'mobile';
  }

  return 'web';
}

export function isSafari(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return /^((?!chrome|android).)*safari/i.test(userAgent);
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}