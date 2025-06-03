// src/core/dialog/iframe.ts
import { Dialog, DialogSetupParams, DialogInstance, DialogConfig } from '../../types';
import { Messenger } from './Messenger';
import { popup } from './popup';
import { isSafari } from '../../utils/platform';
import { Logger } from '../../utils/logger';

export function iframe(config: DialogConfig & { fallbackToPopup?: boolean }): Dialog {
  return {
    name: 'iframe',
    setup(params: DialogSetupParams): DialogInstance {
      const logger = new Logger('IframeDialog');
      let isOpen = false;
      let dialog: HTMLDialogElement | null = null;
      let iframeEl: HTMLIFrameElement | null = null;
      let messenger: Messenger | null = null;
      let fallbackDialog: DialogInstance | null = null;
      let cleanupFunctions: (() => void)[] = [];
      let messengerReadyResolve: ((value: void) => void) | null = null;
      let messengerReadyPromise = new Promise<void>((resolve) => {
        messengerReadyResolve = resolve;
      });

      // Check if should fallback
      const shouldFallback = () => {
        if (!config.fallbackToPopup) return false;
        
        // Safari WebAuthn issue
        if (isSafari()) {
          logger.warn('Safari detected, falling back to popup');
          return true;
        }
        
        // HTTP protocol
        if (window.location.protocol !== 'https:') {
          logger.warn('HTTP protocol detected, falling back to popup');
          return true;
        }
        
        return false;
      };

      // Create dialog elements
      const create = () => {
        // Reset ready promise for new dialog
        messengerReadyPromise = new Promise<void>((resolve) => {
          messengerReadyResolve = resolve;
        });
        
        // Create dialog element
        dialog = document.createElement('dialog');
        dialog.setAttribute('data-lazor-dialog', '');
        dialog.style.cssText = `
          padding: 0;
          border: none;
          background: transparent;
          max-width: 100%;
          max-height: 100%;
          overflow: visible;
          margin: 0;
        `;

        // Create iframe
        iframeEl = document.createElement('iframe');
        iframeEl.src = params.url;
        
        // Security attributes
        const url = new URL(params.url);
        iframeEl.setAttribute('allow', 
          `publickey-credentials-get ${url.origin}; ` +
          `publickey-credentials-create ${url.origin}; ` +
          `clipboard-write`
        );
        iframeEl.setAttribute('sandbox',
          'allow-forms allow-scripts allow-same-origin ' +
          'allow-popups allow-popups-to-escape-sandbox'
        );
        
        // Accessibility
        iframeEl.setAttribute('title', 'Lazor Wallet Dialog');
        iframeEl.setAttribute('aria-label', 'Wallet authentication dialog');
        iframeEl.setAttribute('role', 'dialog');
        
        // Apply styles
        applyIframeStyles(iframeEl);
        
        dialog.appendChild(iframeEl);
        document.body.appendChild(dialog);

        // Inject styles
        injectStyles();
        
        // Wait for iframe to load before setting up messenger
        const loadTimeout = setTimeout(() => {
          logger.error('Iframe load timeout');
          if (messengerReadyResolve) {
            // Reject instead of resolving to handle timeout
            messengerReadyPromise = Promise.reject(new Error('Iframe load timeout'));
          }
        }, 10000); // 10 second timeout
        
        iframeEl.addEventListener('load', () => {
          clearTimeout(loadTimeout);
          logger.debug('Iframe loaded, setting up messenger');
          
          if (!iframeEl || !iframeEl.contentWindow) {
            logger.error('Iframe or contentWindow not available');
            if (messengerReadyResolve) {
              messengerReadyPromise = Promise.reject(new Error('Iframe contentWindow not available'));
            }
            return;
          }
          
          // Setup messenger
          messenger = new Messenger({
            target: iframeEl.contentWindow,
            origin: params.origin,
            onMessage: params.onMessage,
            onError: params.onError
          });

          // Handle resize messages
          messenger.on('resize', (data: { width?: number; height?: number }) => {
            if (!iframeEl) return;
            if (data.height) iframeEl.style.height = `${data.height}px`;
            if (data.width && window.innerWidth > 640) {
              iframeEl.style.width = `${data.width}px`;
            }
          });
          
          // Resolve ready promise
          if (messengerReadyResolve) {
            messengerReadyResolve();
            logger.debug('Messenger ready');
          }
          
          // Note: Dialog will send its own READY message when initialized
          // We don't need to send init message
        });

        // Handle escape key
        const handleEscape = (e: Event) => {
          e.preventDefault();
          instance.close();
        };
        dialog.addEventListener('cancel', handleEscape);
        cleanupFunctions.push(() => dialog?.removeEventListener('cancel', handleEscape));

        // Handle backdrop click
        const handleBackdropClick = (e: MouseEvent) => {
          if (e.target === dialog) {
            instance.close();
          }
        };
        dialog.addEventListener('click', handleBackdropClick);
        cleanupFunctions.push(() => dialog?.removeEventListener('click', handleBackdropClick));

        logger.debug('Dialog created');
      };

      const instance: DialogInstance = {
        open() {
          // Check if should use fallback
          if (shouldFallback()) {
            if (!fallbackDialog) {
              fallbackDialog = popup(config).setup(params);
            }
            return fallbackDialog.open();
          }

          if (isOpen) return;
          
          if (!dialog) create();
          
          isOpen = true;
          
          // Store current body overflow
          const bodyOverflow = document.body.style.overflow;
          
          // Show modal
          dialog!.showModal();
          document.body.style.overflow = 'hidden';
          
          // Restore body overflow on close
          cleanupFunctions.push(() => {
            document.body.style.overflow = bodyOverflow;
          });
          
          logger.debug('Dialog opened');
        },

        close() {
          if (fallbackDialog) {
            return fallbackDialog.close();
          }

          if (!isOpen || !dialog) return;
          
          isOpen = false;
          dialog.close();
          
          // Run cleanup functions
          cleanupFunctions.forEach(fn => fn());
          cleanupFunctions = [];
          
          params.onClose();
          logger.debug('Dialog closed');
        },

        destroy() {
          if (fallbackDialog) {
            fallbackDialog.destroy();
            fallbackDialog = null;
          }

          this.close();
          
          messenger?.destroy();
          dialog?.remove();
          
          // Remove injected styles
          const styleEl = document.getElementById('lazor-dialog-styles');
          styleEl?.remove();
          
          dialog = null;
          iframeEl = null;
          messenger = null;
          
          logger.debug('Dialog destroyed');
        },

        async send(message: any) {
          if (fallbackDialog) {
            return fallbackDialog.send(message);
          }

          // Wait for messenger to be ready
          await messengerReadyPromise;
          
          if (!messenger) throw new Error('Dialog not initialized');
          return messenger.send(message);
        },

        isOpen() {
          if (fallbackDialog) {
            return fallbackDialog.isOpen();
          }
          return isOpen;
        }
      };

      return instance;
    }
  };
}

