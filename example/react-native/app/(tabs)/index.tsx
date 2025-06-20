'use client';

import { Ionicons } from '@expo/vector-icons';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLazorWallet } from '@lazorkit/wallet-mobile-adapter';

export default function WalletScreen() {
  const [solBalance, setSolBalance] = useState(0);

  const { smartWalletPubkey, disconnect } = useLazorWallet();

  useEffect(() => {
    if (!smartWalletPubkey) return;

    const connection = new Connection(
      process.env.EXPO_PUBLIC_SOLANA_RPC_URL!,
      'confirmed'
    );

    const fetchBalance = async () => {
      try {
        const balance = await connection.getBalance(
          new PublicKey(smartWalletPubkey)
        );
        console.log(smartWalletPubkey);

        console.log(balance);

        setSolBalance(balance / LAMPORTS_PER_SOL);
      } catch (error) {
        console.error('Error fetching balance:', error);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 5000); // fetch every 5 seconds

    return () => clearInterval(interval);
  }, [smartWalletPubkey]);

  const copyToClipboard = async () => {
    if (smartWalletPubkey) {
      await Clipboard.setStringAsync(smartWalletPubkey.toString());
      // Custom success notification
      Alert.alert(
        '✅ Copied!',
        'Wallet address copied to clipboard',
        [{ text: 'OK', style: 'default' }],
        {
          cancelable: true,
        }
      );
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleDeposit = () => {
    Alert.alert(
      '💰 Deposit Tokens',
      'Send tokens to your wallet address to deposit them.',
      [{ text: 'Got it', style: 'default' }]
    );
  };

  const handleScanQR = () => {
    Alert.alert(
      '📱 QR Scanner',
      'QR code scanner would be implemented here to scan wallet addresses.',
      [{ text: 'OK', style: 'default' }]
    );
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header with Logo, Address and Disconnect */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/images/logo.jpg')}
              style={styles.headerLogo}
            />
            <Text style={styles.headerTitle}>Lazor Wallet</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.addressPill}
              onPress={copyToClipboard}
            >
              <Text style={styles.addressPillText}>
                {formatAddress(smartWalletPubkey?.toString() || '')}
              </Text>
              <Ionicons name='copy-outline' size={16} color='#6366f1' />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={handleDisconnect}
            >
              <Ionicons name='power-outline' size={18} color='#ef4444' />
            </TouchableOpacity>
          </View>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>SOL Balance</Text>
          <Text style={styles.balanceAmount}>{solBalance.toFixed(4)} SOL</Text>
          <Text style={styles.balanceUsd}>
            ≈ ${(solBalance * 98.45).toFixed(2)} USD
          </Text>
        </View>

        {/* Wallet Address */}
        <View style={styles.addressCard}>
          <Text style={styles.addressLabel}>Your Wallet Address</Text>
          <View style={styles.addressContainer}>
            <Text style={styles.addressText}>
              {formatAddress(smartWalletPubkey?.toString() || '')}
            </Text>
            <TouchableOpacity
              onPress={copyToClipboard}
              style={styles.copyButton}
            >
              <Ionicons name='copy-outline' size={20} color='#6366f1' />
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleDeposit}>
            <Ionicons name='add-circle-outline' size={24} color='#fff' />
            <Text style={styles.actionButtonText}>Deposit Tokens</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleScanQR}>
            <Ionicons name='qr-code-outline' size={24} color='#fff' />
            <Text style={styles.actionButtonText}>Scan QR Code</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Transactions */}
        <View style={styles.transactionsCard}>
          <Text style={styles.transactionsTitle}>Recent Transactions</Text>
          <View style={styles.transactionItem}>
            <View style={styles.transactionIcon}>
              <Ionicons name='arrow-up-outline' size={20} color='#ef4444' />
            </View>
            <View style={styles.transactionDetails}>
              <Text style={styles.transactionType}>Sent SOL</Text>
              <Text style={styles.transactionDate}>2 hours ago</Text>
            </View>
            <Text style={styles.transactionAmount}>-2.5 SOL</Text>
          </View>

          <View style={styles.transactionItem}>
            <View style={styles.transactionIcon}>
              <Ionicons name='arrow-down-outline' size={20} color='#10b981' />
            </View>
            <View style={styles.transactionDetails}>
              <Text style={styles.transactionType}>Received SOL</Text>
              <Text style={styles.transactionDate}>1 day ago</Text>
            </View>
            <Text style={styles.transactionAmount}>+5.0 SOL</Text>
          </View>

          <View style={styles.transactionItem}>
            <View style={styles.transactionIcon}>
              <Ionicons name='arrow-up-outline' size={20} color='#ef4444' />
            </View>
            <View style={styles.transactionDetails}>
              <Text style={styles.transactionType}>Sent USDC</Text>
              <Text style={styles.transactionDate}>3 days ago</Text>
            </View>
            <Text style={styles.transactionAmount}>-150.0 USDC</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  addressPillText: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  disconnectButton: {
    backgroundColor: '#fef2f2',
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  balanceCard: {
    backgroundColor: '#6366f1',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    color: '#e0e7ff',
    fontSize: 16,
    marginBottom: 8,
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  balanceUsd: {
    color: '#e0e7ff',
    fontSize: 16,
  },
  addressCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addressLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addressText: {
    fontSize: 16,
    fontFamily: 'monospace',
    color: '#1e293b',
  },
  copyButton: {
    padding: 8,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  transactionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  transactionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 16,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  transactionDetails: {
    flex: 1,
  },
  transactionType: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1e293b',
  },
  transactionDate: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
});
