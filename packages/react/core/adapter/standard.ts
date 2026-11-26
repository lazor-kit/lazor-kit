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
import { LazorkitWalletAdapter, LazorkitWalletName, type LazorkitAdapterConfig } from './adapter';
import type { ConfirmWalletHandler } from '../wallet/confirmation';
import { lazorkitWalletIcon } from './icon';

/**
 * The adapter's config, less `onConfirmWallet: 'throw'`: finishing that takes
 * a second connect with `confirmWallet`, and `standard:connect` has no way to
 * carry one — the dApp only ever sees the error.
 */
type LazorkitStandardConfig = Partial<Omit<LazorkitAdapterConfig, 'onConfirmWallet'>> & {
    onConfirmWallet?: 'builtin' | ConfirmWalletHandler;
};

export function registerLazorkitWallet(config?: LazorkitStandardConfig) {
    if ((config?.onConfirmWallet as unknown) === 'throw') {
        throw new Error(
            "registerLazorkitWallet: onConfirmWallet 'throw' cannot work through the Wallet Standard, " +
                "which gives no way to connect again with confirmWallet. Use 'builtin' (the default) or a handler.",
        );
    }
    registerWallet(new LazorkitWalletStandard(config));
}

class LazorkitWalletStandard implements Wallet {
    readonly version = '1.0.0';
    readonly name = LazorkitWalletName;
    readonly icon = lazorkitWalletIcon;

    private _adapter: LazorkitWalletAdapter;
    private _account: WalletAccount | null = null;
    private _listeners: Record<string, Function[]> = {};

    constructor(config?: LazorkitStandardConfig) {
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
                // Deletes the session key the SDK keeps, as the store's and
                // the adapter's disconnect do by default, and disconnects the
                // store too (see the adapter's disconnect). The standard
                // method takes no options, so there is no keepSessionKeys here.
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
            // The passkey signs `signedMessageChallenge(message)`, not the
            // message's bytes (see LazorkitWalletAdapter.signMessage). As
            // before, `signature` is the UTF-8 JSON of a SignMessageResult, not
            // a 64-byte Ed25519 signature: the account's address is a program
            // account with no key to sign with. Check it with
            // `verifyWalletMessage`, which reads the passkey's key from chain.
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

    /**
     * Calls the dApp's listeners, each on its own: what one throws is logged,
     * and neither stops the others nor fails the connect or disconnect that
     * raised the event.
     */
    private _emit(event: string, ...args: any[]) {
        for (const listener of [...(this._listeners[event] ?? [])]) {
            try {
                listener(...args);
            } catch (error) {
                console.error(`[LazorKit] A Wallet Standard '${event}' listener threw:`, error);
            }
        }
    }
}
