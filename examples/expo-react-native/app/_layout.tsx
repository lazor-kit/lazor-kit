import { LazorKitProvider } from '@lazorkit/wallet-mobile-adapter';
import { Stack } from 'expo-router';

const RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL;
const PORTAL_URL = process.env.EXPO_PUBLIC_PORTAL_URL;
const PAYMASTER_URL = process.env.EXPO_PUBLIC_PAYMASTER_URL;

export default function RootLayout() {
  return (
    <LazorKitProvider
      {...(RPC_URL ? { rpcUrl: RPC_URL } : {})}
      {...(PORTAL_URL ? { portalUrl: PORTAL_URL } : {})}
      {...(PAYMASTER_URL ? { configPaymaster: { paymasterUrl: PAYMASTER_URL } } : {})}
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
