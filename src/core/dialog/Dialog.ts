// src/core/dialog/Dialog.ts
import { Dialog, DialogConfig } from '../../types';
import { iframe } from './iframe';
import { popup } from './popup';
import { detectPlatform, isSafari } from '../../utils/platform';

export function createDialog(config: DialogConfig): Dialog {
  const { mode = 'auto', fallbackToPopup = true } = config;

  // Auto detect mode
  const selectedMode = mode === 'auto' ? detectBestMode() : mode;

  // Return appropriate dialog
  if (selectedMode === 'iframe') {
    return iframe({ ...config, fallbackToPopup });
  }
  
  return popup(config);
}

function detectBestMode(): 'iframe' | 'popup' {
  // Safari doesn't support WebAuthn in iframe
  if (isSafari()) return 'popup';
  
  // Check if HTTPS
  if (window.location.protocol !== 'https:') return 'popup';
  
  // Mobile devices might work better with popup
  const platform = detectPlatform();
  if (platform === 'mobile') return 'popup';
  
  // Default to iframe
  return 'iframe';
}