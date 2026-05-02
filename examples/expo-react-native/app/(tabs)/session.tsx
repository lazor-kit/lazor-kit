'use client';

import { Ionicons } from '@expo/vector-icons';
import {
  Actions,
  useLazorWallet,
} from '@lazorkit/react-native';
import {
  Keypair,
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
 * Session demo.
 *
 *   1. Create   — passkey-signs once to register a fresh Ed25519 session key on-chain.
 *   2. Send     — subsequent transactions sign locally with the session keypair (no portal).
 *   3. Revoke   — passkey-signs once more to close the session (refunds rent).
 *
 * The session keypair lives only in this component's state for the demo.
 * In production, store it in a secure keystore (Keychain / Keystore) so reloads don't lose it.
 */
export default function SessionScreen() {
  const {
    smartWalletPubkey,
    isConnected,
    connection,
    createSession,
    revokeSession,
    signAndSendWithSession,
  } = useLazorWallet();

  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);
  const [amount, setAmount] = useState('0.001');
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(null);
  const [sessionPda, setSessionPda] = useState<PublicKey | null>(null);
  const [createSig, setCreateSig] = useState<string>('');
  const [sendSig, setSendSig] = useState<string>('');
  const [revokeSig, setRevokeSig] = useState<string>('');
  const [busy, setBusy] = useState<'idle' | 'create' | 'send' | 'revoke'>('idle');

  const handleCreate = async () => {
    if (!isConnected) {
      Alert.alert('Wallet not connected');
      return;
    }
    try {
      setBusy('create');
      const kp = Keypair.generate();
      const currentSlot = await connection.getSlot();
      // ~6 hours at ~400ms slot time → 54000 slots. Adjust per use case.
      const expiresAtSlot = BigInt(currentSlot) + 54_000n;

      const result = await createSession(
        {
          sessionKey: kp.publicKey,
          expiresAtSlot,
          // Cap session to a max-per-tx SOL transfer. Omit `actions` for unrestricted.
          actions: [Actions.solMaxPerTx(1_000_000n)], // 0.001 SOL per tx
        },
        {
          redirectUrl: REDIRECT_URL,
          onSuccess: (r) => console.log('CreateSession TX:', r),
          onFail: (err) => {
            throw err;
          },
        },
      );

      setSessionKeypair(kp);
      setSessionPda(result.sessionPda);
      setCreateSig(result.signature);
      setSendSig('');
      setRevokeSig('');
    } catch (err) {
      Alert.alert('Create session failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleSend = async () => {
    if (!sessionKeypair || !sessionPda) {
      Alert.alert('Create a session first');
      return;
    }
    if (!smartWalletPubkey) {
      Alert.alert('Wallet not connected');
      return;
    }
    try {
      setBusy('send');
      const lamports = Math.round(parseFloat(amount.replace(',', '.')) * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Invalid amount');
      }
      const ix = SystemProgram.transfer({
        fromPubkey: smartWalletPubkey,
        toPubkey: new PublicKey(recipient),
        lamports,
      });

      const sig = await signAndSendWithSession(
        {
          sessionKeypair,
          sessionPda,
          instructions: [ix],
          transactionOptions: { clusterSimulation: 'devnet' },
        },
        {
          onSuccess: (s) => console.log('Session send:', s),
          onFail: (err) => {
            throw err;
          },
        },
      );
      setSendSig(sig);
    } catch (err) {
      Alert.alert('Session send failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleRevoke = async () => {
    if (!sessionPda) {
      Alert.alert('No session to revoke');
      return;
    }
    try {
      setBusy('revoke');
      const sig = await revokeSession(
        { sessionPda },
        {
          redirectUrl: REDIRECT_URL,
          onSuccess: (s) => console.log('Revoke:', s),
          onFail: (err) => {
            throw err;
          },
        },
      );
      setRevokeSig(sig);
      // Local state — the on-chain session is now closed; clear local refs.
      setSessionKeypair(null);
      setSessionPda(null);
    } catch (err) {
      Alert.alert('Revoke failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Session Keys</Text>
        <Text style={styles.subheading}>
          One passkey prompt to register; subsequent txs sign locally with an Ed25519 session key.
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

        {/* Step 1: Create */}
        <Step
          index={1}
          title='Create Session (passkey)'
          description='Generate a fresh Ed25519 keypair and register its pubkey on-chain. Session bounded by max-per-tx 0.001 SOL.'
          buttonLabel={busy === 'create' ? 'Signing…' : 'Create Session'}
          onPress={handleCreate}
          disabled={busy !== 'idle' || !isConnected}
          status={
            <>
              {createSig ? <ResultBlock label='Create signature' value={createSig} /> : null}
              {sessionPda ? <ResultBlock label='Session PDA' value={sessionPda.toBase58()} /> : null}
              {sessionKeypair ? (
                <ResultBlock
                  label='Session pubkey (Ed25519)'
                  value={sessionKeypair.publicKey.toBase58()}
                />
              ) : null}
            </>
          }
        />

        {/* Step 2: Send via Session */}
        <Step
          index={2}
          title='Send via Session'
          description='Local Ed25519 signature, submitted through the paymaster. No passkey prompt.'
          buttonLabel={busy === 'send' ? 'Submitting…' : 'Send via Session'}
          onPress={handleSend}
          disabled={busy !== 'idle' || !sessionPda}
          status={sendSig ? <ResultBlock label='Send signature' value={sendSig} /> : null}
        />

        {/* Step 3: Revoke */}
        <Step
          index={3}
          title='Revoke Session (passkey)'
          description='Close the session early to refund its rent.'
          buttonLabel={busy === 'revoke' ? 'Signing…' : 'Revoke'}
          onPress={handleRevoke}
          disabled={busy !== 'idle' || !sessionPda}
          status={revokeSig ? <ResultBlock label='Revoke signature' value={revokeSig} /> : null}
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
}

function Step({ index, title, description, buttonLabel, onPress, disabled, status }: StepProps) {
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
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  stepBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  stepDescription: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  button: {
    backgroundColor: '#10b981',
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
