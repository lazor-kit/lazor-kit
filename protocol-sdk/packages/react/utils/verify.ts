export // convert base64 to bytes
    function base64ToBytes(b64: string): Uint8Array {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

export async function importP256PublicKey(publicKeyBytes: Uint8Array): Promise<CryptoKey> {
    // WebCrypto "raw" format for P-256 usually expects 65 bytes (0x04 + X + Y)
    // If the key is already 65 bytes, use it as is.
    // If it's 64 bytes, prepend 0x04.
    let rawKey = publicKeyBytes;
    if (rawKey.length === 64) {
        const newKey = new Uint8Array(65);
        newKey[0] = 0x04;
        newKey.set(rawKey, 1);
        rawKey = newKey;
    }

    return crypto.subtle.importKey(
        "raw",
        rawKey as any,
        {
            name: "ECDSA",
            namedCurve: "P-256",
        },
        false,
        ["verify"]
    )
}

/**
 * @deprecated Checks only that `signature` is over `signedPayload`, not which
 * message was signed: any assertion the passkey ever made passes. Never
 * use it to authenticate. Use
 * `verifyWalletMessage({ connection, wallet, credentialId, rpId, message, ...result })`,
 * or `verifySignedMessage({ message, publicKey, ...result })` with a key read
 * from the chain.
 */
export async function verifySignatureBrowser({
    signedPayload,
    signature,
    publicKey,
}: {
    signedPayload: string
    signature: string
    publicKey: string
}): Promise<boolean> {
    const payloadBytes = base64ToBytes(signedPayload)
    const signatureBytes = base64ToBytes(signature)
    const publicKeyBytes = base64ToBytes(publicKey)

    const cryptoKey = await importP256PublicKey(publicKeyBytes)

    return crypto.subtle.verify(
        {
            name: "ECDSA",
            hash: "SHA-256",
        },
        cryptoKey,
        signatureBytes as any,
        payloadBytes as any
    )
}
