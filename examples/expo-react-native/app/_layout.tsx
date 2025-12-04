import { LazorKitProvider } from '@lazorkit/wallet-mobile-adapter';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <LazorKitProvider
      rpcUrl={process.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
      ipfsUrl={rocess.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
      paymasterUrl={rocess.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
      isDebug={true}
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
    </LazorKitProvider>
  );
}
