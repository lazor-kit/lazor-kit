// /src/wallet/modules/disconnect.ts
export const disconnectWallet = () => {
    localStorage.removeItem('CREDENTIAL_ID');
    localStorage.removeItem('PUBLIC_KEY');
};
  