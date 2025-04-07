import { PublicKey } from '@solana/web3.js';
export declare const useWallet: () => {
    connect: () => Promise<void>;
    disconnect: () => void;
    signMessage: (base64Tx: string) => Promise<unknown>;
    credentialId: string | null;
    publicKey: PublicKey | null;
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;
};
//# sourceMappingURL=useWallet.d.ts.map