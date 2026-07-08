import React, { useState } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { useLazorkit } from '../providers/LazorkitProvider';
import { BiometricButton } from '../components/BiometricButton';

export const LoginScreen: React.FC = () => {
  const { connect, disconnect, publicKey, isConnected } = useLazorkit();
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    setLoading(true);
    try {
      await connect();
      Alert.alert('Success', 'Logged in with Passkey!');
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setLoading(true);
    try {
      await connect();
      Alert.alert('Success', 'Welcome back!');
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await disconnect();
      Alert.alert('Success', 'Logged out');
    } catch (error) {
      console.error(error);
    }
  };

  if (isConnected) {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>Welcome!</Text>

        <View style={styles.infoBox}>
          <Text style={styles.label}>Your Wallet:</Text>
          <Text style={styles.address}>
            {publicKey?.slice(0, 12)}...{publicKey?.slice(-12)}
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Logout"
            onPress={handleLogout}
            color="#FF3B30"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🦞</Text>
      <Text style={styles.title}>Lazorkit Mobile</Text>
      <Text style={styles.subtitle}>
        Passkey-based wallet for Solana
      </Text>

      <View style={styles.buttonContainer}>
        {/* Biometric Login (if available) */}
        <BiometricButton
          onAuthenticate={handleBiometricLogin}
          label="Quick Login"
        />

        {/* Passkey Login */}
        <View style={{ marginTop: 10 }}>
          <Button
            title={loading ? 'Connecting...' : 'Login with Passkey'}
            onPress={handlePasskeyLogin}
            disabled={loading}
          />
        </View>
      </View>

      <Text style={styles.footer}>
        No password required • Gasless transactions
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  logo: {
    fontSize: 60,
    marginBottom: 10,
  },
  emoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginVertical: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 5,
    color: '#333',
  },
  address: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#007AFF',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
  },
  footer: {
    marginTop: 30,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
});
