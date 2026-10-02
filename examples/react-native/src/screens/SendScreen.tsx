import React, { useState } from 'react';
import {
  View,
  Text,
  Button,
  TextInput,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useLazorkit } from '../providers/LazorkitProvider';
import { NATIVE_MINT } from '@solana/spl-token';

export const SendScreen: React.FC = () => {
  const { publicKey, isConnected, signAndSendTransaction } = useLazorkit();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTransfer = async () => {
    if (!recipient || !amount) {
      Alert.alert('Error', 'Please enter recipient and amount');
      return;
    }

    setLoading(true);
    try {
      // Create SOL transfer instruction
      const recipientPubkey = new PublicKey(recipient);
      const senderPubkey = new PublicKey(publicKey!);
      const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

      const transferInstruction = SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: recipientPubkey,
        lamports,
      });

      // Send gasless transaction via Lazorkit
      const signature = await signAndSendTransaction([transferInstruction]);

      Alert.alert('Success', `Transfer complete!\nSignature: ${signature.slice(0, 20)}...`);
      setRecipient('');
      setAmount('');
    } catch (error) {
      console.error('Transfer failed:', error);
      Alert.alert('Error', 'Transfer failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Please login first</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollView}>
      <View style={styles.container}>
        <Text style={styles.title}>Send SOL</Text>

        <Text style={styles.subtitle}>
          No gas fees required! Powered by Lazorkit.
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.label}>Your Wallet:</Text>
          <Text style={styles.address}>
            {publicKey?.slice(0, 12)}...{publicKey?.slice(-12)}
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Recipient Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Solana address"
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Amount (SOL)</Text>
          <TextInput
            style={styles.input}
            placeholder="0.001"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? 'Sending...' : 'Send (Gasless)'}
            onPress={handleTransfer}
            disabled={loading || !recipient || !amount}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
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
  inputGroup: {
    marginBottom: 15,
  },
  input: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  buttonContainer: {
    marginTop: 10,
  },
});
