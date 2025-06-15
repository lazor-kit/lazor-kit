export interface BaseResponse {
  success: boolean;
  error?: {
    code: number;
    message: string;
  };
  data?: any;
}

export interface ConnectResponseData {
  publicKey: string;
  signature: string;
  isCreated: boolean;
}

export interface ConnectResponse extends BaseResponse {
  success: boolean;
  data: ConnectResponseData;
}

export interface SignResponseData {
  signature: string;
  publicKey: string;
}

export interface SignResponse extends BaseResponse {
  success: boolean;
  data: SignResponseData;
}

export interface TransactionResponse extends BaseResponse {
  txHash?: string;
  transaction: string;
}