function applyIframeStyles(iframe: HTMLIFrameElement) {
  iframe.style.cssText = `
    border: none;
    background: white;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    width: 400px;
    height: 600px;
    max-height: 90vh;
    display: block;
  `;
}

function injectStyles() {
  if (document.getElementById('lazor-dialog-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'lazor-dialog-styles';
  style.textContent = `
    dialog[data-lazor-dialog] {
      padding: 0;
      border: none;
      background: transparent;
      margin: 0;
      max-width: 100vw;
      max-height: 100vh;
    }
    
    dialog[data-lazor-dialog]::backdrop {
      background-color: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    
    /* Mobile responsive */
    @media (max-width: 640px) {
      dialog[data-lazor-dialog] {
        padding: 0;
        margin: 0;
        max-width: 100%;
        max-height: 100%;
      }
      
      dialog[data-lazor-dialog] iframe {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100vw !important;
        height: 85vh !important;
        max-height: 85vh !important;
        border-bottom-left-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
        animation: slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1);
      }
    }
    
    /* Desktop animation */
    @media (min-width: 641px) {
      dialog[data-lazor-dialog] iframe {
        animation: fadeIn 0.2s cubic-bezier(0.32, 0.72, 0, 1);
      }
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes slideUp {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }
  `;
  
  document.head.appendChild(style);
}