'use client';

import { Ionicons } from '@expo/vector-icons';
import { SmartWalletAction, SmartWalletActionArgs, useLazorWallet } from '@lazorkit/wallet-mobile-adapter';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface Token {
  symbol: string;
  name: string;
  balance: number;
  icon: string;
  color: string;
}

export default function TransferScreen() {
  // Initialize wallet hook
  const { smartWalletPubkey, isConnected, signMessage } = useLazorWallet();

  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  useEffect(() => {
    if (!smartWalletPubkey) return;

    const connection = new Connection(
      process.env.EXPO_PUBLIC_SOLANA_RPC_URL!,
      'confirmed'
    );

    const fetchBalance = async () => {
      try {
        const balance = await connection.getBalance(smartWalletPubkey);
        setFromToken({ ...fromToken, balance: balance / LAMPORTS_PER_SOL });
      } catch (error) {
        console.error('Error fetching balance:', error);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 5000); // fetch every 5 seconds

    return () => clearInterval(interval);
  }, [smartWalletPubkey, isLoadingBalance]);

  const [fromToken, setFromToken] = useState<Token>({
    symbol: 'SOL',
    name: 'Solana',
    balance: 0.0,
    icon: 'logo-bitcoin',
    color: '#9945ff',
  });

  const [toAddress, setToAddress] = useState(
    'hij78MKbJSSs15qvkHWTDCtnmba2c1W4r1V22g5sD8w'
  );
  const [amount, setAmount] = useState('');
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);

  // Transaction result states
  const [showTransactionResult, setShowTransactionResult] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const tokens: Token[] = [
    {
      symbol: 'SOL',
      name: 'Solana',
      balance: 12.5847,
      icon: 'logo-bitcoin',
      color: '#9945ff',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      balance: 250.0,
      icon: 'card-outline',
      color: '#2775ca',
    },
    {
      symbol: 'RAY',
      name: 'Raydium',
      balance: 45.32,
      icon: 'flash-outline',
      color: '#c93aed',
    },
    {
      symbol: 'BONK',
      name: 'Bonk',
      balance: 1000000,
      icon: 'paw-outline',
      color: '#f97316',
    },
    {
      symbol: 'JUP',
      name: 'Jupiter',
      balance: 125.5,
      icon: 'planet-outline',
      color: '#10b981',
    },
  ];

  const handleTokenSelect = (token: Token) => {
    setFromToken(token);
    setShowTokenDropdown(false);
  };

  const handleScanQR = () => {
    Alert.alert(
      '📱 QR Scanner',
      'QR code scanner would open here to scan recipient addresses.',
      [{ text: 'OK', style: 'default' }]
    );
  };

  const handleMaxAmount = () => {
    setAmount(fromToken.balance.toString());
  };

  // Helper function to copy transaction hash to clipboard
  const copyTransactionHash = async () => {
    if (transactionHash) {
      await Clipboard.setStringAsync(transactionHash);
      Alert.alert('✅ Copied!', 'Transaction hash copied to clipboard', [
        { text: 'OK', style: 'default' },
      ]);
    }
  };

  // Helper function to open transaction in Solana Explorer
  const viewInExplorer = () => {
    if (transactionHash) {
      const explorerUrl = `https://explorer.solana.com/tx/${transactionHash}?cluster=devnet`;
      console.log('Opening explorer:', explorerUrl);
      Linking.openURL(explorerUrl);
    }
  };

  // Helper function to create transfer instruction
  const createTransferInstruction = (toAddress: string, amount: number) => {
    if (!smartWalletPubkey) {
      throw new Error('Wallet not connected');
    }

    const fromPubkey = new PublicKey(smartWalletPubkey);
    const toPubkey = new PublicKey(toAddress);

    return SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: amount * LAMPORTS_PER_SOL,
    });
  };

  const handleSend = async () => {
    if (!isConnected || !smartWalletPubkey) {
      Alert.alert(
        '⚠️ Wallet Not Connected',
        'Please connect your wallet first.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }

    if (!toAddress || !amount) {
      Alert.alert(
        '⚠️ Missing Information',
        'Please fill in all required fields to continue.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    // 0,009 => 0.009
    const sendAmount = Number.parseFloat(amount.replace(',', '.'));

    if (sendAmount > fromToken.balance) {
      Alert.alert(
        '❌ Insufficient Balance',
        `You don't have enough ${fromToken.symbol}. Available: ${fromToken.balance}`,
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }

    // Validate Solana address
    try {
      new PublicKey(toAddress);
    } catch (error) {
      Alert.alert(
        '❌ Invalid Address',
        'Please enter a valid Solana wallet address.',
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }

    Alert.alert(
      '🚀 Confirm Transaction',
      `Send ${amount} ${fromToken.symbol} to ${toAddress.slice(
        0,
        6
      )}...${toAddress.slice(-6)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'default',
          onPress: async () => {
            try {
              // Show loading state
              setIsLoading(true);

              // Create transfer instruction
              const transferInstruction = createTransferInstruction(
                toAddress,
                sendAmount
              );

              // Create Smart Wallet Action 
              const action: SmartWalletActionArgs<SmartWalletAction.CreateChunk> = {
                type: SmartWalletAction.CreateChunk,
                args: {
                  policyInstruction: null, // Optional policy instruction
                  cpiInstructions: [transferInstruction], // Your transaction instruction
                  expiresAt: (Date.now() + 60 * 60 * 1000), // 1 hour
                }
              };

              // Sign message and execute transaction
              await signMessage(action, {
                onSuccess: (result) => {
                  console.log('Transaction signed successfully:', result);
                  setTransactionHash(result);
                  setShowTransactionResult(true);
                },
                onFail: (error) => {
                  throw new Error(
                    `Failed to sign transaction: ${error.message}`
                  );
                },
                redirectUrl: 'exp://localhost:8081',
              });
            } catch (error) {
              console.error('Transaction error:', error);
              Alert.alert(
                '❌ Transaction Error',
                error instanceof Error
                  ? error.message
                  : 'An unknown error occurred.',
                [{ text: 'OK', style: 'default' }]
              );
            } finally {
              setIsLoading(false);
              setIsLoadingBalance(!isLoadingBalance); // Toggle loading state
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* From Token Selection */}
        <View style={styles.card}>
          <Text style={styles.label}>From Token</Text>
          <TouchableOpacity
            style={styles.tokenSelector}
            onPress={() => setShowTokenDropdown(true)}
          >
            <View style={styles.tokenInfo}>
              <View
                style={[
                  styles.tokenIconContainer,
                  { backgroundColor: fromToken.color },
                ]}
              >
                <Ionicons name={fromToken.icon as any} size={20} color='#fff' />
              </View>
              <View style={styles.tokenDetails}>
                <Text style={styles.tokenSymbol}>{fromToken.symbol}</Text>
                <Text style={styles.tokenName}>{fromToken.name}</Text>
              </View>
            </View>
            <View style={styles.tokenBalance}>
              <Text style={styles.balanceText}>{fromToken.balance}</Text>
              <Ionicons name='chevron-down-outline' size={20} color='#64748b' />
            </View>
          </TouchableOpacity>
        </View>

        {/* To Address */}
        <View style={styles.card}>
          <View style={styles.labelContainer}>
            <Text style={styles.label}>To Address</Text>
            <TouchableOpacity onPress={handleScanQR} style={styles.scanButton}>
              <Ionicons name='qr-code-outline' size={20} color='#6366f1' />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder='Enter recipient wallet address'
            placeholderTextColor='#d1d5db'
            value={toAddress}
            onChangeText={setToAddress}
            multiline
            numberOfLines={2}
          />
        </View>

        {/* Amount */}
        <View style={styles.card}>
          <View style={styles.labelContainer}>
            <Text style={styles.label}>Amount</Text>
            <TouchableOpacity
              onPress={handleMaxAmount}
              style={styles.maxButton}
            >
              <Text style={styles.maxButtonText}>MAX</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.amountContainer}>
            <TextInput
              style={styles.amountInput}
              placeholder='0.00'
              placeholderTextColor='#d1d5db'
              value={amount}
              onChangeText={setAmount}
              keyboardType='numeric'
            />
            <Text style={styles.tokenSymbolText}>{fromToken.symbol}</Text>
          </View>
          <Text style={styles.balanceInfo}>
            Available: {fromToken.balance} {fromToken.symbol}
          </Text>
        </View>

        {/* Transaction Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Transaction Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Amount</Text>
            <Text style={styles.summaryValue}>
              {amount || '0'} {fromToken.symbol}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Network Fee</Text>
            <Text style={styles.summaryValue}>0.000005 SOL</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryTotal]}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {(Number.parseFloat(amount || '0') + 0.000005).toFixed(6)}{' '}
              {fromToken.symbol}
            </Text>
          </View>
        </View>

        {/* Send Button */}
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Ionicons name='send-outline' size={20} color='#fff' />
          <Text style={styles.sendButtonText}>Send Transaction</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Token Dropdown Modal */}
      <Modal visible={showTokenDropdown} transparent animationType='slide'>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Token</Text>
              <TouchableOpacity onPress={() => setShowTokenDropdown(false)}>
                <Ionicons name='close-outline' size={24} color='#64748b' />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.tokenList}>
              {tokens.map((token, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.tokenOption,
                    fromToken.symbol === token.symbol && styles.selectedToken,
                  ]}
                  onPress={() => handleTokenSelect(token)}
                >
                  <View style={styles.tokenInfo}>
                    <View
                      style={[
                        styles.tokenIconContainer,
                        { backgroundColor: token.color },
                      ]}
                    >
                      <Ionicons
                        name={token.icon as any}
                        size={20}
                        color='#fff'
                      />
                    </View>
                    <View style={styles.tokenDetails}>
                      <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                      <Text style={styles.tokenName}>{token.name}</Text>
                    </View>
                  </View>
                  <View style={styles.tokenBalanceContainer}>
                    <Text style={styles.balanceText}>{token.balance}</Text>
                    {fromToken.symbol === token.symbol && (
                      <Ionicons
                        name='checkmark-circle'
                        size={20}
                        color='#10b981'
                      />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Loading Overlay */}
      <Modal visible={isLoading} transparent animationType='fade'>
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContent}>
            <Text style={styles.loadingText}>🔐 Signing Transaction...</Text>
            <Text style={styles.loadingSubtext}>
              Please complete the signing process
            </Text>
          </View>
        </View>
      </Modal>

      {/* Transaction Result Modal */}
      <Modal visible={showTransactionResult} transparent animationType='slide'>
        <View style={styles.modalOverlay}>
          <View style={styles.resultModalContent}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>✅ Transaction Successful!</Text>
              <TouchableOpacity onPress={() => setShowTransactionResult(false)}>
                <Ionicons name='close-outline' size={24} color='#64748b' />
              </TouchableOpacity>
            </View>

            <View style={styles.resultBody}>
              <Text style={styles.resultDescription}>
                Your {amount} {fromToken.symbol} has been sent successfully.
              </Text>

              <View style={styles.transactionHashContainer}>
                <Text style={styles.hashLabel}>Transaction Hash:</Text>
                <View style={styles.hashRow}>
                  <Text style={styles.hashText} numberOfLines={1}>
                    {String(transactionHash || 'No hash available')}
                  </Text>
                  <TouchableOpacity
                    onPress={copyTransactionHash}
                    style={styles.copyButton}
                  >
                    <Ionicons name='copy-outline' size={20} color='#6366f1' />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.resultActions}>
                <TouchableOpacity
                  style={styles.explorerButton}
                  onPress={viewInExplorer}
                >
                  <Ionicons name='open-outline' size={20} color='#6366f1' />
                  <Text style={styles.explorerButtonText}>
                    View in Explorer
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.doneButton}
                  onPress={() => setShowTransactionResult(false)}
                >
                  <Text style={styles.doneButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 16,
  },
  card: {
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tokenSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
  },
  tokenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tokenDetails: {
    marginLeft: 0,
  },
  tokenSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  tokenName: {
    fontSize: 14,
    color: '#64748b',
  },
  tokenBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  balanceText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1e293b',
  },
  scanButton: {
    padding: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 48,
    textAlignVertical: 'top',
    color: '#1e293b',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 12,
    color: '#1e293b',
  },
  tokenSymbolText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#64748b',
  },
  balanceInfo: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
  },
  maxButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  maxButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#64748b',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e293b',
  },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    marginTop: 8,
    paddingTop: 12,
  },
  summaryTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  summaryTotalValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  sendButton: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  tokenList: {
    padding: 16,
  },
  tokenOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
  },
  selectedToken: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  tokenBalanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 12,
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#64748b',
  },
  resultModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  resultBody: {
    padding: 20,
  },
  resultDescription: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 20,
  },
  transactionHashContainer: {
    marginBottom: 20,
  },
  hashLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hashText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#1e293b',
  },
  copyButton: {
    padding: 4,
  },
  resultActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  explorerButton: {
    backgroundColor: '#6366f1',
    padding: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  explorerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#6366f1',
    padding: 12,
    borderRadius: 6,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
