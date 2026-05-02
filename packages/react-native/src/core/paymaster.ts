/*
  Paymaster service integration for Kora

  JSON-RPC client for the paymaster service that sponsors fees on LazorKit
  wallet transactions.
*/
import { PublicKey } from '@solana/web3.js';

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

const rpcRequest = async <T>(
  method: string,
  params: any,
  paymasterUrl: string,
  apiKey?: string
): Promise<T> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(paymasterUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const json: JsonRpcResponse<T> = await response.json();

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  if (!json.result) {
    throw new Error('RPC result is undefined');
  }

  return json.result;
};

/**
 * Retrieves the fee payer signer from the paymaster.
 */
export const getFeePayer = async (paymasterUrl: string, apiKey?: string): Promise<PublicKey> => {
  interface GetPayerSignerResult {
    payment_address: string;
    signer_address: string;
  }

  const result = await rpcRequest<GetPayerSignerResult>(
    'getPayerSigner',
    [],
    paymasterUrl,
    apiKey
  );

  if (!result.signer_address) {
    throw new Error('Failed to get fee payer');
  }

  return new PublicKey(result.signer_address);
};

/**
 * Signs and immediately broadcasts a transaction via the paymaster.
 */
export const signAndExecuteTransaction = async (
  base64EncodedTransaction: string,
  paymasterUrl: string,
  signerKey: string,
  apiKey?: string,
  feeToken?: string
) => {
  interface SignAndSendResult {
    signature: string;
    signed_transaction: string;
    signer_pubkey: string;
  }
  const result = await rpcRequest<SignAndSendResult>(
    'signAndSendTransaction',
    {
      transaction: base64EncodedTransaction,
      signer_key: signerKey,
      ...(feeToken && { fee_token: feeToken }),
    },
    paymasterUrl,
    apiKey
  );

  if (!result.signature) {
    throw new Error('Failed to sign and execute transaction');
  }

  return result.signature;
};

/**
 * Signs a transaction with the paymaster but does NOT broadcast it.
 */
export const signTransaction = async (
  base64EncodedTransaction: string,
  paymasterUrl: string,
  signerKey: string,
  apiKey?: string,
  _feeToken?: string
) => {
  interface SignTransactionResult {
    signature: string;
    signed_transaction: string;
    signer_pubkey: string;
  }

  const result = await rpcRequest<SignTransactionResult>(
    'signTransaction',
    {
      transaction: base64EncodedTransaction,
      signer_key: signerKey,
    },
    paymasterUrl,
    apiKey
  );

  if (!result.signed_transaction) {
    throw new Error('Failed to sign transaction');
  }

  return {
    signature: result.signature,
    signed_transaction: result.signed_transaction,
  };
};

/**
 * Retrieves the list of tokens supported by the paymaster for fee payment.
 */
export const getSupportedFeeTokens = async (
  paymasterUrl: string,
  apiKey?: string
) => {
  interface GetSupportedTokensResult {
    tokens: string[];
  }

  const result = await rpcRequest<GetSupportedTokensResult>(
    'getSupportedTokens',
    [],
    paymasterUrl,
    apiKey
  );

  if (!result.tokens) {
    throw new Error('Failed to get supported fee tokens');
  }

  return result.tokens;
};
