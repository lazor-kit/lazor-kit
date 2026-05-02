// Bytes for the SECP256R1 Subject Public Key Info (SPKI) header
export const SECP256R1_SPKI_HEADER: Uint8Array = new Uint8Array([
    // Main SEQUENCE (entire SPKI), length 89 bytes
    0x30, // Tag: SEQUENCE
    0x59, // Length: 89 bytes
  
    // Sub SEQUENCE (algorithm identifier), length 19 bytes
    0x30, // Tag: SEQUENCE
    0x13, // Length: 19 bytes
  
    // OID for ecPublicKey (1.2.840.10045.2.1), length 7 bytes
    0x06, // Tag: OID
    0x07, // Length: 7 bytes
    0x2a, // 1.2
    0x86, // .840
    0x48, // .10045
    0xce, // .2
    0x3d, // .1
    0x02, // (remaining part of OID)
    0x01, // ecPublicKey
  
    // OID for prime256v1/secp256r1 (1.2.840.10045.3.1.7), length 8 bytes
    0x06, // Tag: OID
    0x08, // Length: 8 bytes
    0x2a, // 1.2
    0x86, // .840
    0x48, // .10045
    0xce, // .3
    0x3d, // .1
    0x03, // .7
    0x01, // (remaining part of OID)
    0x07, // prime256v1
  
    // BIT STRING containing the public key, length 66 bytes (1-byte padding + 65-byte key)
    0x03, // Tag: BIT STRING
    0x42, // Length: 66 bytes
    0x00, // Unused bits: 0
]);

// This function generates a random challenge for WebAuthn operations
export function generateRandomChallenge(): Uint8Array {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return array;
}

