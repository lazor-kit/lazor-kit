// /src/wallet/modules/disconnect.ts
// Function to disconnect the wallet by clearing stored credentials
/**
 * Disconnects the wallet by removing stored credentials from localStorage.
 * This ensures that the wallet is no longer connected to the application.
 */
export const disconnectWallet = () => {
    localStorage.removeItem('CREDENTIAL_ID'); // Remove the credential ID from localStorage
    localStorage.removeItem('PUBLIC_KEY'); // Remove the public key from localStorage
};
