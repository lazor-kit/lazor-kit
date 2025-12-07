import {
    Connection,
    TransactionInstruction,
} from '@solana/web3.js';
import { WalletInfo, WalletConfig } from '../storage';

export interface WalletState {
    // Data
    wallet: WalletInfo | null;
    config: WalletConfig;
    connection: Connection;

    // Status
    isLoading: boolean;
    isConnecting: boolean;
    isSigning: boolean;
    error: Error | null;

    // State setters
    setConfig: (config: WalletConfig) => void;
    setWallet: (wallet: WalletInfo | null) => void;
    setLoading: (isLoading: boolean) => void;
    setConnecting: (isConnecting: boolean) => void;
    setSigning: (isSigning: boolean) => void;
    setConnection: (connection: Connection) => void;
    setError: (error: Error | null) => void;
    clearError: () => void;

    // Actions
    connect: () => Promise<WalletInfo>;
    disconnect: () => Promise<void>;
    signAndSendTransaction: (instruction: TransactionInstruction) => Promise<string>;
}

export interface ConnectOptions {
    readonly onSuccess?: (wallet: WalletInfo) => void;
    readonly onFail?: (error: Error) => void;
}

export interface DisconnectOptions {
    readonly onSuccess?: () => void;
    readonly onFail?: (error: Error) => void;
}

export interface SignOptions {
    readonly onSuccess?: (signature: string) => void;
    readonly onFail?: (error: Error) => void;
}





export interface SignResponse {
    readonly msg?: string;
    readonly normalized: string;
    readonly clientDataJSONReturn: string;
    readonly authenticatorDataReturn: string;
}
