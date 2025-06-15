export interface DialogConfig {
  url: string;
  mode?: 'popup' | 'dialog' | 'auto';
  fallbackToPopup?: boolean;
}

export interface DialogEvents {
  connect: (data: any) => void;
  sign: (data: any) => void;
  pay: (data: any) => void;
  error: (error: Error) => void;
  message: (message: any) => void;
}
