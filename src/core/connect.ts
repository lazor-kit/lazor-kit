import { getSmartWalletPdaByCreator } from './getAddress';
import { delay } from './delay';
import { createSmartWalletTransaction } from './createSmartWallet'

export const connectWallet = (WALLET_CONNECT_URL: string, connection: any): Promise<{
    smartWalletPubkey: string;
    credentialId: string;
    publicKey: string;
  }> => {
    return new Promise((resolve, reject) => {
      const popup = window.open(WALLET_CONNECT_URL, 'WalletAction', 'width=600,height=400');
  
      if (!popup) {
        return reject(new Error('Failed to open the popup window. Please check popup blockers.'));
      }
  
      let resolved = false;
  
      const cleanup = () => {
        window.removeEventListener('message', handleMessage);
        clearInterval(popupCheckInterval);
        clearTimeout(timeoutId);
        if (popup && !popup.closed) popup.close();
      };
  
      const handleMessage = async (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'object') return;
  
        if (event.data.type === 'WALLET_CONNECTED') {
          try {
            const { credentialId, publickey } = event.data.data;
  
            localStorage.setItem('CREDENTIAL_ID', credentialId);
            localStorage.setItem('PUBLIC_KEY', publickey);
  
            await createSmartWalletTransaction({
              secp256k1PubkeyBytes: Array.from(Buffer.from(publickey, 'base64')),
              connection,
            });
  
            await delay(2);
            const smartWalletPubkey = await getSmartWalletPdaByCreator(
              connection,
              Array.from(Buffer.from(publickey, 'base64'))
            );
            await delay(10);
  
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
  
      window.addEventListener('message', handleMessage);
  
      const popupCheckInterval = setInterval(() => {
        if (popup.closed && !resolved) {
          cleanup();
          reject(new Error('Popup closed before completing connection.'));
        }
      }, 500);
  
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error('Wallet connection timed out.'));
        }
      }, 90000);
    });
  };
  