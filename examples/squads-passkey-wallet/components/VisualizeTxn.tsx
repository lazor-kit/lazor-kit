import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

// Minimal, end‑user friendly viewer that is SAFE to render inside a parent ScrollView.
// No FlatList/ScrollView inside. Focus on labels & counts, hide raw bytes behind a toggle.

export type PublicKeyLike = { toBase58(): string } | string;
export type MultisigCompiledInstruction = {
  programIdIndex: number;
  accountIndexes: Uint8Array;
  data: Uint8Array;
};
export type MultisigMessageAddressTableLookup = {
  accountKey: PublicKeyLike;
  writableIndexes: Uint8Array;
  readonlyIndexes: Uint8Array;
};
export type VaultTransactionMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKeyLike[];
  instructions: MultisigCompiledInstruction[];
  addressTableLookups: MultisigMessageAddressTableLookup[];
};
export type VaultTransactionLike = {
  multisig: PublicKeyLike;
  creator: PublicKeyLike;
  index: bigint | number | string;
  bump: number;
  vaultIndex: number;
  vaultBump: number;
  ephemeralSignerBumps: Uint8Array;
  message: VaultTransactionMessage;
};

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN = 'So11111111111111111111111111111111111111112'; // NOTE: replace with actual SPL Token program if needed

function pk(p: PublicKeyLike): string {
  return typeof p === 'string' ? p : p.toBase58();
}
function short(s: string, head = 4, tail = 4) {
  return s.length <= head + tail + 1
    ? s
    : `${s.slice(0, head)}…${s.slice(-tail)}`;
}
function toHex(u8: Uint8Array) {
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function programName(k: string) {
  if (k === SYSTEM_PROGRAM) return 'System Program';
  if (k === MEMO) return 'Memo';
  if (k === TOKEN_2022) return 'SPL Token 2022';
  // Add more known programs here as you like
  return 'Program';
}

export default function VaultTxnSummary({
  tx,
  addressBook,
}: {
  tx: VaultTransactionLike;
  addressBook?: Record<string, string>;
}) {
  const header = tx.message;
  const [showRaw, setShowRaw] = useState(false);

  const displayAccounts = useMemo(
    () => header.accountKeys.slice(0, 5).map((k) => pk(k)),
    [header]
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Multisig Transaction</Text>
      <Text style={styles.caption}>
        #{String(tx.index)} · {header.instructions.length} instruction
        {header.instructions.length !== 1 ? 's' : ''}
      </Text>

      {/* Instruction summary */}
      <View style={{ marginTop: 10 }}>
        <Text style={styles.sectionLabel}>What will happen</Text>
        {header.instructions.map((ix, i) => {
          const programKey = pk(header.accountKeys[ix.programIdIndex]);
          const name = addressBook?.[programKey] ?? programName(programKey);
          const accounts = Array.from(ix.accountIndexes || [])
            .slice(0, 3)
            .map((ai) => pk(header.accountKeys[ai]));
          return (
            <View key={i} style={styles.instructionRow}>
              <Text style={styles.instructionBullet}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.instructionTitle}>{name}</Text>
                <Text style={styles.instructionSubtitle}>
                  Program: {short(programKey, 6, 6)} · Accounts:{' '}
                  {accounts.map((a) => addressBook?.[a] ?? short(a)).join(', ')}
                  {Array.from(ix.accountIndexes || []).length > 3 ? '…' : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.tag}>
    <Text style={styles.tagText}>{children}</Text>
  </View>
);

const Chip = ({ label, onCopy }: { label: string; onCopy?: () => void }) => (
  <TouchableOpacity onPress={onCopy} style={styles.chip}>
    <Text style={styles.chipText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  caption: { color: '#6B7280', marginTop: 2 },
  sectionLabel: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 6,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, color: '#111827' },
  chip: {
    backgroundColor: '#EEF2FF',
    borderColor: '#E0E7FF',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12, color: '#3730A3' },
  more: { fontSize: 12, color: '#6B7280', marginLeft: 4, marginTop: 4 },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  instructionBullet: { width: 18, color: '#6B7280', fontWeight: '600' },
  instructionTitle: { fontWeight: '600', color: '#111827' },
  instructionSubtitle: { color: '#6B7280', marginTop: 2 },
  rawToggle: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  rawToggleText: { color: '#374151', fontSize: 12, fontWeight: '600' },
  rawBox: {
    marginTop: 8,
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any,
    fontSize: 12,
  },
});
