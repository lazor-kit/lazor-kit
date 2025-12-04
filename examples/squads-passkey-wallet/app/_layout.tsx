import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { MultisigProvider } from '@/store/MultisigContext';
import { LazorKitProvider } from '@lazorkit/wallet-mobile-adapter';

// Polyfill Buffer for Hermes
import { Buffer } from 'buffer';
global.Buffer = Buffer;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LazorKitProvider
        rpcUrl={process.env.EXPO_PUBLIC_SOLANA_RPC_URL!}
        ipfsUrl='https://portal.lazor.sh'
        paymasterUrl='https://kora.devnet.lazorkit.com'
        isDebug={true}
      >
        <MultisigProvider>
          <Stack>
            <Stack.Screen name='(tabs)' options={{ headerShown: false }} />
            <Stack.Screen
              name='index'
              options={{
                headerShown: false,
              }}
            />
          </Stack>
          <StatusBar style='auto' />
        </MultisigProvider>
      </LazorKitProvider>
    </ThemeProvider>
  );
}
