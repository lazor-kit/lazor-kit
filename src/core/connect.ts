// Import utility functions and dependencies
import { getSmartWalletPdaByCreator } from './getAddress'; // Retrieves the PDA (Program Derived Address) for a smart wallet
import { delay } from './delay'; // Utility function to introduce a delay
import { createSmartWalletTransaction } from './createSmartWallet'; // Function to create a smart wallet transaction

/**
 * Connects to a wallet using a popup window and establishes a connection.
 * @param {string} WALLET_CONNECT_URL - The URL to initiate the wallet connection.
 * @param {any} connection - The Solana connection object.
 * @returns {Promise<{smartWalletPubkey: string, credentialId: string, publicKey: string}>} - Resolves with wallet details.
 */
export const connectWallet = (WALLET_CONNECT_URL: string, connection: any): Promise<{
  smartWalletPubkey: string;
  credentialId: string;
  publicKey: string;
}> => {
  return new Promise((resolve, reject) => {
    // Open a popup window for wallet connection
    const popup = window.open(WALLET_CONNECT_URL, 'WalletAction', 'width=600,height=400');

    if (!popup) {
      return reject(new Error('Failed to open the popup window. Please check popup blockers.'));
    }

    let resolved = false; // Tracks whether the connection was resolved

    // Cleanup function to remove event listeners and close the popup
    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(popupCheckInterval);
      clearTimeout(timeoutId);
      if (popup && !popup.closed) popup.close();
    };

    // Event listener to handle messages from the popup
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'WALLET_CONNECTED') {
        try {
          const { credentialId, publickey } = event.data.data;

          // Store wallet credentials in localStorage
          localStorage.setItem('CREDENTIAL_ID', credentialId);
          localStorage.setItem('PUBLIC_KEY', publickey);

          // Create a smart wallet transaction
          await createSmartWalletTransaction({
            secp256k1PubkeyBytes: Array.from(Buffer.from(publickey, 'base64')),
            connection,
          });

          await delay(2); // Introduce a delay for processing

          // Retrieve the smart wallet PDA
          const smartWalletPubkey = await getSmartWalletPdaByCreator(
            connection,
            Array.from(Buffer.from(publickey, 'base64'))
          );

          await delay(10); // Additional delay for stability

          resolved = true;
          cleanup();
          resolve({ smartWalletPubkey, credentialId, publicKey: publickey });
        } catch (err) {
          cleanup();
          reject(err);
        }
      } else if (event.data.type === 'WALLET_ERROR') {
        cleanup();
        reject(new Error(event.data.error));
      }
    };

    // Add the event listener for messages
    window.addEventListener('message', handleMessage);

    // Interval to check if the popup is closed
    const popupCheckInterval = setInterval(() => {
      if (popup.closed && !resolved) {
        cleanup();
        reject(new Error('Popup closed before completing connection.'));
      }
    }, 500);

    // Timeout to reject the connection if it takes too long
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error('Wallet connection timed out.'));
      }
    }, 90000); // 90 seconds timeout
  });
};
