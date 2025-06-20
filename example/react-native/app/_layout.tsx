import { LazorKitWalletProvider } from '@lazorkit/wallet-mobile-adapter';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <LazorKitWalletProvider
      rpcUrl={process.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
      ipfsUrl='https://portal.lazor.sh'
      paymasterUrl='https://lazorkit-paymaster.onrender.com'
    >
      <Stack>
        <Stack.Screen
          name='index'
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name='(tabs)'
          options={{
            headerShown: false,
          }}
        />
      </Stack>
    </LazorKitWalletProvider>
  );
}
