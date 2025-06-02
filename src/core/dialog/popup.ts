// src/core/dialog/popup.ts
import { Dialog, DialogSetupParams, DialogInstance, DialogConfig } from '../../types';
import { Messenger } from './Messenger';
import { Logger } from '../../utils/logger';
import { SDKError, ErrorCode } from '../../constants/errors';

export function popup(config: DialogConfig): Dialog {
  return {
    name: 'popup',
    setup(params: DialogSetupParams): DialogInstance {
      const logger = new Logger('PopupDialog');
      let popupWindow: Window | null = null;
      let messenger: Messenger | null = null;
      let checkInterval: number | null = null;
      let isOpen = false;

      const instance: DialogInstance = {
        open() {
          if (popupWindow && !popupWindow.closed) {
            popupWindow.focus();
            return;
          }

          // Calculate center position
          const width = 420;
          const height = 640;
          const left = Math.max(0, (window.innerWidth - width) / 2 + window.screenX);
          const top = Math.max(0, (window.innerHeight - height) / 2 + window.screenY);

          // Build popup features
          const features = [
            `width=${width}`,
            `height=${height}`,
            `left=${left}`,
            `top=${top}`,
            'toolbar=no',
            'menubar=no',
            'location=no',
            'status=no',
            'scrollbars=no',
            'resizable=no'
          ].join(',');

          // Open popup
          popupWindow = window.open(params.url, 'lazor-wallet-dialog', features);

          if (!popupWindow) {
            const error = new SDKError(
              ErrorCode.POPUP_BLOCKED,
              'Failed to open popup. Please check your popup blocker settings.'
            );
            params.onError?.(error);
            throw error;
          }

          isOpen = true;

          // Setup messenger
          messenger = new Messenger({
            target: popupWindow,
            origin: params.origin,
            onMessage: params.onMessage,
            onError: params.onError
          });

          // Check if popup is closed
          checkInterval = window.setInterval(() => {
            if (popupWindow?.closed) {
              instance.close();
            }
          }, 500);

          // Send init message after a short delay
          setTimeout(() => {
            messenger?.send({
              type: 'dialog:init',
              mode: 'popup',
              origin: window.location.origin,
              timestamp: Date.now()
            }).catch(err => {
              logger.error('Failed to send init message:', err);
            });
          }, 100);

          logger.debug('Popup opened');
        },

        close() {
          if (!isOpen) return;
          
          isOpen = false;
          
          if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
          }

          popupWindow?.close();
          popupWindow = null;
          
          params.onClose();
          logger.debug('Popup closed');
        },

        destroy() {
          this.close();
          messenger?.destroy();
          messenger = null;
          logger.debug('Popup destroyed');
        },

        async send(message: any) {
          if (!messenger) throw new Error('Popup not initialized');
          if (popupWindow?.closed) throw new Error('Popup window closed');
          
          return messenger.send(message);
        },

        isOpen() {
          return isOpen && !!popupWindow && !popupWindow.closed;
        }
      };

      return instance;
    }
  };
}