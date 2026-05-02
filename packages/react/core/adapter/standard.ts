import {
    Wallet,
    WalletAccount,
} from '@wallet-standard/base';
import {
    StandardConnectFeature,
    StandardDisconnectFeature,
    StandardEventsFeature,
} from '@wallet-standard/features';
import {
    SolanaSignMessageFeature,
    SolanaSignTransactionFeature,
    SolanaSignAndSendTransactionFeature,
} from '@solana/wallet-standard-features';
import {
    registerWallet,
} from '@wallet-standard/wallet';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { LazorkitWalletAdapter, LazorkitWalletName, DEFAULT_CONFIG } from './adapter';

export function registerLazorkitWallet(config?: Partial<typeof DEFAULT_CONFIG>) {
    registerWallet(new LazorkitWalletStandard(config));
}

class LazorkitWalletStandard implements Wallet {
    readonly version = '1.0.0';
    readonly name = LazorkitWalletName;
    readonly icon = 'data:image/png;base64,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';

    private _adapter: LazorkitWalletAdapter;
    private _account: WalletAccount | null = null;
    private _listeners: Record<string, Function[]> = {};

    constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
        this._adapter = new LazorkitWalletAdapter(config);
        this._adapter.on('connect', (publicKey: PublicKey) => {
            this._account = {
                address: publicKey.toBase58(),
                publicKey: publicKey.toBytes(),
                chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
                features: [
                    'solana:signAndSendTransaction',
                    'solana:signTransaction',
                    'solana:signMessage',
                ],
            };
            this._emit('change', { accounts: [this._account] });
        });
        this._adapter.on('disconnect', () => {
            this._account = null;
            this._emit('change', { accounts: [] });
        });
    }

    get accounts() {
        return this._account ? [this._account] : [];
    }

    get chains() {
        return ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const;
    }

    get features(): StandardConnectFeature &
        StandardDisconnectFeature &
        StandardEventsFeature &
        SolanaSignAndSendTransactionFeature &
        SolanaSignTransactionFeature &
        SolanaSignMessageFeature {
        return {
            'standard:connect': {
                version: '1.0.0',
                connect: async () => {
                    await this._adapter.connect();
                    return { accounts: this.accounts };
                },
            },
            'standard:disconnect': {
                version: '1.0.0',
                disconnect: async () => {
                    await this._adapter.disconnect();
                },
            },
            'standard:events': {
                version: '1.0.0',
                on: (event: any, listener: any) => {
                    this._listeners[event] = this._listeners[event] || [];
                    this._listeners[event].push(listener);
                    return () => {
                        this._listeners[event] = this._listeners[event]?.filter((l: any) => l !== listener) || [];
                    };
                },
            },
            'solana:signAndSendTransaction': {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
                signAndSendTransaction: async (...inputs: any[]) => {
                    const results = [];
                    for (const input of inputs) {
                        const tx = VersionedTransaction.deserialize(input.transaction);
                        const signature = await this._adapter.sendTransaction(tx);
                        results.push({ signature: bs58.decode(signature) });
                    }
                    return results as any;
                },
            },
            'solana:signTransaction': {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
                signTransaction: async (..._inputs: any[]) => {
                    // Not supported
                    throw new Error('signTransaction not supported');
                },
            },
            'solana:signMessage': {
                version: '1.0.0',
                signMessage: async (...inputs: any[]) => {
                    const results = [];
                    for (const input of inputs) {
                        const signature = await this._adapter.signMessage(input.message);
                        results.push({
                            message: input.message,
                            signature,
                            signedMessage: input.message,
                        });
                    }
                    return results as any;
                },
            },
        };
    }

    private _emit(event: string, ...args: any[]) {
        // @ts-ignore
        this._listeners[event]?.forEach((l: any) => l(...args));
    }
}
