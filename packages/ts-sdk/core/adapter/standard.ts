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
