import { Buffer } from 'buffer';
import { generateRandomChallenge, SECP256R1_SPKI_HEADER } from './utils';
import { secp256r1 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

// Types and Interfaces
export interface WalletResult {
  credentialId: string;
  publickey: string;
  status: 'created' | 'existing';
}

export interface CustomWebAuthnOptions {
  authenticatorAttachment?: "platform" | "cross-platform" | undefined;
  userVerification?: "required" | "preferred" | "discouraged";
  residentKey?: "required" | "preferred" | "discouraged";
  timeout?: number;
  attestation?: "none" | "indirect" | "direct" | "enterprise";
}

interface WebAuthnEnvironment {
  isCustomTabs: boolean;
  options: CustomWebAuthnOptions;
}

// Constants
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_CHALLENGE = new Uint8Array([117, 61, 252, 231, 191, 241]);
const CREDENTIAL_STORAGE_KEYS = {
  id: "CREDENTIAL_ID",
  publicKey: "PUBLIC_KEY"
};

// Helper Functions
function getWebAuthnEnvironment(): WebAuthnEnvironment {
  const globalOptions = (window as any).__webauthn_options;
  const isCustomTabs = navigator.userAgent.includes('wv') && 
                      navigator.userAgent.includes('Chrome') &&
                      !(window as any).chrome?.runtime;

  const options = {
    authenticatorAttachment: globalOptions?.authenticatorAttachment ?? "platform",
    userVerification: globalOptions?.userVerification ?? "required",
    residentKey: globalOptions?.residentKey ?? "required",
    timeout: globalOptions?.timeout ?? DEFAULT_TIMEOUT,
    attestation: globalOptions?.attestation ?? "none"
  };

  return { isCustomTabs, options };
}

function buildAuthenticatorSelection(options: CustomWebAuthnOptions): any {
  const selection: any = {
    userVerification: options.userVerification
  };

  if (options.authenticatorAttachment) {
    selection.authenticatorAttachment = options.authenticatorAttachment;
  }

  if (options.residentKey === "required") {
    selection.residentKey = "required";
    selection.requireResidentKey = true;
  } else if (options.residentKey === "preferred") {
    selection.residentKey = "preferred";
    selection.requireResidentKey = false;
  } else {
    selection.residentKey = "discouraged";
    selection.requireResidentKey = false;
  }

  return selection;
}

function processPublicKey(pubkeyBuffer: ArrayBuffer): string {
  const publicKey = new Uint8Array(pubkeyBuffer);
  const pubkeyUncompressed = publicKey.slice(SECP256R1_SPKI_HEADER.length);
  const pubkey = secp256r1.ProjectivePoint.fromHex(pubkeyUncompressed);
  return Buffer.from(pubkey.toRawBytes(true)).toString("base64");
}

function handleWebAuthnError(error: unknown, operation: string, displayStatus: (message: string, type: string) => void): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const { isCustomTabs } = getWebAuthnEnvironment();
  
  console.error(`❌ ${operation} failed:`, {
    error: errorName,
    message: errorMessage,
    environment: isCustomTabs ? 'Custom Tabs' : 'Regular Browser'
  });
  
  displayStatus(`${operation} failed: ${errorMessage}`, "error");
  throw error;
}

