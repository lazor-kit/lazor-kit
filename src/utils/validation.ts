// src/utils/validation.ts
import { LazorSDKConfig } from '../types';

export function validateConfig(config: LazorSDKConfig): void {
  if (!config.dialogUrl) {
    throw new Error('dialogUrl is required');
  }

  try {
    new URL(config.dialogUrl);
  } catch {
    throw new Error('Invalid dialogUrl: must be a valid URL');
  }

  if (config.paymasterUrl) {
    try {
      new URL(config.paymasterUrl);
    } catch {
      throw new Error('Invalid paymasterUrl: must be a valid URL');
    }
  }

  if (config.dialogMode && !['popup', 'iframe', 'auto'].includes(config.dialogMode)) {
    throw new Error('Invalid dialogMode: must be "popup", "iframe", or "auto"');
  }

  if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
    throw new Error('Invalid timeout: must be a positive number');
  }
}

export function validateOrigin(origin: string, expectedOrigin: string): boolean {
  try {
    const url1 = new URL(origin);
    const url2 = new URL(expectedOrigin);
    return url1.origin === url2.origin;
  } catch {
    return false;
  }
}