'use client';

import { Ionicons } from '@expo/vector-icons';
import {
  useLazorWallet,
  type AuthorizeResult,
} from '@lazorkit/react-native';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const REDIRECT_URL = 'exp://localhost:8081';
const DEFAULT_RECIPIENT = '3dsU4iyJWnoPqDQsbXT2KFfc1ZzzgtUyRGJRbRvSJ3r7';

/**
 * Deferred execution demo.
 *
 * Flow:
 *   1. Authorize  — passkey-signs an off-chain payload, opens a DeferredExec PDA on-chain.
 *   2. Execute    — submits the previously-authorized payload (no passkey prompt, anyone can relay).
 *   3. Reclaim    — closes an expired DeferredExec to recover its rent (fallback path).
 */
export default function DeferredScreen() {
  const {
    smartWalletPubkey,
    isConnected,
    authorizeDeferred,
    executeDeferred,
    reclaimDeferred,
  } = useLazorWallet();

  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);
  const [amount, setAmount] = useState('0.001');
  const [authorize, setAuthorize] = useState<AuthorizeResult | null>(null);
  const [executeSig, setExecuteSig] = useState<string>('');
  const [reclaimSig, setReclaimSig] = useState<string>('');
  const [busy, setBusy] = useState<'idle' | 'authorize' | 'execute' | 'reclaim'>('idle');

  const buildTransferIx = () => {
    if (!smartWalletPubkey) throw new Error('Wallet not connected');
    const lamports = Math.round(parseFloat(amount.replace(',', '.')) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      throw new Error('Invalid amount');
    }
    return SystemProgram.transfer({
      fromPubkey: smartWalletPubkey,
      toPubkey: new PublicKey(recipient),
      lamports,
    });
  };

  const handleAuthorize = async () => {
    if (!isConnected) {
      Alert.alert('Wallet not connected');
      return;
    }
    try {
      setBusy('authorize');
      const ix = buildTransferIx();
      const result = await authorizeDeferred(
        {
          instructions: [ix],
          // ~2 minutes (default 300 slots). Bump for QR / cross-device flows.
          expiryOffset: 600,
        },
        {
          redirectUrl: REDIRECT_URL,
          onSuccess: (r: AuthorizeResult) => {
            console.log('Authorize TX1:', r.signature);
          },
          onFail: (err) => {
            throw err;
          },
        },
      );
      setAuthorize(result);
      setExecuteSig('');
      setReclaimSig('');
    } catch (err) {
      Alert.alert('Authorize failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleExecute = async () => {
    if (!authorize) {
      Alert.alert('Authorize first');
      return;
    }
    try {
      setBusy('execute');
      const sig = await executeDeferred(
        { deferredPayload: authorize.deferredPayload },
        {
          onSuccess: (s) => console.log('Execute TX2:', s),
          onFail: (err) => {
            throw err;
          },
        },
      );
      setExecuteSig(sig);
    } catch (err) {
      Alert.alert('Execute failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleReclaim = async () => {
    if (!authorize) {
      Alert.alert('No DeferredExec PDA to reclaim');
      return;
    }
    try {
      setBusy('reclaim');
      const sig = await reclaimDeferred(
        { deferredExecPda: authorize.deferredExecPda },
        {
          onSuccess: (s) => console.log('Reclaim:', s),
          onFail: (err) => {
            throw err;
          },
        },
      );
      setReclaimSig(sig);
    } catch (err) {
      Alert.alert('Reclaim failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Deferred Execution</Text>
        <Text style={styles.subheading}>
          Two-tx flow: passkey-sign once (TX1), then anyone can submit the result (TX2).
        </Text>

        {/* Inputs */}
        <View style={styles.card}>
          <Text style={styles.label}>Recipient</Text>
          <TextInput
            style={styles.input}
            value={recipient}
            onChangeText={setRecipient}
            placeholder='Solana address'
            placeholderTextColor='#9ca3af'
            autoCapitalize='none'
            autoCorrect={false}
          />
          <Text style={[styles.label, { marginTop: 12 }]}>Amount (SOL)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder='0.001'
            placeholderTextColor='#9ca3af'
            keyboardType='numeric'
          />
        </View>

        {/* Step 1: Authorize */}
        <Step
          index={1}
          title='Authorize (passkey)'
          description='Open a DeferredExec PDA. Costs rent paid by paymaster; refundable later.'
          buttonLabel={busy === 'authorize' ? 'Signing…' : 'Authorize'}
          onPress={handleAuthorize}
          disabled={busy !== 'idle' || !isConnected}
          status={
            authorize && (
              <ResultBlock label='TX1 signature' value={authorize.signature} />
            )
          }
          extra={
            authorize && (
              <ResultBlock
                label='DeferredExec PDA'
                value={authorize.deferredExecPda.toBase58()}
              />
            )
          }
        />

        {/* Step 2: Execute */}
        <Step
          index={2}
          title='Execute Deferred'
          description='Submit TX2. No passkey prompt — relayer signs with paymaster.'
          buttonLabel={busy === 'execute' ? 'Submitting…' : 'Execute Deferred'}
          onPress={handleExecute}
          disabled={busy !== 'idle' || !authorize}
          status={executeSig ? <ResultBlock label='TX2 signature' value={executeSig} /> : null}
        />

        {/* Step 3: Reclaim (fallback) */}
        <Step
          index={3}
          title='Reclaim (after expiry)'
          description='If TX2 never landed before expiry, close the PDA to recover its rent.'
          buttonLabel={busy === 'reclaim' ? 'Reclaiming…' : 'Reclaim'}
          onPress={handleReclaim}
          disabled={busy !== 'idle' || !authorize}
          status={reclaimSig ? <ResultBlock label='Reclaim signature' value={reclaimSig} /> : null}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

interface StepProps {
  index: number;
  title: string;
  description: string;
  buttonLabel: string;
  onPress: () => void;
  disabled?: boolean;
  status?: React.ReactNode;
  extra?: React.ReactNode;
}

function Step({ index, title, description, buttonLabel, onPress, disabled, status, extra }: StepProps) {
  return (
    <View style={styles.card}>
      <View style={styles.stepHeader}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>{index}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <Text style={styles.stepDescription}>{description}</Text>
      <TouchableOpacity
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={onPress}
        disabled={disabled}
      >
        <Ionicons name='arrow-forward-circle-outline' size={18} color='#fff' />
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </TouchableOpacity>
      {status}
      {extra}
    </View>
  );
}

function ResultBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultBlock}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  subheading: { fontSize: 13, color: '#64748b', marginBottom: 16 },
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
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#1e293b',
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  stepBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  stepDescription: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: { backgroundColor: '#cbd5e1' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  resultBlock: {
    marginTop: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 10,
  },
  resultLabel: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 },
  resultValue: { fontSize: 12, color: '#0f172a', fontFamily: 'Menlo' },
});
