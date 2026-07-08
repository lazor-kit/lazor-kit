import React, { createContext, useContext, ReactNode } from 'react';
import {
  LazorKitProvider as LazorKitProviderSDK,
  useWallet as useLazorWallet,
} from '@lazorkit/wallet-mobile-adapter';

interface LazorkitContextType {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  signAndSendTransaction: (instructions: any[]) => Promise<string>;
}

const LazorkitContext = createContext<LazorkitContextType>({} as LazorkitContextType);

interface LazorkitProviderProps {
  children: ReactNode;
}

// Inner component that uses the SDK hook
const WalletContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction,
    isConnected,
    isLoading,
    smartWalletPubkey,
  } = useLazorWallet();

  const handleConnect = async () => {
    try {
      await connect({ redirectUrl: 'lazorkitmobile://callback' });
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect:', error);
      throw error;
    }
  };

  const handleSignMessage = async (message: string): Promise<string> => {
    try {
      const result = await signMessage(message, {
        redirectUrl: 'lazorkitmobile://callback',
      });
      return result.signature;
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw error;
    }
  };

  const handleTransaction = async (instructions: any[]): Promise<string> => {
    try {
      return await signAndSendTransaction(
        {
          instructions,
          transactionOptions: {
            clusterSimulation: 'devnet',
          },
        },
        { redirectUrl: 'lazorkitmobile://callback' }
      );
    } catch (error) {
      console.error('Failed to send transaction:', error);
      throw error;
    }
  };

  return (
    <LazorkitContext.Provider
      value={{
        publicKey: smartWalletPubkey?.toBase58() || null,
        isConnected,
        isLoading,
        connect: handleConnect,
        disconnect: handleDisconnect,
        signMessage: handleSignMessage,
        signAndSendTransaction: handleTransaction,
      }}
    >
      {children}
    </LazorkitContext.Provider>
  );
};

export const LazorkitProvider: React.FC<LazorkitProviderProps> = ({ children }) => {
  return (
    <LazorKitProviderSDK
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazor.sh"
      configPaymaster={{
        paymasterUrl: 'https://lazorkit-paymaster.onrender.com',
      }}
    >
      <WalletContextProvider>{children}</WalletContextProvider>
    </LazorKitProviderSDK>
  );
};

export const useLazorkit = () => {
  const context = useContext(LazorkitContext);
  if (!context) {
    throw new Error('useLazorkit must be used within LazorkitProvider');
  }
  return context;
};
