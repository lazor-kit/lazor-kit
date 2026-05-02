// src/constants/errors.ts
import { ErrorCode } from '../types/errors.types';

export class SDKError extends Error {
  code: ErrorCode;
  details?: any;

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message);
    this.name = 'LazorSDKError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, SDKError.prototype);
  }
}

export { ErrorCode };