export interface Credential {
    credentialId: string;
    publicKey: string;
  }
  
export function getStoredCredentials(): Credential[] {
    const credentialId = localStorage.getItem("CREDENTIAL_ID");
    const publicKey = localStorage.getItem("PUBLIC_KEY");
    return credentialId && publicKey ? [{ credentialId, publicKey }] : [];
}
  
export function saveCredential(credentialId: string, publicKey: string): void {
    localStorage.setItem("CREDENTIAL_ID", credentialId);
    localStorage.setItem("PUBLIC_KEY", publicKey);
    localStorage.setItem("WALLET_STATUS", "TRUE");
}