// Main WebAuthn Functions
export async function signUp(
  displayStatus: (message: string, type: string) => void
): Promise<WalletResult> {
  try {
    const { isCustomTabs, options } = getWebAuthnEnvironment();
    const authenticatorSelection = buildAuthenticatorSelection(options);
    const userData = generateRandomChallenge();

    displayStatus(
      isCustomTabs ? "Creating passkey for Custom Tabs..." : "Creating passkey...", 
      "loading"
    );

    console.log('🔧 WebAuthn options:', {
      environment: isCustomTabs ? 'Custom Tabs' : 'Regular Browser',
      authenticatorSelection,
      timeout: options.timeout
    });
    console.log(window.location.hostname)
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: DEFAULT_CHALLENGE,
        rp: {
           name: "Passkey Sharing Hub",
           id: window.location.hostname
        },
        user: { id: userData, name: "Passkey Sharing Hub", displayName: "Passkey Sharing Hub" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },  
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",         
          requireResidentKey: true,        
          userVerification: "required"    
        },
        attestation: "none",
        timeout: 60000
      },
    })) as PublicKeyCredential;

    if (!credential) throw new Error("No credential returned");

    const response = credential.response as AuthenticatorAttestationResponse;
    const pubkeyBuffer = response.getPublicKey();
    if (!pubkeyBuffer) throw new Error("No public key returned");
    
    const compressedKey = processPublicKey(pubkeyBuffer);
    const credentialId = Buffer.from(credential.rawId).toString("base64");
   
    displayStatus("Account created successfully!", "success");
    console.log('✅ Passkey created successfully:', {
      credentialId: credentialId.substring(0, 16) + '...',
      environment: isCustomTabs ? 'Custom Tabs' : 'Regular Browser',
      authenticatorAttachment: options.authenticatorAttachment,
      userVerification: options.userVerification
    });
    
    return { credentialId, publickey: compressedKey, status: "created" };
    
  } catch (error) {
    return handleWebAuthnError(error, "Passkey creation", displayStatus);
  }
}

export async function authenticateWithPasskey(
  displayStatus: (message: string, type: string) => void
): Promise<{ publickey: string; credentialId: string }> {
  try {
    const credentialId = localStorage.getItem(CREDENTIAL_STORAGE_KEYS.id);
    const publickey = localStorage.getItem(CREDENTIAL_STORAGE_KEYS.publicKey);

    if (!credentialId || !publickey) {
      throw new Error("No stored credentials found. Please create a passkey first.");
    }
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: DEFAULT_CHALLENGE,
        allowCredentials: [{
          type: "public-key",
          id: new Uint8Array(Buffer.from(credentialId, "base64"))
        }],
      },
    })) as PublicKeyCredential;
    const response = credential.response as AuthenticatorAssertionResponse;
    console.log(response)
    displayStatus("Wallet connected successfully!", "success");
    return { publickey, credentialId };

  } catch (error) {
    return handleWebAuthnError(error, "Authentication", displayStatus);
  }
}

export async function signMessage(
  credentialId: string,
  message: string,
  displayStatus: (message: string, type: string) => void
): Promise<{
  normalized: string;
  msg: string;
  clientDataJSONReturn: string;
  authenticatorDataReturn: string;
}> {
  try {
    const challenge = Buffer.from(message, "base64");
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          type: "public-key",
          id: new Uint8Array(Buffer.from(credentialId, "base64"))
        }],
      },
    })) as PublicKeyCredential;

    if (!credential) throw new Error("No credential returned");

    const assertionResponse = credential.response as AuthenticatorAssertionResponse;
    const sig = secp256r1.Signature.fromDER(new Uint8Array(assertionResponse.signature));
    const authenticatorData = new Uint8Array(assertionResponse.authenticatorData);
    const clientDataJSON = new Uint8Array(assertionResponse.clientDataJSON);
    
    const authenticatorDataReturn = Buffer.from(authenticatorData).toString("base64");
    const clientDataJSONReturn = Buffer.from(clientDataJSON).toString("base64");
    const clientDataJSONDigest = sha256(clientDataJSON);
    const msg = Buffer.from(
      new Uint8Array([...authenticatorData, ...clientDataJSONDigest])
    ).toString("base64");
    
    const normalized = Buffer.from(
      sig.normalizeS().toCompactRawBytes()
    ).toString("base64");

    displayStatus("Message signed successfully", "success");
    return { normalized, msg, clientDataJSONReturn, authenticatorDataReturn };

  } catch (error) {
    return handleWebAuthnError(error, "Message signing", displayStatus);
  }
}

export async function signIn(
  displayStatus: (message: string, type: string) => void
): Promise<{ credentialId: string }> {
  try {
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: DEFAULT_CHALLENGE,
        userVerification: "required",
        timeout: DEFAULT_TIMEOUT
      }
    })) as PublicKeyCredential;
    
    if (!credential) throw new Error("No key returned");
    const credentialId = Buffer.from(credential.rawId).toString("base64");
    localStorage.setItem(CREDENTIAL_STORAGE_KEYS.id, credentialId);
    return { credentialId };
    
  } catch (error) {
    return handleWebAuthnError(error, "Passkey creation", displayStatus);
  }
}