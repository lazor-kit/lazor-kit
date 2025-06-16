import { PlatformInfo } from "../utils/platform-detector";

export interface StatusMessage {
  message: string;
  type: string;
}

export interface PlatformState {
  environment: "browser" | "expo" | "unknown";
  platformInfo: PlatformInfo | null;
}

// Re-export platform types
export type { PlatformInfo } from "../utils/platform-detector";

// Window interface extensions
declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
    expo?: any;
    __expo?: any;
    chrome?: {
      runtime?: any;
    };
    PublicKeyCredential?: any;
  }
}
