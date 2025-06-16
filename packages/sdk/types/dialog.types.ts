// src/types/dialog.types.ts
export interface Dialog {
  name: string;
  setup: (params: DialogSetupParams) => DialogInstance;
}

export interface DialogInstance {
  open(): void;
  close(): void;
  destroy(): void;
  send(message: any): Promise<any>;
  isOpen(): boolean;
}

export interface DialogSetupParams {
  url: string;
  origin: string;
  onMessage: (message: any) => void;
  onClose: () => void;
  onError?: (error: Error) => void;
}

export interface DialogConfig {
  url: string;
  mode?: 'iframe' | 'popup' | 'auto';
  fallbackToPopup?: boolean;
}