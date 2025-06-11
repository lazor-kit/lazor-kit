import { 
  browserSupportsWebAuthn
} from '@simplewebauthn/browser';
import { PasskeyStorage } from './PasskeyStorage';
import { Logger } from '../utils';
import { createHash } from '../utils/crypto';
import { secp256r1 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { SECP256R1_SPKI_HEADER } from '../utils/crypto';

export interface ConnectResult {
  publicKey: string;
  credentialId: string;
  isCreated: boolean;
  signature: string;
}

export interface SignResult {
  authenticatorData: string;
  clientDataJSON: string;
  clientDataJSONDigest: string;
  signature: string;
  message: string;
  rawMessage: string;
}

export class PasskeyManager {
  private storage: PasskeyStorage;
  private logger: Logger;
  
  constructor() {
    this.storage = new PasskeyStorage();
    this.logger = new Logger('PasskeyManager');
    
    if (!browserSupportsWebAuthn()) {
      throw new Error('WebAuthn is not supported in this browser');
    }
  }
  
  async connectWithChallenge(origin: string, challenge: Buffer): Promise<ConnectResult> {
    try {
      // Check for existing credential
      const existingCredential = await this.storage.getCredential(origin);
      
      if (existingCredential) {
        // Authenticate with existing credential
        this.logger.info('Using existing credential for origin:', origin);

        const authResult = (await navigator.credentials.get({
          publicKey: {
            challenge: challenge,
            allowCredentials: [{
              id: Buffer.from(existingCredential.credentialId, 'base64'),
              type: 'public-key'
            }],
            userVerification: 'required'
          }
        })) as PublicKeyCredential;

        if (!authResult) throw new Error("No authentication result");

        const assertionResponse = authResult.response as AuthenticatorAssertionResponse;
        const sig = secp256r1.Signature.fromDER(new Uint8Array(assertionResponse.signature))
        const normalized = Buffer.from(sig.normalizeS().toCompactRawBytes()).toString("base64");
        
        return {
          publicKey: existingCredential.publicKey,
          credentialId: existingCredential.credentialId,
          isCreated: false,
          signature: normalized
        };
      }
      
      // Create new credential
      this.logger.info('Creating new credential for origin:', origin);
      
      const registrationResult = ( await navigator.credentials.create({
        publicKey: {
          challenge: challenge,
          rp: {
            name: 'Lazor Wallet',
            id: window.location.hostname
          },
          user: {
            id: Buffer.from(origin),
            name: origin,
            displayName: new URL(origin).hostname
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },  // ES256
            { alg: -257, type: 'public-key' } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            requireResidentKey: false,
            userVerification: 'required'
          },
          attestation: 'none'
        }
      })) as PublicKeyCredential;

      if (!registrationResult) throw new Error("No registration result");

      const response = registrationResult.response as AuthenticatorAttestationResponse;
      const pubkeyBuffer = response.getPublicKey();
      if (!pubkeyBuffer) throw new Error("No public key returned");
      
      const publicKey = new Uint8Array(pubkeyBuffer);
      const pubkeyUncompressed = publicKey.slice(SECP256R1_SPKI_HEADER.length);
      const pubkey = secp256r1.ProjectivePoint.fromHex(pubkeyUncompressed);
      const compressedKey = Buffer.from(pubkey.toRawBytes(true)).toString("base64");
  
      const credentialId = Buffer.from(registrationResult.rawId).toString("base64");

      await this.storage.saveCredential(origin, {
        credentialId: credentialId,
        publicKey: compressedKey,
        createdAt: Date.now()
      });
      
      return {
        publicKey: compressedKey,
        credentialId: credentialId,
        isCreated: true,
        signature: ''
      };
      
    } catch (error: any) {
      this.logger.error('Connect failed:', error);
      
      if (error.name === 'NotAllowedError') {
        throw { code: 'USER_CANCELLED', message: 'User cancelled the operation', step: 'credential_creation' };
      }
      
      throw error;
    }
  }
  
  async signMessage(origin: string, message: Buffer, description?: string): Promise<SignResult> {
    try {
      const credentialId = await this.storage.getCredential(origin);
      
      if (!credentialId) {
        throw { code: 'CREDENTIAL_NOT_FOUND', message: 'No credential found for this origin' };
      }
    
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: message,
          allowCredentials: [{ type: "public-key", id: new Uint8Array(Buffer.from(credentialId.credentialId, "base64")) }],
        },
      })) as PublicKeyCredential;
  
      if (!credential) throw new Error("No credential returned");
  
      const assertionResponse = credential.response as AuthenticatorAssertionResponse;
      const sig = secp256r1.Signature.fromDER(new Uint8Array(assertionResponse.signature))
      const authenticatorData = new Uint8Array(assertionResponse.authenticatorData);
      const clientDataJSON = new Uint8Array(assertionResponse.clientDataJSON);
      const authenticatorDataReturn = Buffer.from(authenticatorData).toString("base64");
      const clientDataJSONReturn = Buffer.from(clientDataJSON).toString("base64");
      const clientDataJSONDigest = sha256(clientDataJSON);
      const msg = Buffer.from(new Uint8Array([...authenticatorData, ...clientDataJSONDigest])).toString("base64");
      const normalized = Buffer.from(sig.normalizeS().toCompactRawBytes()).toString("base64");
      
      return {
        authenticatorData: authenticatorDataReturn,
        clientDataJSON: clientDataJSONReturn,
        clientDataJSONDigest: Buffer.from(clientDataJSONDigest).toString("base64"),
        signature: normalized,
        message: msg,
        rawMessage: Buffer.from(message).toString("base64"),
      };
      
    } catch (error: any) {
      this.logger.error('Sign failed:', error);
      
      if (error.name === 'NotAllowedError') {
        throw { code: 'USER_CANCELLED', message: 'User cancelled the signing operation' };
      }
      
      throw error;
    }
  }
  
  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }
  
}
