// src/types/message.types.ts
export interface BaseMessage {
  id: string;
  type: string;
  timestamp: number;
  version: string;
  source: 'parent' | 'dialog';
}

export interface RequestMessage extends BaseMessage {
  method: string;
  params?: any;
}

export interface ResponseMessage extends BaseMessage {
  requestId: string;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  duration?: number;
}

export interface ConnectRequest {
  challenge: string;
  origin: string;
  skipWarning?: boolean;
}

export interface ConnectResponse {
  publicKey: string;
  credentialId: string;
  isCreated: boolean;
}

export interface SignRequest {
  message: string;
  origin: string;
}

export interface SignResponse {
  normalized: string;
  msg: string;
  clientDataJSONReturn: string;
  authenticatorDataReturn: string;
}