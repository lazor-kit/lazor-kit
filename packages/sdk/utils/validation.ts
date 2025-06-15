// src/utils/validation.ts
import { CommunicationConfig } from '../core/dialog/CommunicationHandler';

export function validateConfig(config: CommunicationConfig): void {
  if (!config.url) {
    throw new Error('url is required');
  }

  try {
    new URL(config.url);
  } catch {
    throw new Error('Invalid url: must be a valid URL');
  }

  if (config.rpcUrl) {
    try {
      new URL(config.rpcUrl);
    } catch {
      throw new Error('Invalid rpcUrl: must be a valid URL');
    }
  }

  if (config.mode && !['popup', 'dialog', 'auto'].includes(config.mode)) {
    throw new Error('Invalid mode: must be "popup", "dialog", or "auto"');
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