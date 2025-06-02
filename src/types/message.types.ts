// src/types/message.types.ts
export interface BaseMessage {
  id: string;
  timestamp: number;
  version: '1.0';
  source: 'parent' | 'dialog';
}

export interface ConnectRequest extends BaseMessage {
  type: 'passkey:connect';
  data: {
    origin: string;
    challenge: string;
  };
}

export interface ConnectResponse extends BaseMessage {
  type: 'passkey:connect:response';
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
    details: {
      step: string;
      timestamp: number;
    };
  };
}

export interface SignRequest extends BaseMessage {
  type: 'passkey:sign';
  data: {
    message: string;
    origin: string;
    nonce: string;
    credentialId?: string;
  };
}

export interface SignResponse extends BaseMessage {
  type: 'passkey:sign:response';
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
    details: {
      step: string;
      timestamp: number;
    };
  };
}

export type DialogMessage = 
  | ConnectRequest 
  | ConnectResponse 
  | SignRequest 
  | SignResponse;