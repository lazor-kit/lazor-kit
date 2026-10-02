/**
 * The keys the SDK signs session and authority transactions with. A signer
 * signs in place: no secret is handed out.
 */
import { Buffer } from 'buffer';
import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { type Sealed, signEd25519, unseal } from './webcrypto';

export interface KeySigner {
    readonly publicKey: PublicKey;
    /**
     * Adds this key's signature to `tx`, whose message lists the key as a
     * signer, as `tx.partialSign` (legacy) or `tx.sign` (v0) would.
     */
    signTransaction(tx: Transaction | VersionedTransaction): Promise<void>;
}

function isLegacy(tx: Transaction | VersionedTransaction): tx is Transaction {
    return typeof (tx as Transaction).serializeMessage === 'function';
}

/**
 * A non-extractable WebCrypto Ed25519 key. It signs the bytes web3.js signs
 * (`serializeMessage()` / `message.serialize()`), so where WebCrypto signs
 * deterministically the signature is byte for byte the one a `Keypair` with
 * the same seed makes.
 */
export function cryptoKeySigner(publicKey: PublicKey, privateKey: CryptoKey): KeySigner {
    return {
        publicKey,
        async signTransaction(tx) {
            if (isLegacy(tx)) {
                tx.addSignature(publicKey, Buffer.from(await signEd25519(privateKey, tx.serializeMessage())));
            } else {
                tx.addSignature(publicKey, await signEd25519(privateKey, tx.message.serialize()));
            }
        },
    };
}

/** A key held in this page's memory only (no WebCrypto Ed25519, or nowhere to keep it). */
export function keypairSigner(keypair: Keypair): KeySigner {
    return {
        publicKey: keypair.publicKey,
        async signTransaction(tx) {
            signWithKeypair(tx, keypair);
        },
    };
}

/**
 * A seed kept sealed under a non-extractable AES-GCM key (browsers without
 * WebCrypto Ed25519). It is opened for each signature, and its bytes wiped
 * after.
 */
export function sealedSigner(publicKey: PublicKey, wrapKey: CryptoKey, sealed: Sealed, context: string): KeySigner {
    return {
        publicKey,
        async signTransaction(tx) {
            const seed = await unseal(wrapKey, sealed, context);
            try {
                const keypair = Keypair.fromSeed(seed);
                if (!keypair.publicKey.equals(publicKey)) throw new Error('The stored key does not match its public key');
                signWithKeypair(tx, keypair);
            } finally {
                seed.fill(0);
            }
        },
    };
}

function signWithKeypair(tx: Transaction | VersionedTransaction, keypair: Keypair): void {
    if (isLegacy(tx)) tx.partialSign(keypair);
    else tx.sign([keypair]);
}
