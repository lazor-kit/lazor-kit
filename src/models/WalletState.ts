/**
 * Interface representing the state of a wallet
 */
export interface WalletState {
  credentialId: string | null;
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  smartWalletAuthorityPubkey: string | null;
}
