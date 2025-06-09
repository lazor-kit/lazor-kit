import { 
  startAuthentication,
  startRegistration,
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
  nonce: string;
  timestamp: number;
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
        const signature = Buffer.from(assertionResponse.signature).toString("base64");
        const authenticatorData = Buffer.from(assertionResponse.authenticatorData).toString("base64");
        const clientDataJSON = Buffer.from(assertionResponse.clientDataJSON).toString("base64");
        const clientDataJSONDigest = createHash(Buffer.from(clientDataJSON));
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
     
      
      // const registrationResult = await startRegistration({
      //   challenge: challenge.toString('base64'),
      //   rp: {
      //     name: 'Lazor Wallet',
      //     id: window.location.hostname
      //   },
      //   user: {
      //     id: Buffer.from(origin).toString('base64'),
      //     name: origin,
      //     displayName: new URL(origin).hostname
      //   },
      //   pubKeyCredParams: [
      //     { alg: -7, type: 'public-key' },  // ES256
      //     { alg: -257, type: 'public-key' } // RS256
      //   ],
      //   authenticatorSelection: {
      //     authenticatorAttachment: 'platform',
      //     requireResidentKey: false,
      //     userVerification: 'required'
      //   },
      //   attestation: 'none'
      // });

      // // Extract public key from registration
      // const publicKey = this.extractPublicKey(registrationResult);
      // Save credential
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
      const credential = await this.storage.getCredential(origin);
      
      if (!credential) {
        throw { code: 'CREDENTIAL_NOT_FOUND', message: 'No credential found for this origin' };
      }
      
      // Generate nonce
      const nonce = this.generateNonce();
      const timestamp = Date.now();
      
      // Create challenge from message
      const challenge = Buffer.concat([
        message,
        Buffer.from(nonce, 'hex'),
        Buffer.from(timestamp.toString())
      ]);
      
      // Authenticate and sign
      const authResult = await startAuthentication({
        challenge: challenge.toString('base64'),
        allowCredentials: [{
          id: credential.credentialId,
          type: 'public-key'
        }],
        userVerification: 'required'
      });
      
      // Calculate client data JSON digest
      const clientDataJSON = Buffer.from(authResult.response.clientDataJSON, 'base64');
      const clientDataJSONDigest = createHash(clientDataJSON);
      
      return {
        authenticatorData: authResult.response.authenticatorData,
        clientDataJSON: authResult.response.clientDataJSON,
        clientDataJSONDigest: clientDataJSONDigest.toString('base64'),
        signature: authResult.response.signature,
        nonce,
        timestamp
      };
      
    } catch (error: any) {
      this.logger.error('Sign failed:', error);
      
      if (error.name === 'NotAllowedError') {
        throw { code: 'USER_CANCELLED', message: 'User cancelled the signing operation' };
      }
      
      throw error;
    }
  }
  
  private extractPublicKey(registration: any): string {
    // Extract public key from authenticator data
    // This is simplified - in production, properly parse the CBOR data
    const publicKeyBytes = registration.response.publicKey;
    return Buffer.from(publicKeyBytes).toString('base64');
  }
  
  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
  }
  
}