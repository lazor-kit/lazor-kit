export type MessageType = 
  | "passkey:connect" 
  | "passkey:connect:response"
  | "passkey:sign" 
  | "passkey:sign:response";

export interface BaseMessage {
  id: string;
  type: MessageType;
  timestamp: number;
  version: "1.0";
  source: "parent" | "dialog";
  requestId?: string;
  duration?: number;
}

export interface ConnectRequest extends BaseMessage {
  type: "passkey:connect";
  source: "parent";
  data: {
    origin: string;
    challenge: string;
  };
}

export interface ConnectResponse extends BaseMessage {
  type: "passkey:connect:response";
  source: "dialog";
  requestId: string;
  duration: number;
  data?: {
    publicKey: string;
    credentialId: string;
    isCreated: boolean;
    signature: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface SignRequest extends BaseMessage {
  type: "passkey:sign";
  source: "parent";
  data: {
    origin: string;
    message: string;
    credentialId?: string;
    description?: string;
  };
}

export interface SignResponse extends BaseMessage {
  type: "passkey:sign:response";
  source: "dialog";
  requestId: string;
  duration: number;
  data?: {
    authenticatorData: string;
    clientDataJSON: string;
    rawMessage: string;
    clientDataJSONDigest: string;
    signature: string;
    nonce: string;
    timestamp: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}